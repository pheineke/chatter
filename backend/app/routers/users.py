import os
import uuid

import aiofiles
from fastapi import APIRouter, HTTPException, Response, UploadFile, File, status
from pydantic import BaseModel
from sqlalchemy import select

from app.auth import hash_password, verify_password
from app.config import settings
from app.dependencies import CurrentUser, DB
from app.presence import broadcast_presence
from app.schemas.user import UserRead, UserUpdate
from app.utils.file_validation import verify_image_magic_with_dims, AVATAR_MAX, BANNER_MAX
from app.utils.rate_limiter import image_limiter, profile_limiter
from models.user import User
from models.note import UserNote

router = APIRouter(prefix="/users", tags=["users"])


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
    if body.description is not None:
        current_user.description = body.description
    if body.status is not None:
        current_user.status = body.status
        # Persist the preferred status so reconnects restore the right state.
        # Setting 'offline' is the invisible mode — honoured on reconnect too.
        current_user.preferred_status = body.status
    if body.pronouns is not None:
        current_user.pronouns = body.pronouns
    if body.banner is not None:
        current_user.banner = body.banner
    if body.dm_permission is not None:
        current_user.dm_permission = body.dm_permission
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)

    # Broadcast status change to servers and friends
    if status_changed:
        await broadcast_presence(current_user.id, current_user.status.value, db)

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
    return current_user


@router.get("/search", response_model=UserRead)
async def search_user_by_username(
    username: str,
    db: DB,
    current_user: CurrentUser,
):
    """Look up a user by exact username (case-insensitive)."""
    from sqlalchemy import func
    result = await db.execute(select(User).where(func.lower(User.username) == username.lower().strip()))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/{user_id}", response_model=UserRead)
async def get_user(user_id: uuid.UUID, db: DB, current_user: CurrentUser):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


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
