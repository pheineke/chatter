import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import selectinload

from app.dependencies import CurrentUser, DB
from app.schemas.message import DMConversationRead
from app.schemas.user import UserRead
from models.block import UserBlock
from models.channel import Channel, ChannelType
from models.dm_channel import DMChannel
from models.friend import FriendRequest, FriendRequestStatus
from models.message import Message
from models.server import ServerMember
from models.user import DMPermission, User

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

    if not channels:
        return []

    # Bulk-load the last message per channel in a single query (avoids N+1)
    channel_ids = [ch.channel_id for ch in channels]
    last_sq = (
        select(Message.channel_id, func.max(Message.created_at).label("max_at"))
        .where(Message.channel_id.in_(channel_ids), Message.is_deleted == False)
        .group_by(Message.channel_id)
        .subquery()
    )
    last_msgs_result = await db.execute(
        select(Message).join(
            last_sq,
            and_(
                Message.channel_id == last_sq.c.channel_id,
                Message.created_at == last_sq.c.max_at,
            ),
        )
    )
    last_msg_map: dict[uuid.UUID, Message] = {
        m.channel_id: m for m in last_msgs_result.scalars().all()
    }

    convs: list[DMConversationRead] = []
    for ch in channels:
        other = ch.user_b if ch.user_a_id == current_user.id else ch.user_a
        last_msg = last_msg_map.get(ch.channel_id)
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

    # Fetch target user
    target_result = await db.execute(select(User).where(User.id == user_id))
    target_user = target_result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Check if either party has blocked the other
    block_result = await db.execute(
        select(UserBlock).where(
            or_(
                and_(UserBlock.blocker_id == current_user.id, UserBlock.blocked_id == user_id),
                and_(UserBlock.blocker_id == user_id, UserBlock.blocked_id == current_user.id),
            )
        ).limit(1)
    )
    if block_result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="You cannot send a direct message to this user")

    # Enforce the target user's DM permission
    if target_user.dm_permission != DMPermission.everyone:
        if target_user.dm_permission == DMPermission.friends_only:
            fr_result = await db.execute(
                select(FriendRequest).where(
                    FriendRequest.status == FriendRequestStatus.accepted,
                    or_(
                        and_(
                            FriendRequest.sender_id == current_user.id,
                            FriendRequest.recipient_id == user_id,
                        ),
                        and_(
                            FriendRequest.sender_id == user_id,
                            FriendRequest.recipient_id == current_user.id,
                        ),
                    ),
                )
            )
            if not fr_result.scalar_one_or_none():
                raise HTTPException(
                    status_code=403,
                    detail="This user only accepts direct messages from friends",
                )
        elif target_user.dm_permission == DMPermission.server_members_only:
            shared_result = await db.execute(
                select(ServerMember).where(
                    ServerMember.user_id == current_user.id,
                    ServerMember.server_id.in_(
                        select(ServerMember.server_id).where(ServerMember.user_id == user_id)
                    ),
                ).limit(1)
            )
            if not shared_result.scalar_one_or_none():
                raise HTTPException(
                    status_code=403,
                    detail="This user only accepts direct messages from people in shared servers",
                )

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
