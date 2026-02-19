import os
import uuid

import aiofiles
from fastapi import APIRouter, HTTPException, UploadFile, File, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.config import settings
from app.dependencies import CurrentUser, DB
from app.schemas.server import (
    ServerCreate,
    ServerUpdate,
    ServerRead,
    RoleCreate,
    RoleUpdate,
    RoleRead,
    MemberRead,
)
from app.ws_manager import manager
from models.server import Server, ServerMember, Role, UserRole
from models.user import User

router = APIRouter(prefix="/servers", tags=["servers"])

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


async def _get_server_or_404(server_id: uuid.UUID, db) -> Server:
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


async def _require_member(server_id: uuid.UUID, user_id: uuid.UUID, db) -> ServerMember:
    result = await db.execute(
        select(ServerMember).where(
            ServerMember.server_id == server_id, ServerMember.user_id == user_id
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this server")
    return member


async def _require_admin(server: Server, user_id: uuid.UUID, db) -> None:
    if server.owner_id == user_id:
        return
    # Check if user has an admin role
    result = await db.execute(
        select(UserRole)
        .join(Role)
        .where(Role.server_id == server.id, Role.is_admin == True, UserRole.user_id == user_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Admin permission required")


# ---- Servers ----------------------------------------------------------------

@router.post("/", response_model=ServerRead, status_code=status.HTTP_201_CREATED)
async def create_server(body: ServerCreate, current_user: CurrentUser, db: DB):
    server = Server(title=body.title, description=body.description, owner_id=current_user.id)
    db.add(server)
    await db.flush()  # get server.id before commit

    # Auto-add owner as member
    db.add(ServerMember(server_id=server.id, user_id=current_user.id))
    # Create default Admin role
    db.add(Role(server_id=server.id, name="Admin", is_admin=True, position=0))

    await db.commit()
    await db.refresh(server)
    return server


@router.get("/", response_model=list[ServerRead])
async def list_my_servers(current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(Server)
        .join(ServerMember)
        .where(ServerMember.user_id == current_user.id)
    )
    return result.scalars().all()


@router.get("/{server_id}", response_model=ServerRead)
async def get_server(server_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await _require_member(server_id, current_user.id, db)
    return await _get_server_or_404(server_id, db)


@router.patch("/{server_id}", response_model=ServerRead)
async def update_server(server_id: uuid.UUID, body: ServerUpdate, current_user: CurrentUser, db: DB):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    if body.title is not None:
        server.title = body.title
    if body.description is not None:
        server.description = body.description
    await db.commit()
    await db.refresh(server)
    return server


@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(server_id: uuid.UUID, current_user: CurrentUser, db: DB):
    server = await _get_server_or_404(server_id, db)
    if server.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the owner can delete this server")
    await db.delete(server)
    await db.commit()


async def _upload_server_image(server_id: uuid.UUID, file: UploadFile, field: str, db) -> Server:
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "bin"
    filename = f"servers/{server_id}/{field}.{ext}"
    dest = os.path.join(settings.static_dir, filename)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    async with aiofiles.open(dest, "wb") as f:
        await f.write(await file.read())
    return filename


@router.post("/{server_id}/image", response_model=ServerRead)
async def upload_server_image(
    server_id: uuid.UUID, current_user: CurrentUser, db: DB, file: UploadFile = File(...)
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    server.image = await _upload_server_image(server_id, file, "image", db)
    await db.commit()
    await db.refresh(server)
    return server


@router.post("/{server_id}/banner", response_model=ServerRead)
async def upload_server_banner(
    server_id: uuid.UUID, current_user: CurrentUser, db: DB, file: UploadFile = File(...)
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    server.banner = await _upload_server_image(server_id, file, "banner", db)
    await db.commit()
    await db.refresh(server)
    return server


# ---- Members ----------------------------------------------------------------

@router.get("/{server_id}/members", response_model=list[MemberRead])
async def list_members(server_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await _require_member(server_id, current_user.id, db)
    result = await db.execute(
        select(ServerMember)
        .options(selectinload(ServerMember.user))
        .where(ServerMember.server_id == server_id)
    )
    return result.scalars().all()


@router.post("/{server_id}/join", response_model=MemberRead)
async def join_server(server_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await _get_server_or_404(server_id, db)
    existing = await db.execute(
        select(ServerMember).where(
            ServerMember.server_id == server_id, ServerMember.user_id == current_user.id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Already a member")
    member = ServerMember(server_id=server_id, user_id=current_user.id)
    db.add(member)
    await db.commit()
    await db.refresh(member)
    await manager.broadcast_server(
        server_id,
        {"type": "server.member_joined", "data": {"server_id": str(server_id), "user_id": str(current_user.id)}},
    )
    return member


@router.delete("/{server_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    server_id: uuid.UUID, user_id: uuid.UUID, current_user: CurrentUser, db: DB
):
    server = await _get_server_or_404(server_id, db)
    # Can kick yourself (leave) or admin can kick others
    if current_user.id != user_id:
        await _require_admin(server, current_user.id, db)
    if user_id == server.owner_id:
        raise HTTPException(status_code=400, detail="Owner cannot be removed from their server")
    result = await db.execute(
        select(ServerMember).where(
            ServerMember.server_id == server_id, ServerMember.user_id == user_id
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    await db.delete(member)
    await db.commit()
    event_type = "server.member_left" if current_user.id == user_id else "server.member_kicked"
    await manager.broadcast_server(
        server_id,
        {"type": event_type, "data": {"server_id": str(server_id), "user_id": str(user_id)}},
    )


# ---- Roles ------------------------------------------------------------------

@router.get("/{server_id}/roles", response_model=list[RoleRead])
async def list_roles(server_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await _require_member(server_id, current_user.id, db)
    result = await db.execute(select(Role).where(Role.server_id == server_id).order_by(Role.position))
    return result.scalars().all()


@router.post("/{server_id}/roles", response_model=RoleRead, status_code=status.HTTP_201_CREATED)
async def create_role(server_id: uuid.UUID, body: RoleCreate, current_user: CurrentUser, db: DB):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    role = Role(
        server_id=server_id,
        name=body.name,
        color=body.color,
        is_admin=body.is_admin,
        position=body.position,
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)
    await manager.broadcast_server(
        server_id,
        {"type": "role.created", "data": RoleRead.model_validate(role).model_dump(mode="json")},
    )
    return role


@router.patch("/{server_id}/roles/{role_id}", response_model=RoleRead)
async def update_role(
    server_id: uuid.UUID, role_id: uuid.UUID, body: RoleUpdate, current_user: CurrentUser, db: DB
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    result = await db.execute(select(Role).where(Role.id == role_id, Role.server_id == server_id))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if body.name is not None:
        role.name = body.name
    if body.color is not None:
        role.color = body.color
    if body.is_admin is not None:
        role.is_admin = body.is_admin
    if body.position is not None:
        role.position = body.position
    await db.commit()
    await db.refresh(role)
    await manager.broadcast_server(
        server_id,
        {"type": "role.updated", "data": RoleRead.model_validate(role).model_dump(mode="json")},
    )
    return role


@router.delete("/{server_id}/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    server_id: uuid.UUID, role_id: uuid.UUID, current_user: CurrentUser, db: DB
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    result = await db.execute(select(Role).where(Role.id == role_id, Role.server_id == server_id))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    await db.delete(role)
    await db.commit()
    await manager.broadcast_server(
        server_id,
        {"type": "role.deleted", "data": {"server_id": str(server_id), "role_id": str(role_id)}},
    )


@router.post("/{server_id}/members/{user_id}/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def assign_role(
    server_id: uuid.UUID, user_id: uuid.UUID, role_id: uuid.UUID, current_user: CurrentUser, db: DB
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    await _require_member(server_id, user_id, db)
    result = await db.execute(select(Role).where(Role.id == role_id, Role.server_id == server_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Role not found")
    existing = await db.execute(
        select(UserRole).where(UserRole.user_id == user_id, UserRole.role_id == role_id)
    )
    if not existing.scalar_one_or_none():
        db.add(UserRole(user_id=user_id, role_id=role_id))
        await db.commit()


@router.delete(
    "/{server_id}/members/{user_id}/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_role(
    server_id: uuid.UUID, user_id: uuid.UUID, role_id: uuid.UUID, current_user: CurrentUser, db: DB
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    result = await db.execute(
        select(UserRole).where(UserRole.user_id == user_id, UserRole.role_id == role_id)
    )
    user_role = result.scalar_one_or_none()
    if user_role:
        await db.delete(user_role)
        await db.commit()
