import os
import uuid
from datetime import datetime, timezone
from typing import List

import aiofiles
from fastapi import APIRouter, HTTPException, UploadFile, File, Query, status
from sqlalchemy import select, or_, and_
from sqlalchemy.orm import selectinload

from app.config import settings
from app.dependencies import CurrentUser, DB
from app.schemas.message import DMCreate, DMRead, DMConversationRead
from app.schemas.user import UserRead
from app.ws_manager import manager
from models.channel import Channel, ChannelType
from models.dm import DirectMessage, DMAttachment
from models.dm_channel import DMChannel
from models.message import Message

router = APIRouter(prefix="/dms", tags=["direct_messages"])


@router.get("/conversations", response_model=List[DMConversationRead])
async def list_dm_conversations(current_user: CurrentUser, db: DB):
    """Return all DM conversations for the current user, sorted by most recent message."""
    result = await db.execute(
        select(DMChannel)
        .options(selectinload(DMChannel.user_a), selectinload(DMChannel.user_b))
        .where(or_(DMChannel.user_a_id == current_user.id, DMChannel.user_b_id == current_user.id))
    )
    channels = result.scalars().all()

    convs: list[DMConversationRead] = []
    for ch in channels:
        other = ch.user_b if ch.user_a_id == current_user.id else ch.user_a
        msg_result = await db.execute(
            select(Message)
            .where(Message.channel_id == ch.channel_id, Message.is_deleted == False)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        last_msg = msg_result.scalar_one_or_none()
        convs.append(DMConversationRead(
            channel_id=ch.channel_id,
            other_user=UserRead.model_validate(other),
            last_message_at=last_msg.created_at if last_msg else None,
        ))

    convs.sort(
        key=lambda c: c.last_message_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return convs

ALLOWED_ATTACHMENT_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "audio/mpeg", "audio/ogg", "audio/wav",
}


@router.get("/{user_id}/channel")
async def get_or_create_dm_channel(user_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Get or create a shared DM channel for two users. Returns { channel_id }."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot DM yourself")

    # Normalise pair so (a,b) and (b,a) always map to the same row
    a, b = sorted([current_user.id, user_id])

    result = await db.execute(
        select(DMChannel).where(DMChannel.user_a_id == a, DMChannel.user_b_id == b)
    )
    existing = result.scalar_one_or_none()
    if existing:
        return {"channel_id": str(existing.channel_id)}

    # Create the backing Channel row (no server)
    channel = Channel(type=ChannelType.dm, title="dm")
    db.add(channel)
    await db.flush()

    dm_chan = DMChannel(channel_id=channel.id, user_a_id=a, user_b_id=b)
    db.add(dm_chan)
    await db.commit()
    return {"channel_id": str(channel.id)}

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

    # Validate magic bytes (rejects disguised executables / spoofed Content-Type headers)
    from app.utils.file_validation import verify_attachment_magic
    import filetype as _ft
    content = await verify_attachment_magic(file)

    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "bin"
    filename = f"dm_attachments/{dm_id}/{uuid.uuid4()}.{ext}"
    dest = os.path.join(settings.static_dir, filename)
    os.makedirs(os.path.dirname(dest), exist_ok=True)

    async with aiofiles.open(dest, "wb") as f:
        await f.write(content)

    kind = _ft.guess(content)
    file_type = kind.mime.split("/")[0] if kind else "image"
    db.add(DMAttachment(dm_id=dm_id, file_path=filename, file_type=file_type))
    await db.commit()
    db.expire_all()

    return await _get_dm_or_404(dm_id, db)
