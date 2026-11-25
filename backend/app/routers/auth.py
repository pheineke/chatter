import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update

from app.auth import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.config import settings
from app.dependencies import CurrentUser, DB
from app import ws_enforcement
from app.rate_limiter import rate_limit_auth, rate_limit_auth_login
from app.schemas.user import UserCreate, UserRead, Token
from models.invite import ServerInvite
from models.refresh_token import RefreshToken
from models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ua(request: Request) -> str | None:
    ua = request.headers.get("User-Agent", "")
    return ua[:512] if ua else None


async def _issue_token_pair(user_id, db, *, user_agent: str | None = None) -> Token:
    """Create a fresh access + refresh token pair, persist the refresh token hash."""
    import uuid
    session_id = uuid.uuid4()
    access = create_access_token(user_id, session_id=session_id)
    raw_rt, rt_hash = generate_refresh_token()
    expires = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    now = datetime.now(timezone.utc)
    db.add(RefreshToken(
        id=session_id,
        token_hash=rt_hash,
        user_id=user_id,
        expires_at=expires,
        user_agent=user_agent,
        last_used_at=now,
    ))
    await db.commit()
    return Token(access_token=access, refresh_token=raw_rt)


async def _check_registration_allowed(invite_code: str | None, db) -> None:
    """Enforce REGISTRATION_MODE. The invite is only checked here, not used
    up: the new user joins through /invites/{code} afterwards like anyone."""
    mode = settings.registration_mode
    if mode == "open":
        return
    if mode == "closed":
        raise HTTPException(status_code=403, detail="Registration is closed")
    # invite: let the very first account through so an empty instance can be set up
    if (await db.execute(select(func.count()).select_from(User))).scalar_one() == 0:
        return
    if not invite_code:
        raise HTTPException(status_code=403, detail="An invite is required to register")
    invite = await db.get(ServerInvite, invite_code)
    if (
        invite is None
        or (invite.expires_at is not None and _aware(invite.expires_at) < datetime.now(timezone.utc))
        or (invite.max_uses and invite.uses >= invite.max_uses)
    ):
        raise HTTPException(status_code=403, detail="This invite is invalid or has expired")


class AuthConfig(BaseModel):
    registration_mode: str


@router.get("/config", response_model=AuthConfig)
async def auth_config():
    """Public: lets the sign-up page show an invite field or a "closed" notice."""
    return AuthConfig(registration_mode=settings.registration_mode)


# ── Auth endpoints ─────────────────────────────────────────────────────────────

@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(request: Request, body: UserCreate, db: DB, _rl: None = Depends(rate_limit_auth)):
    await _check_registration_allowed(body.invite_code, db)
    result = await db.execute(
        select(User).where(func.lower(User.username) == body.username.lower())
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already taken")

    user = User(username=body.username, password_hash=hash_password(body.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/login", response_model=Token)
async def login(
    request: Request,
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: DB,
    _rl: None = Depends(rate_limit_auth),
):
    await rate_limit_auth_login(request, form.username)
    result = await db.execute(
        select(User).where(func.lower(User.username) == form.username.strip().lower())
    )
    user = result.scalar_one_or_none()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await _issue_token_pair(user.id, db, user_agent=_ua(request))


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/refresh", response_model=Token)
async def refresh_token(request: Request, body: RefreshRequest, db: DB):
    """Exchange a valid refresh token for a new access + refresh token pair.

    Rotation: each refresh token works once. Rotation is a single conditional
    UPDATE, so of two concurrent requests with the same token exactly one wins
    (security_pass S7); the loser gets a 401 like any other reuse.

    Replaying a token that was rotated more than ``refresh_reuse_grace_seconds``
    ago signals theft and revokes every session of the user. Inside the grace
    window (tabs racing, lost response) and for tokens revoked by logout or
    session revocation, the request is just rejected.
    """
    rt_hash = hash_refresh_token(body.refresh_token)
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == rt_hash).with_for_update()
    )
    token_row = result.scalar_one_or_none()
    if token_row is None:
        raise HTTPException(status_code=401, detail="Invalid or revoked refresh token")

    now = datetime.now(timezone.utc)
    if token_row.revoked:
        await _handle_reuse(token_row, now, db)
        raise HTTPException(status_code=401, detail="Invalid or revoked refresh token")

    expires_at = _aware(token_row.expires_at)
    if expires_at < now:
        token_row.revoked = True
        await db.commit()
        raise HTTPException(status_code=401, detail="Refresh token has expired")

    rotated = await db.execute(
        update(RefreshToken)
        .where(RefreshToken.id == token_row.id, RefreshToken.revoked.is_(False))
        .values(revoked=True, rotated_at=now)
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    if rotated.rowcount != 1:
        # A concurrent request rotated it between our read and our update.
        raise HTTPException(status_code=401, detail="Invalid or revoked refresh token")

    return await _issue_token_pair(token_row.user_id, db, user_agent=_ua(request))


def _aware(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


async def _handle_reuse(token_row: RefreshToken, now: datetime, db) -> None:
    """A revoked refresh token was presented again."""
    if token_row.rotated_at is None:
        return  # ended by logout / session revocation: nothing more to do
    age = (now - _aware(token_row.rotated_at)).total_seconds()
    if age <= settings.refresh_reuse_grace_seconds:
        return  # benign race; the client picks up the winner's tokens
    user_id = token_row.user_id
    await db.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
    await db.commit()
    await ws_enforcement.close_user_sessions(user_id)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: RefreshRequest, db: DB):
    """Revoke the supplied refresh token, ending the session."""
    rt_hash = hash_refresh_token(body.refresh_token)
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == rt_hash)
    )
    token_row = result.scalar_one_or_none()
    if token_row and not token_row.revoked:
        token_row.revoked = True
        await db.commit()
        await ws_enforcement.close_session(token_row.id)


# ── Session management endpoints ──────────────────────────────────────────────

class SessionRead(BaseModel):
    id: str
    created_at: datetime
    last_used_at: datetime | None
    user_agent: str | None
    expires_at: datetime
    is_current: bool = False

    model_config = {"from_attributes": True}


@router.get("/sessions", response_model=list[SessionRead])
async def list_sessions(request: Request, current_user: CurrentUser, db: DB):
    """Return all active (non-revoked, non-expired) sessions for the current user."""
    current_session_id = getattr(request.state, "session_id", None)
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.user_id == current_user.id,
            RefreshToken.revoked == False,  # noqa: E712
            RefreshToken.expires_at > now,
        ).order_by(RefreshToken.last_used_at.desc().nullslast())
    )
    rows = result.scalars().all()
    return [SessionRead(
        id=str(r.id),
        created_at=r.created_at,
        last_used_at=r.last_used_at,
        user_agent=r.user_agent,
        expires_at=r.expires_at,
        is_current=str(r.id) == current_session_id,
    ) for r in rows]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(session_id: str, current_user: CurrentUser, db: DB):
    """Revoke a specific session owned by the current user."""
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.id == sid,
            RefreshToken.user_id == current_user.id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    row.revoked = True
    await db.commit()
    await ws_enforcement.close_session(row.id)


class RevokeOthersRequest(BaseModel):
    current_refresh_token: str


@router.delete("/sessions", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_all_other_sessions(
    body: RevokeOthersRequest,
    current_user: CurrentUser,
    db: DB,
):
    """Revoke all sessions for the current user except the one provided."""
    keep_hash = hash_refresh_token(body.current_refresh_token)
    # Find the row to keep
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == keep_hash)
    )
    keep_row = result.scalar_one_or_none()

    keep_id = None
    if keep_row is None or keep_row.user_id != current_user.id:
        # Revoke everything — either the token is wrong or user mismatch
        await db.execute(
            delete(RefreshToken).where(RefreshToken.user_id == current_user.id)
        )
    else:
        keep_id = keep_row.id
        await db.execute(
            delete(RefreshToken).where(
                RefreshToken.user_id == current_user.id,
                RefreshToken.id != keep_row.id,
            )
        )
    await db.commit()
    await ws_enforcement.close_user_sessions(current_user.id, keep_session=keep_id)
