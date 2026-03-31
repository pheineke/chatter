import os
import uuid

import aiofiles
from fastapi import APIRouter, HTTPException, Response, UploadFile, File, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select

from app.auth import hash_password, verify_password
from app.config import settings
from app.dependencies import CurrentUser, DB
from app.presence import broadcast_presence
from app.schemas.user import UserRead, UserUpdate, UserPublicRead
from app.utils.file_validation import verify_image_magic_with_dims, AVATAR_MAX, BANNER_MAX
from app.utils.rate_limiter import image_limiter, profile_limiter
from app.ws_manager import manager
from models.friend import FriendRequest, FriendRequestStatus
from models.server import ServerMember
from models.user import User, UserStatus
from models.note import UserNote
from models.decoration_code import DecorationCode

router = APIRouter(prefix="/users", tags=["users"])


def _mask_user_read(user: "User", viewer_id: uuid.UUID) -> "UserPublicRead":
    """Return a public UserRead for `user`, hiding status if hide_status is set.
    Private preference fields (preferred_status, hide_status) are never exposed
    to third parties — callers must use GET /users/me for their own full profile.
    """
    read = UserPublicRead.model_validate(user)
    if user.hide_status and user.id != viewer_id:
        read = read.model_copy(update={'status': UserStatus.offline})
    return read


async def _broadcast_user_updated(user: "User", db: DB) -> None:
    payload = UserPublicRead.model_validate(user).model_dump(mode="json")
    event = {"type": "user.updated", "data": payload}

    # User's own room
    await manager.broadcast_user(user.id, event)

    # Servers the user is in
    server_rows = await db.execute(select(ServerMember.server_id).where(ServerMember.user_id == user.id))
    for server_id in server_rows.scalars().all():
        await manager.broadcast_server(server_id, event)

    # Friends' personal rooms
    fr_rows = await db.execute(
        select(FriendRequest).where(
            FriendRequest.status == FriendRequestStatus.accepted,
            or_(FriendRequest.sender_id == user.id, FriendRequest.recipient_id == user.id),
        )
    )
    for fr in fr_rows.scalars().all():
        friend_id = fr.recipient_id if fr.sender_id == user.id else fr.sender_id
        await manager.broadcast_user(friend_id, event)


@router.get("/me", response_model=UserRead)
async def get_me(current_user: CurrentUser):
    return current_user


@router.patch("/me", response_model=UserRead)
async def update_me(body: UserUpdate, current_user: CurrentUser, db: DB, response: Response):
    # Rate-limit profile text changes (not pure status toggles)
    if body.description is not None or body.pronouns is not None:
        allowed, retry_after = profile_limiter.check(str(current_user.id))
        if not allowed:
            response.headers["Retry-After"] = str(retry_after)
            raise HTTPException(
                status_code=429,
                detail=f"You're updating your profile too quickly. Please wait {retry_after} seconds.",
            )
    status_changed = body.status is not None and body.status != current_user.status
    hide_status_changed = body.hide_status is not None and body.hide_status != current_user.hide_status
    if body.description is not None:
        current_user.description = body.description
    if body.status is not None:
        current_user.status = body.status
        # Persist the preferred status so reconnects restore the right state.
        # Setting 'offline' is the invisible mode — honoured on reconnect too.
        current_user.preferred_status = body.status
    if body.pronouns is not None:
        current_user.pronouns = body.pronouns
    if 'custom_status' in body.model_fields_set:
        current_user.custom_status = body.custom_status
    if body.banner is not None:
        current_user.banner = body.banner
    if body.dm_permission is not None:
        current_user.dm_permission = body.dm_permission
    if body.allow_server_fonts is not None:
        current_user.allow_server_fonts = body.allow_server_fonts
    if body.hide_status is not None:
        current_user.hide_status = body.hide_status
    if body.avatar_decoration is not None:
        # Empty string clears the decoration
        if body.avatar_decoration:
            # Verify user owns this frame
            owned = await db.execute(
                select(DecorationCode.id).where(
                    DecorationCode.redeemed_by == current_user.id,
                    DecorationCode.frame_id == body.avatar_decoration,
                ).limit(1)
            )
            if not owned.scalar_one_or_none():
                raise HTTPException(status_code=403, detail="You do not own this decoration")
        current_user.avatar_decoration = body.avatar_decoration or None
    if body.theme_preset is not None:
        current_user.theme_preset = body.theme_preset
    if body.theme_colors is not None:
        # If null string was passed from front-end it still matches but as a string "null" maybe we should check
        current_user.theme_colors = body.theme_colors if body.theme_colors != "null" else None
        
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)

    # Broadcast status change; if hide_status is on, always broadcast offline
    if status_changed or hide_status_changed:
        broadcast_status = "offline" if current_user.hide_status else current_user.status.value
        await broadcast_presence(current_user.id, broadcast_status, db)
    await _broadcast_user_updated(current_user, db)

    return current_user


@router.post("/me/avatar", response_model=UserRead)
async def upload_avatar(
    current_user: CurrentUser,
    db: DB,
    response: Response,
    file: UploadFile = File(...),
):
    allowed, retry_after = image_limiter.check(f"avatar:{current_user.id}")
    if not allowed:
        response.headers["Retry-After"] = str(retry_after)
        raise HTTPException(
            status_code=429,
            detail=f"You're updating your profile too quickly. Please wait {retry_after} seconds.",
        )
    # Validate magic bytes and enforce maximum dimensions; ext is MIME-derived
    content, ext = await verify_image_magic_with_dims(file, AVATAR_MAX, label="Avatar")

    filename = f"avatars/{current_user.id}.{ext}"
    dest = os.path.join(settings.static_dir, filename)
    os.makedirs(os.path.dirname(dest), exist_ok=True)

    async with aiofiles.open(dest, "wb") as f:
        await f.write(content)

    current_user.avatar = filename
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    await _broadcast_user_updated(current_user, db)
    return current_user


@router.post("/me/banner", response_model=UserRead)
async def upload_banner(
    current_user: CurrentUser,
    db: DB,
    response: Response,
    file: UploadFile = File(...),
):
    allowed, retry_after = image_limiter.check(f"banner:{current_user.id}")
    if not allowed:
        response.headers["Retry-After"] = str(retry_after)
        raise HTTPException(
            status_code=429,
            detail=f"You're updating your profile too quickly. Please wait {retry_after} seconds.",
        )
    # Validate magic bytes and enforce maximum dimensions; ext is MIME-derived
    content, ext = await verify_image_magic_with_dims(file, BANNER_MAX, label="Banner")

    filename = f"banners/{current_user.id}.{ext}"
    dest = os.path.join(settings.static_dir, filename)
    os.makedirs(os.path.dirname(dest), exist_ok=True)

    async with aiofiles.open(dest, "wb") as f:
        await f.write(content)

    current_user.banner = filename
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    await _broadcast_user_updated(current_user, db)
    return current_user


@router.get("/search", response_model=UserPublicRead)
async def search_user_by_username(
    username: str,
    db: DB,
    current_user: CurrentUser,
):
    """Look up a user by exact username (case-insensitive)."""
    result = await db.execute(select(User).where(func.lower(User.username) == username.lower().strip()))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _mask_user_read(user, current_user.id)


@router.get("/{user_id}", response_model=UserPublicRead)
async def get_user(user_id: uuid.UUID, db: DB, current_user: CurrentUser):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _mask_user_read(user, current_user.id)


class NoteBody(BaseModel):
    content: str = ""


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


@router.post("/me/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(body: ChangePasswordBody, current_user: CurrentUser, db: DB):
    """Change the authenticated user's password."""
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=422, detail="New password must be at least 8 characters")
    current_user.password_hash = hash_password(body.new_password)
    db.add(current_user)
    await db.commit()


@router.get("/{user_id}/note", response_model=NoteBody)
async def get_note(user_id: uuid.UUID, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(UserNote).where(
            UserNote.owner_id == current_user.id,
            UserNote.target_id == user_id,
        )
    )
    note = result.scalar_one_or_none()
    return NoteBody(content=note.content if note else "")


@router.put("/{user_id}/note", response_model=NoteBody)
async def set_note(user_id: uuid.UUID, body: NoteBody, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(UserNote).where(
            UserNote.owner_id == current_user.id,
            UserNote.target_id == user_id,
        )
    )
    note = result.scalar_one_or_none()
    if note is None:
        note = UserNote(owner_id=current_user.id, target_id=user_id, content=body.content)
        db.add(note)
    else:
        note.content = body.content
    await db.commit()
    return NoteBody(content=note.content)
