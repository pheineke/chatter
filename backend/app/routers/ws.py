"""
WebSocket endpoints for real-time event streaming.

Authentication uses a short-lived JWT passed as the `token` query parameter
because browsers cannot set custom headers on WebSocket connections.

Event envelope:
    {
        "type": "<resource>.<action>",  # e.g. "message.created"
        "data": { ... }                 # resource representation
    }

Clients connect to one of:
    /ws/channels/{channel_id}   – text-channel message events
    /ws/servers/{server_id}     – server-level events (membership, roles)
    /ws/me                      – personal events (DMs, friend requests, status)
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import decode_access_token
from app.database import AsyncSessionLocal
from app.ws_manager import manager
from models.server import ServerMember
from sqlalchemy import select

router = APIRouter(tags=["websocket"])


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

async def _authenticate_ws(ws: WebSocket, token: str) -> uuid.UUID:
    """
    Validate the JWT token query param.
    Returns the user_id UUID or closes the websocket with 4001 if invalid.
    """
    user_id = decode_access_token(token)
    if user_id is None:
        await ws.close(code=4001, reason="Invalid or expired token")
        return None  # type: ignore[return-value]
    return user_id


# ---------------------------------------------------------------------------
# Channel events
# ---------------------------------------------------------------------------

@router.websocket("/ws/channels/{channel_id}")
async def channel_ws(
    channel_id: uuid.UUID,
    ws: WebSocket,
    token: str = Query(..., description="JWT access token"),
):
    """
    Subscribe to all events in a text channel:
      - message.created
      - message.updated
      - message.deleted
      - reaction.added
      - reaction.removed
    """
    user_id = await _authenticate_ws(ws, token)
    if user_id is None:
        return

    room = manager.channel_room(channel_id)
    await manager.connect(room, ws)
    try:
        # Keep alive – drain any client pings / close frames
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(room, ws)


# ---------------------------------------------------------------------------
# Server events
# ---------------------------------------------------------------------------

@router.websocket("/ws/servers/{server_id}")
async def server_ws(
    server_id: uuid.UUID,
    ws: WebSocket,
    token: str = Query(..., description="JWT access token"),
):
    """
    Subscribe to server-level events:
      - server.member_joined
      - server.member_left
      - server.member_kicked
      - role.created
      - role.updated
      - role.deleted
      - role.assigned
    """
    user_id = await _authenticate_ws(ws, token)
    if user_id is None:
        return

    # Verify caller is a member of the server
    async with AsyncSessionLocal() as db:
        row = await db.execute(
            select(ServerMember).where(
                ServerMember.server_id == server_id,
                ServerMember.user_id == user_id,
            )
        )
        if row.scalar_one_or_none() is None:
            await ws.close(code=4003, reason="Not a member of this server")
            return

    room = manager.server_room(server_id)
    await manager.connect(room, ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(room, ws)


# ---------------------------------------------------------------------------
# Personal events
# ---------------------------------------------------------------------------

@router.websocket("/ws/me")
async def personal_ws(
    ws: WebSocket,
    token: str = Query(..., description="JWT access token"),
):
    """
    Subscribe to personal events:
      - dm.created
      - dm.deleted
      - friend_request.received
      - friend_request.accepted
      - friend_request.declined
      - user.status_changed
    """
    user_id = await _authenticate_ws(ws, token)
    if user_id is None:
        return

    room = manager.user_room(user_id)
    await manager.connect(room, ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(room, ws)
