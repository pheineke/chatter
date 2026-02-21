import uuid
from datetime import datetime, timezone, timedelta


def _now_utc() -> datetime:
    """Return current UTC time as a naive datetime for SQLite-safe comparisons."""
    return datetime.utcnow()


def _is_expired(expires_at: datetime | None) -> bool:
    if expires_at is None:
        return False
    # SQLite returns naive datetimes; strip tzinfo from comparison target
    naive_now = datetime.utcnow()
    naive_exp = expires_at.replace(tzinfo=None) if expires_at.tzinfo else expires_at
    return naive_exp < naive_now
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, field_validator

from app.dependencies import CurrentUser, DB
from app.routers.servers import _get_server_or_404, _require_member, _require_admin
from app.ws_manager import manager
from models.invite import ServerInvite
from models.server import Server, ServerMember

router = APIRouter(tags=["invites"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class InviteCreate(BaseModel):
    max_uses: Optional[int] = None
    expires_hours: Optional[int] = 24  # None = never expires


class InviteRead(BaseModel):
    code: str
    server_id: uuid.UUID
    server_title: str
    server_image: Optional[str] = None
    created_by: uuid.UUID
    expires_at: Optional[datetime] = None
    uses: int
    max_uses: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _invite_to_read(invite: ServerInvite) -> InviteRead:
    return InviteRead(
        code=invite.code,
        server_id=invite.server_id,
        server_title=invite.server.title,
        server_image=invite.server.image,
        created_by=invite.created_by,
        expires_at=invite.expires_at,
        uses=invite.uses,
        max_uses=invite.max_uses,
        created_at=invite.created_at,
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post(
    "/servers/{server_id}/invites",
    response_model=InviteRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_invite(
    server_id: uuid.UUID,
    body: InviteCreate,
    current_user: CurrentUser,
    db: DB,
):
    server = await _get_server_or_404(server_id, db)
    await _require_member(server_id, current_user.id, db)

    expires_at = None
    if body.expires_hours is not None:
        expires_at = datetime.utcnow() + timedelta(hours=body.expires_hours)

    invite = ServerInvite(
        server_id=server_id,
        created_by=current_user.id,
        expires_at=expires_at,
        max_uses=body.max_uses,
    )
    db.add(invite)
    await db.commit()

    # Reload with server relationship
    result = await db.execute(
        select(ServerInvite)
        .options(selectinload(ServerInvite.server))
        .where(ServerInvite.code == invite.code)
    )
    invite = result.scalar_one()
    read = _invite_to_read(invite)
    await manager.broadcast_server(
        server_id,
        {"type": "invite.created", "data": {"server_id": str(server_id), "code": invite.code}},
    )
    return read


@router.get("/invites/{code}", response_model=InviteRead)
async def get_invite(code: str, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(ServerInvite)
        .options(selectinload(ServerInvite.server))
        .where(ServerInvite.code == code)
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if _is_expired(invite.expires_at):
        raise HTTPException(status_code=410, detail="Invite has expired")
    if invite.max_uses and invite.uses >= invite.max_uses:
        raise HTTPException(status_code=410, detail="Invite has reached max uses")
    return _invite_to_read(invite)


@router.post("/invites/{code}/join", response_model=dict)
async def join_via_invite(code: str, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(ServerInvite)
        .options(selectinload(ServerInvite.server))
        .where(ServerInvite.code == code)
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if _is_expired(invite.expires_at):
        raise HTTPException(status_code=410, detail="Invite has expired")
    if invite.max_uses and invite.uses >= invite.max_uses:
        raise HTTPException(status_code=410, detail="Invite has reached max uses")

    # Check already a member
    existing = await db.execute(
        select(ServerMember).where(
            ServerMember.server_id == invite.server_id,
            ServerMember.user_id == current_user.id,
        )
    )
    newly_joined = False
    if not existing.scalar_one_or_none():
        db.add(ServerMember(server_id=invite.server_id, user_id=current_user.id))
        invite.uses += 1
        await db.commit()
        newly_joined = True

    if newly_joined:
        await manager.broadcast_server(
            invite.server_id,
            {"type": "server.member_joined", "data": {"server_id": str(invite.server_id), "user_id": str(current_user.id)}},
        )

    return {"server_id": str(invite.server_id)}


@router.get("/servers/{server_id}/invites", response_model=list[InviteRead])
async def list_invites(
    server_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    result = await db.execute(
        select(ServerInvite)
        .options(selectinload(ServerInvite.server))
        .where(ServerInvite.server_id == server_id)
        .order_by(ServerInvite.created_at.desc())
    )
    return [_invite_to_read(i) for i in result.scalars().all()]


@router.delete("/invites/{code}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(code: str, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(ServerInvite)
        .options(selectinload(ServerInvite.server))
        .where(ServerInvite.code == code)
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    server = await _get_server_or_404(invite.server_id, db)
    await _require_admin(server, current_user.id, db)
    server_id = invite.server_id
    code = invite.code
    await db.delete(invite)
    await db.commit()
    await manager.broadcast_server(
        server_id,
        {"type": "invite.deleted", "data": {"server_id": str(server_id), "code": code}},
    )

