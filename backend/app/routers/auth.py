from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import delete, select

from app.auth import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.config import settings
from app.dependencies import DB
from app.schemas.user import UserCreate, UserRead, Token
from models.refresh_token import RefreshToken
from models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])


async def _issue_token_pair(user_id, db) -> Token:
    """Create a fresh access + refresh token pair, persist the refresh token hash."""
    access = create_access_token(user_id)
    raw_rt, rt_hash = generate_refresh_token()
    expires = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    db.add(RefreshToken(token_hash=rt_hash, user_id=user_id, expires_at=expires))
    await db.commit()
    return Token(access_token=access, refresh_token=raw_rt)


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(body: UserCreate, db: DB):
    result = await db.execute(select(User).where(User.username == body.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already taken")

    user = User(username=body.username, password_hash=hash_password(body.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/login", response_model=Token)
async def login(form: Annotated[OAuth2PasswordRequestForm, Depends()], db: DB):
    result = await db.execute(select(User).where(User.username == form.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await _issue_token_pair(user.id, db)


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/refresh", response_model=Token)
async def refresh_token(body: RefreshRequest, db: DB):
    """Exchange a valid refresh token for a new access + refresh token pair.

    The submitted token is immediately revoked (rotation) regardless of
    outcome so replay attacks are detected and all sessions can be invalidated.
    """
    rt_hash = hash_refresh_token(body.refresh_token)
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == rt_hash)
    )
    token_row = result.scalar_one_or_none()

    if token_row is None or token_row.revoked:
        # Possible token reuse – revoke all tokens for this user if we found the row
        if token_row is not None:
            await db.execute(
                delete(RefreshToken).where(RefreshToken.user_id == token_row.user_id)
            )
            await db.commit()
        raise HTTPException(status_code=401, detail="Invalid or revoked refresh token")

    if token_row.expires_at < datetime.now(timezone.utc):
        token_row.revoked = True
        await db.commit()
        raise HTTPException(status_code=401, detail="Refresh token has expired")

    # Revoke the used token (rotation: one-time use)
    token_row.revoked = True
    await db.commit()

    return await _issue_token_pair(token_row.user_id, db)


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
