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

import asyncio
import json
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy import select

from app.auth import decode_access_token
from app.database import AsyncSessionLocal
from app.presence import broadcast_presence
from app.ws_manager import manager
from models.server import ServerMember
from models.user import User, UserStatus

# How long to wait for a heartbeat before closing the connection (seconds).
_HEARTBEAT_TIMEOUT = 90

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
      - voice.user_joined
      - voice.user_left
      - voice.state_changed
    """
    user_id = await _authenticate_ws(ws, token)
    if user_id is None:
        return

    # Verify caller is a member – use a short-lived session so the DB
    # connection is released before the long-running receive loop.
    async with AsyncSessionLocal() as db:
        row = await db.execute(
            select(ServerMember).where(
                ServerMember.server_id == server_id,
                ServerMember.user_id == user_id,
            )
        )
        is_member = row.scalar_one_or_none() is not None

    if not is_member:
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

    Clients must send {"type": "ping"} at least every 60 s; the server
    replies with {"type": "pong"}.  When the connection drops or the
    heartbeat times out the user's status is set to offline and the
    change is broadcast to servers and friends.

    DB connections are opened only for the brief setup and teardown steps
    so the pool is not exhausted by long-lived WebSocket connections.
    """
    user_id = await _authenticate_ws(ws, token)
    if user_id is None:
        return

    room = manager.user_room(user_id)
    await manager.connect(room, ws)

    # --- restore preferred status on connect (short-lived session) -----
    restore = manager.get_preferred_status(str(user_id))
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        if user and user.status == UserStatus.offline:
            user.status = UserStatus(restore)
            db.add(user)
            await db.commit()
            await broadcast_presence(user_id, restore, db)
    # db connection returned to pool here ^

    try:
        while True:
            try:
                text = await asyncio.wait_for(ws.receive_text(), timeout=_HEARTBEAT_TIMEOUT)
            except asyncio.TimeoutError:
                # Client stopped sending pings — treat as disconnect
                break
            try:
                data = json.loads(text)
                if isinstance(data, dict) and data.get("type") == "ping":
                    await ws.send_text('{"type":"pong"}')
            except (json.JSONDecodeError, Exception):
                pass
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(room, ws)

        # --- set offline (short-lived session) --------------------------
        if not manager._rooms.get(room):
            async with AsyncSessionLocal() as db:
                user = await db.get(User, user_id)
                if user and user.status != UserStatus.offline:
                    user.status = UserStatus.offline
                    db.add(user)
                    await db.commit()
                    await broadcast_presence(user_id, "offline", db)
