"""
WebSocket connection manager for real-time events.

Rooms:
  - channel:<channel_id>  – messages in a text channel
  - server:<server_id>    – server-level events (member join/leave, role changes)
  - user:<user_id>        – personal events (DMs, friend requests, status)
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        # room_key -> set of WebSocket connections
        self._rooms: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()
        # user_id (str) -> last non-offline status chosen by the user
        # Used to restore the correct status when they reconnect.
        self._preferred_status: dict[str, str] = {}

    # ------------------------------------------------------------------
    # Preferred-status helpers
    # ------------------------------------------------------------------

    def set_preferred_status(self, user_id: str, status: str) -> None:
        """Record the user's chosen status (anything except 'offline')."""
        if status != "offline":
            self._preferred_status[user_id] = status

    def get_preferred_status(self, user_id: str) -> str:
        """Return the user's preferred online status, defaulting to 'online'."""
        return self._preferred_status.get(user_id, "online")

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    async def connect(self, room: str, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._rooms[room].add(ws)
        logger.debug("WS connected room=%s total=%d", room, len(self._rooms[room]))

    async def disconnect(self, room: str, ws: WebSocket) -> None:
        async with self._lock:
            self._rooms[room].discard(ws)
            if not self._rooms[room]:
                del self._rooms[room]
        logger.debug("WS disconnected room=%s", room)

    # ------------------------------------------------------------------
    # Broadcast helpers (by room key)
    # ------------------------------------------------------------------

    async def broadcast(self, room: str, event: dict[str, Any]) -> None:
        payload = json.dumps(event, default=str)
        dead: list[WebSocket] = []
        for ws in list(self._rooms.get(room, [])):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(room, ws)

    # ------------------------------------------------------------------
    # Typed room helpers
    # ------------------------------------------------------------------

    @staticmethod
    def channel_room(channel_id: uuid.UUID) -> str:
        return f"channel:{channel_id}"

    @staticmethod
    def server_room(server_id: uuid.UUID) -> str:
        return f"server:{server_id}"

    @staticmethod
    def user_room(user_id: uuid.UUID) -> str:
        return f"user:{user_id}"

    async def broadcast_channel(self, channel_id: uuid.UUID, event: dict[str, Any]) -> None:
        await self.broadcast(self.channel_room(channel_id), event)

    async def broadcast_server(self, server_id: uuid.UUID, event: dict[str, Any]) -> None:
        await self.broadcast(self.server_room(server_id), event)

    async def broadcast_user(self, user_id: uuid.UUID, event: dict[str, Any]) -> None:
        await self.broadcast(self.user_room(user_id), event)


# Singleton used throughout the application
manager = ConnectionManager()
