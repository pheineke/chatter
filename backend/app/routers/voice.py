"""
Voice channel: WebSocket signaling relay + REST presence endpoint.

WebSocket: /ws/voice/{channel_id}?token=<JWT>
REST:      GET /channels/{channel_id}/voice/members

Signaling flow (all via the WebSocket):
──────────────────────────────────────
Client A wants to call Client B (both already in the same voice channel):

  A → server: {"type": "offer",  "to": "<B_user_id>", "sdp": "..."}
  server → B: {"type": "offer",  "from": "<A_user_id>", "sdp": "..."}

  B → server: {"type": "answer", "to": "<A_user_id>", "sdp": "..."}
  server → A: {"type": "answer", "from": "<B_user_id>", "sdp": "..."}

  A → server: {"type": "ice_candidate", "to": "<B_user_id>", "candidate": {...}}
  server → B: {"type": "ice_candidate", "from": "<A_user_id>", "candidate": {...}}

State-change messages (broadcast to all channel members):
  {"type": "mute",         "is_muted": true|false}
  {"type": "deafen",       "is_deafened": true|false}
  {"type": "screen_share", "enabled": true|false}
  {"type": "webcam",       "enabled": true|false}
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth import decode_access_token
from app.database import get_db
from app.schemas.voice import VoiceParticipantRead
from app.voice_manager import voice_manager
from app.ws_manager import manager as ws_manager
from models.channel import Channel, ChannelType
from models.server import ServerMember

router = APIRouter(tags=["voice"])

# ---------------------------------------------------------------------------
# Typed sets of relay and state-change message types
# ---------------------------------------------------------------------------
_RELAY_TYPES = {"offer", "answer", "ice_candidate"}
_STATE_TYPES = {"mute", "deafen", "screen_share", "webcam"}


# ---------------------------------------------------------------------------
# Auth helper (mirrors ws.py)
# ---------------------------------------------------------------------------

async def _authenticate_ws(ws: WebSocket, token: str) -> uuid.UUID | None:
    user_id = decode_access_token(token)
    if user_id is None:
        await ws.close(code=4001, reason="Invalid or expired token")
        return None
    return user_id


# ---------------------------------------------------------------------------
# REST: list voice participants
# ---------------------------------------------------------------------------

@router.get(
    "/channels/{channel_id}/voice/members",
    response_model=List[VoiceParticipantRead],
    summary="Current voice channel participants",
)
async def list_voice_members(channel_id: uuid.UUID):
    """Return the live participant list for a voice channel (reads from memory)."""
    return voice_manager.get_participants(channel_id)


@router.get(
    "/servers/{server_id}/voice-presence",
    response_model=Dict[str, List[VoiceParticipantRead]],
    summary="Voice presence for all channels in a server",
)
async def get_server_voice_presence(
    server_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Return a mapping of channel_id → [participants] for every voice channel
    in the server that has at least one active participant."""
    result = await db.execute(
        select(Channel).where(
            Channel.server_id == server_id,
            Channel.type == ChannelType.voice,
        )
    )
    voice_channels = result.scalars().all()
    return {
        str(ch.id): voice_manager.get_participants(ch.id)
        for ch in voice_channels
        if voice_manager.get_participants(ch.id)
    }


# ---------------------------------------------------------------------------
# WebSocket: voice signaling
# ---------------------------------------------------------------------------

@router.websocket("/ws/voice/{channel_id}")
async def voice_ws(
    channel_id: uuid.UUID,
    ws: WebSocket,
    token: str = Query(..., description="JWT access token"),
    db: AsyncSession = Depends(get_db),
):
    """
    Join a voice channel. Authentication and membership are verified before
    the connection is accepted.

    On connect the server sends:
        {"type": "voice.members", "data": [<participant>, ...]}

    Then broadcasts to others:
        {"type": "voice.user_joined", "data": <participant>}

    On disconnect broadcasts:
        {"type": "voice.user_left", "data": {"user_id": "..."}}
    """
    # --- Auth ---------------------------------------------------------------
    user_id = await _authenticate_ws(ws, token)
    if user_id is None:
        return

    # --- Channel + membership validation ------------------------------------
    ch_result = await db.execute(select(Channel).where(Channel.id == channel_id))
    channel = ch_result.scalar_one_or_none()
    if channel is None:
        await ws.close(code=4004, reason="Channel not found")
        return
    if channel.type != ChannelType.voice:
        await ws.close(code=4005, reason="Channel is not a voice channel")
        return
    mem_result = await db.execute(
        select(ServerMember).where(
            ServerMember.server_id == channel.server_id,
            ServerMember.user_id == user_id,
        )
    )
    if mem_result.scalar_one_or_none() is None:
        await ws.close(code=4003, reason="Not a member of this server")
        return

    # --- Connect (accepts the WebSocket) ------------------------------------
    await voice_manager.connect(channel_id, user_id, ws)

    # Notify all server members that this user joined this voice channel
    participant_data = voice_manager.get_participant(channel_id, user_id)
    if participant_data:
        await ws_manager.broadcast_server(
            channel.server_id,
            {
                "type": "voice.user_joined",
                "channel_id": str(channel_id),
                "data": participant_data,
            },
        )

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg: dict[str, Any] = json.loads(raw)
            except json.JSONDecodeError:
                continue  # ignore malformed messages

            msg_type = msg.get("type")
            if not isinstance(msg_type, str):
                continue

            # -- Signaling relay ------------------------------------------
            if msg_type in _RELAY_TYPES:
                to_raw = msg.get("to")
                if not to_raw:
                    continue
                try:
                    to_user_id = uuid.UUID(str(to_raw))
                except ValueError:
                    continue
                await voice_manager.relay(channel_id, user_id, to_user_id, msg)

            # -- State changes --------------------------------------------
            elif msg_type == "mute":
                val = msg.get("is_muted")
                if isinstance(val, bool):
                    await voice_manager.update_state(channel_id, user_id, is_muted=val)

            elif msg_type == "deafen":
                val = msg.get("is_deafened")
                if isinstance(val, bool):
                    await voice_manager.update_state(channel_id, user_id, is_deafened=val)

            elif msg_type == "screen_share":
                val = msg.get("enabled")
                if isinstance(val, bool):
                    await voice_manager.update_state(channel_id, user_id, is_sharing_screen=val)

            elif msg_type == "webcam":
                val = msg.get("enabled")
                if isinstance(val, bool):
                    await voice_manager.update_state(channel_id, user_id, is_sharing_webcam=val)

            # -- Unknown message types → silently ignore ------------------

    except WebSocketDisconnect:
        pass
    finally:
        await voice_manager.disconnect(channel_id, user_id)
        # Notify all server members that this user left this voice channel
        await ws_manager.broadcast_server(
            channel.server_id,
            {
                "type": "voice.user_left",
                "channel_id": str(channel_id),
                "data": {"user_id": str(user_id)},
            },
        )
