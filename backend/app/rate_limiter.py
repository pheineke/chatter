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
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException

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
