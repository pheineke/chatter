import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from app.dependencies import CurrentUser, DB
from app.schemas.message import DMConversationRead
from app.schemas.user import UserRead
from models.channel import Channel, ChannelType
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
    return {"channel_id": str(channel.id)}
