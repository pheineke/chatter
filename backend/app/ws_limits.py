"""Per-socket limits for client → server WebSocket frames (security_pass S25).

Without them one client can push frames as fast as the connection allows:
each typing frame used to cost a DB query and a broadcast to the whole
channel, and each voice signaling frame a relay. Limits:

  * frame size: anything over MAX_FRAME_CHARS closes the socket (1009);
    uvicorn's own --ws-max-size (Dockerfile) stops bigger frames before
    they are even buffered;
  * frame rate: a token bucket per socket; a client that empties it closes
    with 1008 ("policy violation"). The frontend's useWebSocket reconnects
    with back-off, so a legitimate burst costs a reconnect, not the session.
"""
from __future__ import annotations

import time

from fastapi import WebSocket

MAX_FRAME_CHARS = 64 * 1024

CLOSE_TOO_BIG = 1009
CLOSE_POLICY = 1008


class FrameLimiter:
    """Token bucket: *rate* frames per second on average, bursts up to *burst*."""

    def __init__(self, rate: float, burst: int):
        self.rate = rate
        self.burst = burst
        self._tokens = float(burst)
        self._last = time.monotonic()

    def allow(self) -> bool:
        now = time.monotonic()
        self._tokens = min(self.burst, self._tokens + (now - self._last) * self.rate)
        self._last = now
        if self._tokens < 1:
            return False
        self._tokens -= 1
        return True


# Chat/server/bot sockets only carry typing and pings; voice also carries
# WebRTC signaling (ICE candidates arrive in bursts) and speaking updates.
def event_socket_limiter() -> FrameLimiter:
    return FrameLimiter(rate=5, burst=20)


def voice_socket_limiter() -> FrameLimiter:
    return FrameLimiter(rate=50, burst=400)


async def admit_frame(ws: WebSocket, text: str, limiter: FrameLimiter) -> bool:
    """Check one received frame. On a violation, close *ws* and return False;
    the caller must then stop its receive loop."""
    if len(text) > MAX_FRAME_CHARS:
        await _close(ws, CLOSE_TOO_BIG, "Message too big")
        return False
    if not limiter.allow():
        await _close(ws, CLOSE_POLICY, "Too many messages")
        return False
    return True


async def _close(ws: WebSocket, code: int, reason: str) -> None:
    try:
        await ws.close(code=code, reason=reason)
    except Exception:
        pass


class Throttle:
    """Let an action through at most once per *interval* seconds."""

    def __init__(self, interval: float):
        self.interval = interval
        self._next = 0.0

    def ready(self) -> bool:
        now = time.monotonic()
        if now < self._next:
            return False
        self._next = now + self.interval
        return True
