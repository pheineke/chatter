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

from app.auth import decode_access_token, hash_api_token
from app.database import AsyncSessionLocal
from app.presence import broadcast_presence
from app.ws_manager import manager
from models.api_token import ApiToken
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
    Validate the token query param.  Accepts either a short-lived JWT or a
    personal API token (``<prefix8>.<body>`` format).
    Returns the user_id UUID or closes the websocket with 4001 if invalid.
    """
    # Try JWT first
    user_id = decode_access_token(token)
    if user_id is not None:
        return user_id

    # Fall back to personal API token (contains a dot separator)
    if "." in token:
        token_hash = hash_api_token(token)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(ApiToken).where(
                    ApiToken.token_hash == token_hash,
                    ApiToken.revoked.is_(False),
                )
            )
            api_token = result.scalar_one_or_none()
        if api_token is not None:
            return api_token.user_id

    await ws.close(code=4001, reason="Invalid or expired token")
    return None  # type: ignore[return-value]


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
        # Handle client messages (typing events, pings)
        while True:
            try:
                text = await ws.receive_text()
            except Exception:
                break
            try:
                data = json.loads(text)
                if isinstance(data, dict) and data.get("type") == "typing":
                    # Fan out typing indicator to all OTHER members of the channel room
                    async with AsyncSessionLocal() as db:
                        user = await db.get(User, user_id)
                        username = user.username if user else str(user_id)
                    await manager.broadcast_channel_except(
                        channel_id,
                        ws,
                        {"type": "typing.start", "data": {"user_id": str(user_id), "username": username}},
                    )
            except (json.JSONDecodeError, Exception):
                pass
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
    # preferred_status is the DB-persisted status the user last chose.
    # If they chose 'offline' (invisible mode), we honour it — no broadcast needed.
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        if user and user.status != user.preferred_status:
            restore_to = user.preferred_status.value   # capture before commit expires attrs
            user.status = user.preferred_status
            db.add(user)
            await db.commit()
            # Inform the reconnecting client itself so its UI reflects the restored status
            await manager.broadcast_user(
                user_id,
                {"type": "user.status_changed", "data": {"user_id": str(user_id), "status": restore_to}},
            )
            # Inform servers and friends; hide_status users always appear offline to others
            broadcast_status = "offline" if user.hide_status else restore_to
            await broadcast_presence(user_id, broadcast_status, db)
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

        # --- set offline when last connection for this user drops -------
        # Do NOT touch preferred_status — it persists for the next reconnect.
        if not manager._rooms.get(room):
            async with AsyncSessionLocal() as db:
                user = await db.get(User, user_id)
                if user and user.status != UserStatus.offline:
                    user.status = UserStatus.offline
                    db.add(user)
                    await db.commit()
                    await broadcast_presence(user_id, "offline", db)


# ---------------------------------------------------------------------------
# Bot gateway  (/ws/bot)
# ---------------------------------------------------------------------------

@router.websocket("/ws/bot")
async def bot_gateway_ws(
    ws: WebSocket,
    token: str = Query(..., description="Personal API token or JWT"),
):
    """
    Bot / automation gateway.  A single connection receives:
      - All personal events (dm.created, friend_request.*, user.status_changed)
      - Channel & server events for every server the token owner is a member of.

    Clients MUST send ``{"type": "ping"}`` at least every 60 s; the server
    replies with ``{"type": "pong"}``.  The connection is closed after
    ``_HEARTBEAT_TIMEOUT`` seconds of silence.
    """
    user_id = await _authenticate_ws(ws, token)
    if user_id is None:
        return

    # Gather all rooms: personal + all servers the user belongs to
    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            select(ServerMember.server_id).where(ServerMember.user_id == user_id)
        )
        server_ids = [r[0] for r in rows.all()]

    rooms: list[str] = [manager.user_room(user_id)]
    for sid in server_ids:
        rooms.append(manager.server_room(sid))

    for room in rooms:
        await manager.connect(room, ws)

    try:
        while True:
            try:
                text = await asyncio.wait_for(ws.receive_text(), timeout=_HEARTBEAT_TIMEOUT)
            except asyncio.TimeoutError:
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
        for room in rooms:
            await manager.disconnect(room, ws)
