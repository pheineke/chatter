import os
import uuid
from typing import List

import aiofiles
from fastapi import APIRouter, HTTPException, UploadFile, File, Query, status
from sqlalchemy import select, or_, and_
from sqlalchemy.orm import selectinload

from app.config import settings
from app.dependencies import CurrentUser, DB
from app.schemas.message import DMCreate, DMRead
from app.ws_manager import manager
from models.dm import DirectMessage, DMAttachment

router = APIRouter(prefix="/dms", tags=["direct_messages"])

ALLOWED_ATTACHMENT_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "audio/mpeg", "audio/ogg", "audio/wav",
}


async def _get_dm_or_404(dm_id: uuid.UUID, db) -> DirectMessage:
    result = await db.execute(
        select(DirectMessage)
        .options(
            selectinload(DirectMessage.sender),
            selectinload(DirectMessage.recipient),
            selectinload(DirectMessage.attachments),
        )
        .where(DirectMessage.id == dm_id)
    )
    dm = result.scalar_one_or_none()
    if not dm or dm.is_deleted:
        raise HTTPException(status_code=404, detail="Message not found")
    return dm


@router.get("/{user_id}", response_model=List[DMRead])
async def list_dms(
    user_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    before: uuid.UUID | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
):
    """List DM conversation between the current user and another user."""
    query = (
        select(DirectMessage)
        .options(
            selectinload(DirectMessage.sender),
            selectinload(DirectMessage.recipient),
            selectinload(DirectMessage.attachments),
        )
        .where(
            DirectMessage.is_deleted == False,
            or_(
                and_(DirectMessage.sender_id == current_user.id, DirectMessage.recipient_id == user_id),
                and_(DirectMessage.sender_id == user_id, DirectMessage.recipient_id == current_user.id),
            ),
        )
        .order_by(DirectMessage.created_at.desc())
        .limit(limit)
    )
    if before:
        bm = await db.execute(select(DirectMessage).where(DirectMessage.id == before))
        bm_obj = bm.scalar_one_or_none()
        if bm_obj:
            query = query.where(DirectMessage.created_at < bm_obj.created_at)

    result = await db.execute(query)
    return list(reversed(result.scalars().all()))


@router.post("/{user_id}", response_model=DMRead, status_code=status.HTTP_201_CREATED)
async def send_dm(user_id: uuid.UUID, body: DMCreate, current_user: CurrentUser, db: DB):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot DM yourself")
    dm = DirectMessage(
        sender_id=current_user.id, recipient_id=user_id, content=body.content
    )
    db.add(dm)
    await db.flush()
    result = await db.execute(
        select(DirectMessage)
        .options(
            selectinload(DirectMessage.sender),
            selectinload(DirectMessage.recipient),
            selectinload(DirectMessage.attachments),
        )
        .where(DirectMessage.id == dm.id)
    )
    await db.commit()
    sent = result.scalar_one()
    event = {"type": "dm.created", "data": DMRead.model_validate(sent).model_dump(mode="json")}
    await manager.broadcast_user(user_id, event)
    await manager.broadcast_user(current_user.id, event)
    return sent


@router.delete("/{dm_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dm(dm_id: uuid.UUID, current_user: CurrentUser, db: DB):
    dm = await _get_dm_or_404(dm_id, db)
    if dm.sender_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot delete another user's message")
    dm.is_deleted = True
    dm.content = "[deleted]"
    await db.commit()
    other_id = dm.recipient_id if dm.sender_id == current_user.id else dm.sender_id
    event = {"type": "dm.deleted", "data": {"id": str(dm_id)}}
    await manager.broadcast_user(current_user.id, event)
    await manager.broadcast_user(other_id, event)


@router.post("/{dm_id}/attachments", response_model=DMRead)
async def upload_dm_attachment(
    dm_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    file: UploadFile = File(...),
):
    dm = await _get_dm_or_404(dm_id, db)
    if dm.sender_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if file.content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "bin"
    filename = f"dm_attachments/{dm_id}/{uuid.uuid4()}.{ext}"
    dest = os.path.join(settings.static_dir, filename)
    os.makedirs(os.path.dirname(dest), exist_ok=True)

    async with aiofiles.open(dest, "wb") as f:
        await f.write(await file.read())

    file_type = file.content_type.split("/")[0]
    db.add(DMAttachment(dm_id=dm_id, file_path=filename, file_type=file_type))
    await db.commit()
    db.expire_all()

    return await _get_dm_or_404(dm_id, db)
