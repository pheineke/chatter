import os
import re
import uuid
from collections import defaultdict

import aiofiles
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.config import settings
from app.dependencies import CurrentUser, DB
from app.utils.file_validation import verify_image_magic_with_dims, SERVER_IMAGE_MAX
from app.schemas.server import (
    ServerCreate,
    ServerUpdate,
    ServerRead,
    RoleCreate,
    RoleUpdate,
    RoleRead,
    MemberRead,
    MemberNickUpdate,
    MemberSettingsUpdate,
    WordFilterCreate,
    WordFilterRead,
    ServerBanRead,
    CustomEmojiRead,
)
from app.schemas.user import UserRead, UserPublicRead
from app.ws_manager import manager
from app.services.audit_log_service import create_audit_log
from models.audit_log import AuditLogAction
from models.server import Server, ServerMember, Role, UserRole
from models.custom_emoji import CustomEmoji
from models.user import User, UserStatus
from models.word_filter import WordFilter, ServerBan

router = APIRouter(prefix="/servers", tags=["servers"])

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
CUSTOM_EMOJI_MAX = (256, 256)
CUSTOM_EMOJI_NAME_RE = re.compile(r"^[a-z0-9_]{2,32}$")


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
    
    await create_audit_log(
        session=db,
        server_id=server_id,
        user_id=current_user.id,
        action=AuditLogAction.SERVER_UPDATE,
        changes=body.model_dump(exclude_unset=True),
    )

    await db.commit()
    await db.refresh(server)
    await manager.broadcast_server(
        server_id,
        {"type": "server.updated", "data": ServerRead.model_validate(server).model_dump(mode="json")},
    )
    return server


@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(server_id: uuid.UUID, current_user: CurrentUser, db: DB):
    server = await _get_server_or_404(server_id, db)
    if server.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the owner can delete this server")
    await db.delete(server)
    await db.commit()


async def _upload_server_image(server_id: uuid.UUID, file: UploadFile, field: str, db) -> Server:
    # Validate magic bytes and enforce maximum dimensions
    content, ext = await verify_image_magic_with_dims(file, SERVER_IMAGE_MAX, label="Server image")
    filename = f"servers/{server_id}/{field}.{ext}"
    dest = os.path.join(settings.static_dir, filename)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    async with aiofiles.open(dest, "wb") as f:
        await f.write(content)
    return filename


async def _upload_custom_emoji_image(server_id: uuid.UUID, emoji_id: uuid.UUID, file: UploadFile) -> str:
    content, ext = await verify_image_magic_with_dims(
        file, CUSTOM_EMOJI_MAX, label="Custom emoji"
    )
    filename = f"servers/{server_id}/emojis/{emoji_id}.{ext}"
    dest = os.path.join(settings.static_dir, filename)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    async with aiofiles.open(dest, "wb") as f:
        await f.write(content)
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
    await manager.broadcast_server(
        server_id,
        {"type": "server.updated", "data": ServerRead.model_validate(server).model_dump(mode="json")},
    )
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
    await manager.broadcast_server(
        server_id,
        {"type": "server.updated", "data": ServerRead.model_validate(server).model_dump(mode="json")},
    )
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
    members = result.scalars().all()

    if not members:
        return []

    # Load role assignments for all members in one query, filter to this server
    user_ids = [m.user_id for m in members]
    roles_result = await db.execute(
        select(UserRole)
        .join(Role, UserRole.role_id == Role.id)
        .options(selectinload(UserRole.role))
        .where(UserRole.user_id.in_(user_ids), Role.server_id == server_id)
    )
    user_role_map: dict[uuid.UUID, list[RoleRead]] = defaultdict(list)
    for ur in roles_result.scalars().all():
        user_role_map[ur.user_id].append(RoleRead.model_validate(ur.role))

    return [
        MemberRead(
            user_id=m.user_id,
            server_id=m.server_id,
            user=(
                UserPublicRead.model_validate(m.user).model_copy(update={'status': UserStatus.offline})
                if m.user.hide_status and m.user.id != current_user.id
                else UserPublicRead.model_validate(m.user)
            ),
            joined_at=m.joined_at,
            roles=sorted(user_role_map.get(m.user_id, []), key=lambda r: r.position, reverse=True),
        )
        for m in members
    ]


@router.post("/{server_id}/join", response_model=MemberRead)
async def join_server(server_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await _get_server_or_404(server_id, db)
    await _check_not_banned(server_id, current_user.id, db)
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
    
    # If admin kicked someone else, log it
    if current_user.id != user_id:
        await create_audit_log(
            session=db,
            server_id=server_id,
            user_id=current_user.id,
            action=AuditLogAction.MEMBER_KICK,
            target_id=user_id,
        )

    await db.delete(member)
    await db.commit()
    event_type = "server.member_left" if current_user.id == user_id else "server.member_kicked"
    await manager.broadcast_server(
        server_id,
        {"type": event_type, "data": {"server_id": str(server_id), "user_id": str(user_id)}},
    )


@router.patch("/{server_id}/members/{user_id}/nick", response_model=MemberRead)
async def update_member_nick(
    server_id: uuid.UUID, user_id: uuid.UUID, body: MemberNickUpdate, current_user: CurrentUser, db: DB
):
    """Change a member's server nickname. Members can change their own; admins can change anyone's."""
    await _require_member(server_id, current_user.id, db)
    if current_user.id != user_id:
        server = await _get_server_or_404(server_id, db)
        await _require_admin(server, current_user.id, db)
    result = await db.execute(
        select(ServerMember)
        .options(selectinload(ServerMember.user))
        .where(ServerMember.server_id == server_id, ServerMember.user_id == user_id)
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    member.nickname = body.nickname
    await db.commit()
    await manager.broadcast_server(
        server_id,
        {"type": "server.member_updated", "data": {"server_id": str(server_id), "user_id": str(user_id)}},
    )
    return MemberRead(
        user_id=member.user_id,
        server_id=member.server_id,
        nickname=member.nickname,
        user=UserPublicRead.model_validate(member.user),
        joined_at=member.joined_at,
        roles=[],
    )

@router.patch("/{server_id}/members/me/settings", response_model=MemberRead)
async def update_my_settings(
    server_id: uuid.UUID, body: MemberSettingsUpdate, current_user: CurrentUser, db: DB
):
    """Update current user's settings for this server."""
    result = await db.execute(
        select(ServerMember)
        .options(selectinload(ServerMember.user))
        .where(ServerMember.server_id == server_id, ServerMember.user_id == current_user.id)
    )
    member = result.scalar_one_or_none()
    
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
            
    if body.allow_dms is not None:
        member.allow_dms = body.allow_dms

    await db.commit()
    
    return MemberRead(
        user_id=member.user_id,
        server_id=member.server_id,
        nickname=member.nickname,
        user=UserPublicRead.model_validate(member.user),
        joined_at=member.joined_at,
        allow_dms=member.allow_dms,
        roles=[],
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
        hoist=body.hoist,
        mentionable=body.mentionable,
        position=body.position,
    )
    
    await create_audit_log(
        session=db,
        server_id=server_id,
        user_id=current_user.id,
        action=AuditLogAction.ROLE_CREATE,
        changes={"name": body.name, "is_admin": body.is_admin, "color": body.color},
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
    if body.hoist is not None:
        role.hoist = body.hoist
    if body.mentionable is not None:
        role.mentionable = body.mentionable
    if body.position is not None:
        role.position = body.position

    await create_audit_log(
        session=db,
        server_id=server_id,
        user_id=current_user.id,
        action=AuditLogAction.ROLE_UPDATE,
        target_id=role_id,
        changes=body.model_dump(exclude_unset=True),
    )

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
    
    await create_audit_log(
        session=db,
        server_id=server_id,
        user_id=current_user.id,
        action=AuditLogAction.ROLE_DELETE,
        target_id=role_id,
        changes={"name": role.name},
    )
    
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
        
        await create_audit_log(
            session=db,
            server_id=server_id,
            user_id=current_user.id,
            action=AuditLogAction.MEMBER_ROLE_UPDATE,
            target_id=user_id,
            changes={"added_role_id": str(role_id)},
        )
        
        await db.commit()
        await manager.broadcast_server(
            server_id,
            {"type": "role.assigned", "data": {"server_id": str(server_id), "user_id": str(user_id), "role_id": str(role_id)}},
        )


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
        # Audit Log
        from app.routers.audit_logs import create_audit_log, AuditLogAction
        await create_audit_log(
            session=db,
            server_id=server_id,
            user_id=current_user.id,
            action=AuditLogAction.MEMBER_ROLE_UPDATE,
            target_id=user_id,
            changes={"removed_role_id": str(role_id)},
        )
        
        await db.commit()
        await manager.broadcast_server(
            server_id,
            {"type": "role.removed", "data": {"server_id": str(server_id), "user_id": str(user_id), "role_id": str(role_id)}},
        )


# ---- Word Filters -----------------------------------------------------------

@router.get("/{server_id}/word-filters", response_model=list[WordFilterRead])
async def list_word_filters(server_id: uuid.UUID, current_user: CurrentUser, db: DB):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    result = await db.execute(
        select(WordFilter).where(WordFilter.server_id == server_id).order_by(WordFilter.created_at)
    )
    return result.scalars().all()


@router.post("/{server_id}/word-filters", response_model=WordFilterRead, status_code=status.HTTP_201_CREATED)
async def create_word_filter(server_id: uuid.UUID, body: WordFilterCreate, current_user: CurrentUser, db: DB):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    wf = WordFilter(server_id=server_id, pattern=body.pattern.strip(), action=body.action.value)
    db.add(wf)
    await db.commit()
    await db.refresh(wf)
    return wf


@router.delete("/{server_id}/word-filters/{filter_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_word_filter(server_id: uuid.UUID, filter_id: uuid.UUID, current_user: CurrentUser, db: DB):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    result = await db.execute(
        select(WordFilter).where(WordFilter.id == filter_id, WordFilter.server_id == server_id)
    )
    wf = result.scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail="Word filter not found")
    await db.delete(wf)
    await db.commit()


# ---- Bans -------------------------------------------------------------------

@router.get("/{server_id}/bans", response_model=list[ServerBanRead])
async def list_bans(server_id: uuid.UUID, current_user: CurrentUser, db: DB):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    result = await db.execute(select(ServerBan).where(ServerBan.server_id == server_id))
    return result.scalars().all()


@router.post("/{server_id}/bans/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def ban_member(server_id: uuid.UUID, user_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Manually ban a user from the server (admin only). Also kicks them if still a member."""
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    if user_id == server.owner_id:
        raise HTTPException(status_code=400, detail="Cannot ban the server owner")
    # Record ban
    existing = await db.execute(
        select(ServerBan).where(ServerBan.server_id == server_id, ServerBan.user_id == user_id)
    )
    if not existing.scalar_one_or_none():
        db.add(ServerBan(server_id=server_id, user_id=user_id))
    
    await create_audit_log(
        session=db,
        server_id=server_id,
        user_id=current_user.id,
        action=AuditLogAction.MEMBER_BAN,
        target_id=user_id,
    )

    # Kick if still a member
    member_row = await db.execute(
        select(ServerMember).where(ServerMember.server_id == server_id, ServerMember.user_id == user_id)
    )
    member = member_row.scalar_one_or_none()
    if member:
        await db.delete(member)
    await db.commit()
    await manager.broadcast_server(
        server_id,
        {"type": "server.member_banned", "data": {"server_id": str(server_id), "user_id": str(user_id)}},
    )


@router.delete("/{server_id}/bans/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unban_member(server_id: uuid.UUID, user_id: uuid.UUID, current_user: CurrentUser, db: DB):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    result = await db.execute(
        select(ServerBan).where(ServerBan.server_id == server_id, ServerBan.user_id == user_id)
    )
    ban = result.scalar_one_or_none()
    if not ban:
        raise HTTPException(status_code=404, detail="Ban not found")
        
    await create_audit_log(
        session=db,
        server_id=server_id,
        user_id=current_user.id,
        action=AuditLogAction.MEMBER_UNBAN,
        target_id=user_id,
    )

    await db.delete(ban)
    await db.commit()


async def _check_not_banned(server_id: uuid.UUID, user_id: uuid.UUID, db) -> None:
    """Raise 403 if the user is banned from the server."""
    result = await db.execute(
        select(ServerBan).where(ServerBan.server_id == server_id, ServerBan.user_id == user_id)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="You are banned from this server")


# ---- Custom Emojis ----------------------------------------------------------

@router.get("/{server_id}/emojis", response_model=list[CustomEmojiRead])
async def list_custom_emojis(server_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await _require_member(server_id, current_user.id, db)
    result = await db.execute(
        select(CustomEmoji)
        .where(CustomEmoji.server_id == server_id)
        .order_by(CustomEmoji.created_at.asc())
    )
    return result.scalars().all()


@router.post("/{server_id}/emojis", response_model=CustomEmojiRead, status_code=status.HTTP_201_CREATED)
async def create_custom_emoji(
    server_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    name: str = Form(...),
    file: UploadFile = File(...),
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)

    cleaned = name.strip().lower()
    if not CUSTOM_EMOJI_NAME_RE.fullmatch(cleaned):
        raise HTTPException(
            status_code=400,
            detail="Emoji name must be 2-32 chars of lowercase letters, numbers, or underscores.",
        )

    exists = await db.execute(
        select(CustomEmoji).where(CustomEmoji.server_id == server_id, CustomEmoji.name == cleaned)
    )
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="An emoji with that name already exists.")

    emoji = CustomEmoji(server_id=server_id, name=cleaned, image_path="", created_by_id=current_user.id)
    db.add(emoji)
    await db.flush()

    emoji.image_path = await _upload_custom_emoji_image(server_id, emoji.id, file)

    await create_audit_log(
        session=db,
        server_id=server_id,
        user_id=current_user.id,
        action=AuditLogAction.EMOJI_CREATE,
        target_id=emoji.id,
        changes={"name": emoji.name, "image_path": emoji.image_path},
    )

    await db.commit()
    await db.refresh(emoji)
    return emoji


@router.delete("/{server_id}/emojis/{emoji_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_custom_emoji(
    server_id: uuid.UUID,
    emoji_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    result = await db.execute(
        select(CustomEmoji).where(CustomEmoji.server_id == server_id, CustomEmoji.id == emoji_id)
    )
    emoji = result.scalar_one_or_none()
    if not emoji:
        raise HTTPException(status_code=404, detail="Custom emoji not found")

    await create_audit_log(
        session=db,
        server_id=server_id,
        user_id=current_user.id,
        action=AuditLogAction.EMOJI_DELETE,
        target_id=emoji.id,
        changes={"name": emoji.name},
    )

    # Best-effort file cleanup; deletion failure should not block DB delete.
    try:
        os.remove(os.path.join(settings.static_dir, emoji.image_path))
    except FileNotFoundError:
        pass
    except OSError:
        pass

    await db.delete(emoji)
    await db.commit()
