"""Keep open WebSockets in line with current access (security_pass S11).

WebSocket auth and the membership/permission checks run once, at connect
time. Without this module a socket stays subscribed after the session is
revoked, the user is kicked/banned, or a channel is made private, and keeps
receiving events it should no longer see.

Call these *after* the DB change is committed.

Close codes (the frontend's useWebSocket reacts to them):
  4001  session / token revoked → client tries a refresh, else goes to login
  4003  no longer allowed here  → client stops reconnecting to this socket

Multi-room sockets (the bot gateway, flagged ``ws.state.multi_room``) are
unsubscribed from the affected rooms instead of being closed, because the
same connection also carries events for other servers.
"""
from __future__ import annotations

import logging
import uuid

from sqlalchemy import select

from app.authz import visible_channel_ids
from app.voice_manager import voice_manager
from app.ws_auth import identity_of
from app.ws_manager import manager
from models.channel import Channel

logger = logging.getLogger(__name__)

CLOSE_REVOKED = 4001
CLOSE_FORBIDDEN = 4003


def _is_multi_room(ws) -> bool:
    return bool(getattr(ws.state, "multi_room", False))


async def _close_matching(predicate, code: int, reason: str) -> int:
    """Close every socket (event rooms and voice) whose identity matches."""
    targets = {ws for _, ws in manager.sockets_in() if (i := identity_of(ws)) and predicate(i)}
    voice = {ws for _, _, ws in voice_manager.participant_sockets() if (i := identity_of(ws)) and predicate(i)}
    for ws in targets:
        await manager.drop(ws, code, reason)
    for ws in voice - targets:
        try:
            await ws.close(code=code, reason=reason)
        except Exception:
            pass
    return len(targets | voice)


# ── Sessions & tokens ─────────────────────────────────────────────────────────

async def close_session(session_id: uuid.UUID) -> int:
    return await _close_matching(lambda i: i.session_id == session_id, CLOSE_REVOKED, "Session revoked")


async def close_api_token(token_id: uuid.UUID) -> int:
    return await _close_matching(lambda i: i.api_token_id == token_id, CLOSE_REVOKED, "Token revoked")


async def close_user_sessions(user_id: uuid.UUID, *, keep_session: uuid.UUID | None = None) -> int:
    """Close all JWT-session sockets of *user_id* except *keep_session*.
    (API-token sockets are left alone; they have their own revocation.)"""
    return await _close_matching(
        lambda i: i.user_id == user_id and i.session_id is not None and i.session_id != keep_session,
        CLOSE_REVOKED,
        "Session revoked",
    )


# ── Servers & channels ───────────────────────────────────────────────────────

async def _server_channel_ids(server_id: uuid.UUID, db) -> set[uuid.UUID]:
    rows = await db.execute(select(Channel.id).where(Channel.server_id == server_id))
    return set(rows.scalars().all())


async def evict_from_server(server_id: uuid.UUID, user_id: uuid.UUID, db) -> None:
    """User left / was kicked / was banned: drop their sockets for this server."""
    channel_ids = await _server_channel_ids(server_id, db)
    rooms = {manager.server_room(server_id)} | {manager.channel_room(c) for c in channel_ids}

    for _room, ws in manager.sockets_in(rooms):
        identity = identity_of(ws)
        if identity is None or identity.user_id != user_id:
            continue
        if _is_multi_room(ws):
            await manager.unsubscribe(ws, rooms)
        else:
            await manager.drop(ws, CLOSE_FORBIDDEN, "Removed from server")

    for _cid, uid, ws in voice_manager.participant_sockets(channel_ids):
        if uid == user_id:
            try:
                await ws.close(code=CLOSE_FORBIDDEN, reason="Removed from server")
            except Exception:
                pass


async def revalidate_server(server_id: uuid.UUID, db) -> int:
    """Permissions in *server_id* changed (overwrite, role assignment, role
    admin flag, role deleted). Re-check every connected channel/voice socket
    and drop those whose owner can no longer view the channel."""
    channel_ids = await _server_channel_ids(server_id, db)
    if not channel_ids:
        return 0
    room_to_channel = {manager.channel_room(c): c for c in channel_ids}
    chat = [
        (room_to_channel[room], ws)
        for room, ws in manager.sockets_in(set(room_to_channel))
    ]
    voice = [(cid, ws) for cid, _uid, ws in voice_manager.participant_sockets(channel_ids)]

    users = {i.user_id for _, ws in chat + voice if (i := identity_of(ws))}
    allowed: dict[uuid.UUID, set[uuid.UUID]] = {}
    for uid in users:
        allowed[uid] = await visible_channel_ids(server_id, list(channel_ids), uid, db)

    dropped = 0
    for cid, ws in chat:
        identity = identity_of(ws)
        if identity and cid not in allowed.get(identity.user_id, set()):
            await manager.drop(ws, CLOSE_FORBIDDEN, "Missing access to this channel")
            dropped += 1
    for cid, ws in voice:
        identity = identity_of(ws)
        if identity and cid not in allowed.get(identity.user_id, set()):
            try:
                await ws.close(code=CLOSE_FORBIDDEN, reason="Missing access to this channel")
            except Exception:
                pass
            dropped += 1
    if dropped:
        logger.info("Dropped %d socket(s) after permission change in server %s", dropped, server_id)
    return dropped
