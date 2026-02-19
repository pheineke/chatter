"""
In-memory voice channel manager.

Responsibilities:
  - Track which users are present in each voice channel.
  - Relay peer-to-peer WebRTC signaling messages (offer / answer / ICE).
  - Broadcast state-change events (mute, deafen, screen-share, webcam).

No database persistence — presence is ephemeral and resets when the server
restarts (consistent with how voice channels work in Discord-style apps).

Room key: voice:<channel_id>

Client → server message types (JSON over WebSocket):
    {"type": "offer",         "to": "<user_id>",  "sdp": "..."}
    {"type": "answer",        "to": "<user_id>",  "sdp": "..."}
    {"type": "ice_candidate", "to": "<user_id>",  "candidate": {...}}
    {"type": "mute",          "is_muted": true}
    {"type": "deafen",        "is_deafened": true}
    {"type": "screen_share",  "enabled": true}
    {"type": "webcam",        "enabled": true}

Server → client event types:
    {"type": "voice.members",       "data": [<participant>, ...]}   # on join
    {"type": "voice.user_joined",   "data": <participant>}
    {"type": "voice.user_left",     "data": {"user_id": "..."}}
    {"type": "voice.state_changed", "data": <participant>}
    # Relayed signaling (from field added by server):
    {"type": "offer",         "from": "<user_id>", "sdp": "..."}
    {"type": "answer",        "from": "<user_id>", "sdp": "..."}
    {"type": "ice_candidate", "from": "<user_id>", "candidate": {...}}
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


@dataclass
class VoiceParticipant:
    user_id: uuid.UUID
    ws: WebSocket
    is_muted: bool = False
    is_deafened: bool = False
    is_sharing_screen: bool = False
    is_sharing_webcam: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_id": str(self.user_id),
            "is_muted": self.is_muted,
            "is_deafened": self.is_deafened,
            "is_sharing_screen": self.is_sharing_screen,
            "is_sharing_webcam": self.is_sharing_webcam,
        }


class VoiceManager:
    def __init__(self) -> None:
        # channel_id -> {user_id -> VoiceParticipant}
        self._rooms: dict[uuid.UUID, dict[uuid.UUID, VoiceParticipant]] = {}
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    async def connect(self, channel_id: uuid.UUID, user_id: uuid.UUID, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            if channel_id not in self._rooms:
                self._rooms[channel_id] = {}
            participant = VoiceParticipant(user_id=user_id, ws=ws)
            self._rooms[channel_id][user_id] = participant

        logger.debug("Voice joined channel=%s user=%s", channel_id, user_id)

        # 1. Send current member list to the new joiner
        await self._send(ws, {
            "type": "voice.members",
            "data": [p.to_dict() for p in self._rooms[channel_id].values()],
        })

        # 2. Broadcast join event to everyone else in the channel
        await self._broadcast_except(
            channel_id,
            exclude_user=user_id,
            event={"type": "voice.user_joined", "data": participant.to_dict()},
        )

    async def disconnect(self, channel_id: uuid.UUID, user_id: uuid.UUID) -> None:
        async with self._lock:
            room = self._rooms.get(channel_id, {})
            room.pop(user_id, None)
            if not room:
                self._rooms.pop(channel_id, None)

        logger.debug("Voice left channel=%s user=%s", channel_id, user_id)
        await self._broadcast_all(
            channel_id,
            event={"type": "voice.user_left", "data": {"user_id": str(user_id)}},
        )

    # ------------------------------------------------------------------
    # State updates (mute / deafen / screen-share / webcam)
    # ------------------------------------------------------------------

    async def update_state(
        self,
        channel_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        is_muted: bool | None = None,
        is_deafened: bool | None = None,
        is_sharing_screen: bool | None = None,
        is_sharing_webcam: bool | None = None,
    ) -> None:
        participant = self._rooms.get(channel_id, {}).get(user_id)
        if participant is None:
            return
        if is_muted is not None:
            participant.is_muted = is_muted
        if is_deafened is not None:
            participant.is_deafened = is_deafened
        if is_sharing_screen is not None:
            participant.is_sharing_screen = is_sharing_screen
        if is_sharing_webcam is not None:
            participant.is_sharing_webcam = is_sharing_webcam

        await self._broadcast_all(
            channel_id,
            event={"type": "voice.state_changed", "data": participant.to_dict()},
        )

    # ------------------------------------------------------------------
    # P2P signaling relay
    # ------------------------------------------------------------------

    async def relay(
        self,
        channel_id: uuid.UUID,
        from_user_id: uuid.UUID,
        to_user_id: uuid.UUID,
        payload: dict[str, Any],
    ) -> None:
        """Forward a signaling message from one peer to another."""
        target = self._rooms.get(channel_id, {}).get(to_user_id)
        if target is None:
            return
        envelope = {**payload, "from": str(from_user_id)}
        await self._send(target.ws, envelope)

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    def get_participants(self, channel_id: uuid.UUID) -> list[dict[str, Any]]:
        return [p.to_dict() for p in self._rooms.get(channel_id, {}).values()]

    def get_channel_ids(self) -> list[uuid.UUID]:
        return list(self._rooms.keys())

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _send(self, ws: WebSocket, event: dict[str, Any]) -> None:
        try:
            await ws.send_text(json.dumps(event, default=str))
        except Exception as exc:
            logger.debug("Voice _send failed: %s", exc)

    async def _broadcast_all(self, channel_id: uuid.UUID, event: dict[str, Any]) -> None:
        for participant in list(self._rooms.get(channel_id, {}).values()):
            await self._send(participant.ws, event)

    async def _broadcast_except(
        self, channel_id: uuid.UUID, exclude_user: uuid.UUID, event: dict[str, Any]
    ) -> None:
        for uid, participant in list(self._rooms.get(channel_id, {}).items()):
            if uid != exclude_user:
                await self._send(participant.ws, event)


# Singleton used throughout the application
voice_manager = VoiceManager()
