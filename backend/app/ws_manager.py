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

    async def broadcast_channel_except(
        self, channel_id: uuid.UUID, exclude: WebSocket, event: dict[str, Any]
    ) -> None:
        """Broadcast to a channel room, skipping one specific connection (the sender)."""
        payload = json.dumps(event, default=str)
        room = self.channel_room(channel_id)
        dead: list[WebSocket] = []
        for ws in list(self._rooms.get(room, [])):
            if ws is exclude:
                continue
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(room, ws)

    async def broadcast_server(self, server_id: uuid.UUID, event: dict[str, Any]) -> None:
        await self.broadcast(self.server_room(server_id), event)

    async def broadcast_user(self, user_id: uuid.UUID, event: dict[str, Any]) -> None:
        await self.broadcast(self.user_room(user_id), event)

    async def broadcast_to_users(
        self, user_ids: list[uuid.UUID], event: dict[str, Any]
    ) -> None:
        """Broadcast *event* to a list of user personal rooms.

        Serialises the payload exactly once and fans out to every connected
        socket across all supplied user rooms, avoiding the O(N) json.dumps
        overhead of calling broadcast_user() in a loop.
        """
        payload = json.dumps(event, default=str)
        dead: list[tuple[str, WebSocket]] = []
        for uid in user_ids:
            room = self.user_room(uid)
            for ws in list(self._rooms.get(room, [])):
                try:
                    await ws.send_text(payload)
                except Exception:
                    dead.append((room, ws))
        for room, ws in dead:
            await self.disconnect(room, ws)


# Singleton used throughout the application
manager = ConnectionManager()
