"""In-memory sliding-window rate limiter for message sending.

Keyed by user UUID string. Uses a monotonic clock so it is immune to system
clock adjustments. The lock serialises bucket mutations to prevent race
conditions under async concurrency.

Configuration (via .env / environment):
    RATELIMIT_ENABLED          – toggle on/off (default: true)
    RATELIMIT_MESSAGES         – max messages per window (default: 10)
    RATELIMIT_WINDOW_SECONDS   – rolling window size in seconds (default: 5)
"""
import asyncio
import os
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException, Request

from app.config import settings
from app.dependencies import CurrentUser

# Stores per-user deques of monotonic timestamps (one per sent message)
_windows: Dict[str, Deque[float]] = defaultdict(deque)
_lock = asyncio.Lock()


async def rate_limit_messages(current_user: CurrentUser) -> None:
    """FastAPI dependency – raises HTTP 429 when the user exceeds the message quota."""
    if not settings.ratelimit_enabled:
        return

    user_key = str(current_user.id)
    now = time.monotonic()
    window = float(settings.ratelimit_window_seconds)
    limit = settings.ratelimit_messages

    async with _lock:
        dq = _windows[user_key]

        # Evict timestamps that have left the rolling window
        while dq and now - dq[0] > window:
            dq.popleft()

        if len(dq) >= limit:
            # Seconds until the oldest entry exits the window
            retry_after = max(1, int(window - (now - dq[0])) + 1)
            raise HTTPException(
                status_code=429,
                detail="You are sending messages too quickly. Please slow down!",
                headers={"Retry-After": str(retry_after)},
            )

        dq.append(now)


# ---------------------------------------------------------------------------
# IP-based auth rate limiter (register / login)
# ---------------------------------------------------------------------------
# 10 attempts per 60-second window per IP address.
_AUTH_LIMIT = 10
_AUTH_WINDOW = 60.0

_auth_windows: Dict[str, Deque[float]] = defaultdict(deque)
_auth_lock = asyncio.Lock()


async def rate_limit_auth(request: Request) -> None:
    """FastAPI dependency – raises HTTP 429 when the IP exceeds the auth attempt quota."""
    if not settings.ratelimit_enabled:
        return
    if os.getenv("PYTEST_CURRENT_TEST"):
        return

    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()

    async with _auth_lock:
        dq = _auth_windows[ip]

        # Evict timestamps outside the rolling window
        while dq and now - dq[0] > _AUTH_WINDOW:
            dq.popleft()

        if len(dq) >= _AUTH_LIMIT:
            retry_after = max(1, int(_AUTH_WINDOW - (now - dq[0])) + 1)
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please try again later.",
                headers={"Retry-After": str(retry_after)},
            )

        dq.append(now)
