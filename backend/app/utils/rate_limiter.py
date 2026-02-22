"""In-memory sliding-window rate limiter for profile-update endpoints.

Two shared instances are exported:
  - ``image_limiter``   : 2 changes per 10 minutes  (avatar / banner)
  - ``profile_limiter`` : 5 changes per 10 minutes  (display-name fields)
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from threading import Lock


class RateLimiter:
    """Thread-safe sliding-window rate limiter."""

    def __init__(self, max_calls: int, window_seconds: int) -> None:
        self.max_calls = max_calls
        self.window = window_seconds
        self._log: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def check(self, key: str) -> tuple[bool, int]:
        """Check whether *key* is within its limit.

        Consumes one slot and returns ``(True, 0)`` when allowed.
        Returns ``(False, retry_after_seconds)`` without consuming a slot
        when the limit has been reached.
        """
        now = datetime.now(timezone.utc).timestamp()
        cutoff = now - self.window
        with self._lock:
            calls = [t for t in self._log[key] if t > cutoff]
            if len(calls) >= self.max_calls:
                # Oldest entry in the window tells us when a slot reopens
                retry_after = int(calls[0] - cutoff) + 1
                self._log[key] = calls
                return False, retry_after
            calls.append(now)
            self._log[key] = calls
            return True, 0


# ---------------------------------------------------------------------------
# Shared instances
# ---------------------------------------------------------------------------

#: Avatar and banner changes: max 2 per 10 minutes per user.
image_limiter = RateLimiter(max_calls=2, window_seconds=600)

#: Bio / pronouns changes: max 5 per 10 minutes per user.
profile_limiter = RateLimiter(max_calls=5, window_seconds=600)
