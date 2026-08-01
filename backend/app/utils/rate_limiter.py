"""Deprecated — merged into app.rate_limiter.

This module used to hold a second, independent in-memory-only rate limiter
(``image_limiter`` / ``profile_limiter``) that duplicated the Redis-backed
sliding-window limiter in ``app/rate_limiter.py``. Having two implementations
meant profile/avatar/banner limits didn't share state across worker
processes and never pruned stale per-user entries.

Everything has been consolidated into ``app/rate_limiter.py``:
  - ``rate_limit_profile_update``   (was ``profile_limiter``)
  - ``rate_limit_avatar_change``    (was ``image_limiter`` for avatars)
  - ``rate_limit_banner_change``    (was ``image_limiter`` for banners)
  - ``rate_limit_decoration_generate`` (was ``image_limiter`` for deco codes)

This file is kept only so a stray import doesn't hard-crash with an
unhelpful "no module named" error; it deliberately does not re-export the
old ``RateLimiter``/``image_limiter``/``profile_limiter`` names, since their
call signature (sync ``.check(key)``) is not compatible with the new async,
Redis-aware limiter. Import from ``app.rate_limiter`` instead.
"""

raise ImportError(
    "app.utils.rate_limiter has been removed. Import the equivalent "
    "async rate_limit_profile_update / rate_limit_avatar_change / "
    "rate_limit_banner_change / rate_limit_decoration_generate from "
    "app.rate_limiter instead."
)
