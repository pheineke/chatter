import os
import uuid

import aiofiles
from fastapi import APIRouter, HTTPException, UploadFile, File, status
from pydantic import BaseModel
from sqlalchemy import select

from app.config import settings
from app.dependencies import CurrentUser, DB
from app.presence import broadcast_presence
from app.schemas.user import UserRead, UserUpdate
from app.ws_manager import manager
from models.user import User
from models.note import UserNote

router = APIRouter(prefix="/users", tags=["users"])

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


@router.get("/me", response_model=UserRead)
async def get_me(current_user: CurrentUser):
    return current_user


@router.patch("/me", response_model=UserRead)
async def update_me(body: UserUpdate, current_user: CurrentUser, db: DB):
    status_changed = body.status is not None and body.status != current_user.status
    if body.description is not None:
        current_user.description = body.description
    if body.status is not None:
        current_user.status = body.status
        manager.set_preferred_status(str(current_user.id), body.status.value)
    if body.pronouns is not None:
        current_user.pronouns = body.pronouns
    if body.banner is not None:
        current_user.banner = body.banner
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
    file: UploadFile = File(...),
):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    
    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "bin"
    filename = f"avatars/{current_user.id}.{ext}"
    dest = os.path.join(settings.static_dir, filename)
    os.makedirs(os.path.dirname(dest), exist_ok=True)

    async with aiofiles.open(dest, "wb") as f:
        await f.write(await file.read())

    current_user.avatar = filename
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.post("/me/banner", response_model=UserRead)
async def upload_banner(
    current_user: CurrentUser,
    db: DB,
    file: UploadFile = File(...),
):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    
    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "bin"
    filename = f"banners/{current_user.id}.{ext}"
    dest = os.path.join(settings.static_dir, filename)
    os.makedirs(os.path.dirname(dest), exist_ok=True)

    async with aiofiles.open(dest, "wb") as f:
        await f.write(await file.read())

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
