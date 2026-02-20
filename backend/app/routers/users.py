import os
import uuid

import aiofiles
from fastapi import APIRouter, HTTPException, UploadFile, File, status
from sqlalchemy import select

from app.config import settings
from app.dependencies import CurrentUser, DB
from app.schemas.user import UserRead, UserUpdate
from models.user import User, UserStatus

router = APIRouter(prefix="/users", tags=["users"])

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


@router.get("/me", response_model=UserRead)
async def get_me(current_user: CurrentUser):
    return current_user


@router.patch("/me", response_model=UserRead)
async def update_me(body: UserUpdate, current_user: CurrentUser, db: DB):
    if body.description is not None:
        current_user.description = body.description
    if body.status is not None:
        current_user.status = body.status
    if body.pronouns is not None:
        current_user.pronouns = body.pronouns
    if body.banner is not None:
        current_user.banner = body.banner
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
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


@router.get("/{user_id}", response_model=UserRead)
async def get_user(user_id: uuid.UUID, db: DB, current_user: CurrentUser):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
