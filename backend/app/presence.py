"""
Presence helpers – broadcast user.status_changed to servers and friends.
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.ws_manager import manager
from models.server import ServerMember
from models.friend import FriendRequest, FriendRequestStatus


async def broadcast_presence(user_id: uuid.UUID, new_status: str, db: AsyncSession) -> None:
    """
    Emit a ``user.status_changed`` event to:
      - every server the user belongs to  (member list updates)
      - every accepted friend's personal WS room  (friend list updates)
    """
    event = {
        "type": "user.status_changed",
        "data": {"user_id": str(user_id), "status": new_status},
    }

    # Servers
    result = await db.execute(
        select(ServerMember.server_id).where(ServerMember.user_id == user_id)
    )
    for server_id in result.scalars().all():
        await manager.broadcast_server(server_id, event)

    # Friends' personal rooms
    result = await db.execute(
        select(FriendRequest).where(
            or_(FriendRequest.sender_id == user_id, FriendRequest.recipient_id == user_id),
            FriendRequest.status == FriendRequestStatus.accepted,
        )
    )
    for fr in result.scalars().all():
        friend_id = fr.recipient_id if fr.sender_id == user_id else fr.sender_id
        await manager.broadcast_user(friend_id, event)
