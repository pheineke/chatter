import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import selectinload

from app.dependencies import CurrentUser, DB
from app.rate_limiter import rate_limit_dm_channel
from app.schemas.message import DMConversationRead, DMReadStateRead
from app.schemas.user import UserRead, UserPublicRead
from app.ws_manager import manager
from models.block import UserBlock
from models.channel import Channel, ChannelType
from models.dm_channel import DMChannel
from models.dm_read_state import DMReadState
from models.friend import FriendRequest, FriendRequestStatus
from models.message import Message
from models.server import ServerMember
from models.user import DMPermission, User

router = APIRouter(prefix="/dms", tags=["direct_messages"])


class DMReadUpdate(BaseModel):
    last_read_at: datetime | None = None


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

    read_rows_result = await db.execute(
        select(DMReadState).where(
            DMReadState.user_id == current_user.id,
            DMReadState.channel_id.in_(channel_ids),
        )
    )
    read_map: dict[uuid.UUID, datetime] = {
        row.channel_id: row.last_read_at for row in read_rows_result.scalars().all()
    }

    # Count unread messages per channel: count(*) where created_at > last_read_at
    unread_counts_result = await db.execute(
        select(Message.channel_id, func.count(Message.id).label("cnt"))
        .join(DMReadState, and_(
            DMReadState.channel_id == Message.channel_id,
            DMReadState.user_id == current_user.id
        ), isouter=True)
        .where(
            Message.channel_id.in_(channel_ids),
            Message.is_deleted == False,
            Message.created_at > func.coalesce(DMReadState.last_read_at, datetime.min)
        )
        .group_by(Message.channel_id)
    )
    unread_map: dict[uuid.UUID, int] = {
        row.channel_id: row.cnt for row in unread_counts_result.all()
    }

    convs: list[DMConversationRead] = []
    for ch in channels:
        other = ch.user_b if ch.user_a_id == current_user.id else ch.user_a
        last_msg = last_msg_map.get(ch.channel_id)
        convs.append(DMConversationRead(
            channel_id=ch.channel_id,
            other_user=UserPublicRead.model_validate(other),
            last_message_at=last_msg.created_at if last_msg else None,
            last_read_at=read_map.get(ch.channel_id),
            unread_count=unread_map.get(ch.channel_id, 0),
        ))

    convs.sort(
        key=lambda c: c.last_message_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return convs


@router.put("/channels/{channel_id}/read", response_model=DMReadStateRead)
async def mark_dm_read(
    channel_id: uuid.UUID,
    body: DMReadUpdate,
    current_user: CurrentUser,
    db: DB,
):
    dm_result = await db.execute(
        select(DMChannel).where(
            DMChannel.channel_id == channel_id,
            or_(DMChannel.user_a_id == current_user.id, DMChannel.user_b_id == current_user.id),
        )
    )
    dm_channel = dm_result.scalar_one_or_none()
    if not dm_channel:
        raise HTTPException(status_code=404, detail="DM channel not found")

    read_at = body.last_read_at or datetime.now(timezone.utc)

    state_result = await db.execute(
        select(DMReadState).where(
            DMReadState.user_id == current_user.id,
            DMReadState.channel_id == channel_id,
        )
    )
    state = state_result.scalar_one_or_none()
    if state:
        state.last_read_at = read_at
    else:
        state = DMReadState(user_id=current_user.id, channel_id=channel_id, last_read_at=read_at)
        db.add(state)

    await db.commit()
    payload = DMReadStateRead(channel_id=channel_id, last_read_at=read_at).model_dump(mode="json")
    await manager.broadcast_user(
        current_user.id,
        {
            "type": "dm.read_updated",
            "data": payload,
        },
    )
    return DMReadStateRead(**payload)


async def _check_if_friends(db: DB, user_a_id: uuid.UUID, user_b_id: uuid.UUID) -> bool:
    result = await db.execute(
        select(FriendRequest).where(
            FriendRequest.status == FriendRequestStatus.accepted,
            or_(
                and_(FriendRequest.sender_id == user_a_id, FriendRequest.recipient_id == user_b_id),
                and_(FriendRequest.sender_id == user_b_id, FriendRequest.recipient_id == user_a_id),
            ),
        )
    )
    return result.scalar_one_or_none() is not None


@router.get("/{user_id}/channel")
async def get_or_create_dm_channel(
    user_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    _rl: None = Depends(rate_limit_dm_channel),
):
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
    # Rule 1: Friends are always allowed.
    are_friends = await _check_if_friends(db, user_id, current_user.id)
    if are_friends:
        # Pass - friends bypass everything
        pass
    else:
        # Rule 2: Check shared servers and per-server privacy overrides
        # Get all shared servers
        shared_query = select(ServerMember).where(
            ServerMember.user_id == user_id,
            ServerMember.server_id.in_(
                select(ServerMember.server_id).where(ServerMember.user_id == current_user.id)
            )
        )
        shared_memberships = (await db.execute(shared_query)).scalars().all()
        
        # If no shared servers, check global permission only
        if not shared_memberships:
             if target_user.dm_permission != DMPermission.everyone:
                 raise HTTPException(status_code=403, detail="You do not share any servers with this user")
        
        # If shared servers exist, we must check if AT LEAST ONE "path" allows DMs.
        # A path exists if:
        # 1. The server membership has allow_dms=True
        # 2. OR (allow_dms is None AND global_permission != blocked)
        
        can_dm = False

        if target_user.dm_permission == DMPermission.friends_only:
             # If strictly friends-only and we aren't friends (checked above), blocked.
             # Unless there is a specific server override allowing it? 
             # Discord logic: "Allow DMs from server members" is the toggle.
             # If global is "Friends Only", server override ON allows DMs from that server's members.
             pass 
        
        # Simpler Logic: 
        # Iterate shared servers. 
        # If ANY shared server has allow_dms=True -> Allow
        # If ALL shared servers have allow_dms=False -> Block
        # If mix of None/False -> Fallback to global setting

        # Logic Matrix for a single shared server:
        # Override | Global         | Result
        # True     | *              | Allow
        # False    | *              | Block (for this server path)
        # None     | Everyone       | Allow
        # None     | Server Members | Allow
        # None     | Friends Only   | Block (since we passed friend check)

        for mem in shared_memberships:
            if mem.allow_dms is True:
                can_dm = True
                break
            if mem.allow_dms is None:
                # Fallback to global
                if target_user.dm_permission in [DMPermission.everyone, DMPermission.server_members_only]:
                    can_dm = True
                    break
        
        if not can_dm:
             raise HTTPException(status_code=403, detail="This user's privacy settings prevent you from sending a message.")

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
