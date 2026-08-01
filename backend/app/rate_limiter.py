"""Rate limiting helpers with Redis-backed shared state and in-memory fallback.

When `RATELIMIT_REDIS_URL` is configured and Redis is reachable, limits are
enforced globally across workers/processes. Otherwise, the module falls back to
in-memory deques (single-process semantics).
"""
from __future__ import annotations

import asyncio
import os
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException, Request

from app.config import settings
from app.dependencies import CurrentUser

try:
    import redis.asyncio as redis_async
except Exception:  # pragma: no cover
    redis_async = None


# In-memory fallback buckets
_windows: Dict[str, Deque[float]] = defaultdict(deque)
_lock = asyncio.Lock()

_slowmode_last: Dict[str, Dict[str, float]] = defaultdict(dict)
_slowmode_lock = asyncio.Lock()

# Redis client state
_redis_client = None
_redis_init_lock = asyncio.Lock()
_redis_init_done = False


async def _get_redis_client():
    global _redis_client, _redis_init_done
    if _redis_init_done:
        return _redis_client

    async with _redis_init_lock:
        if _redis_init_done:
            return _redis_client

        redis_url = settings.ratelimit_redis_url
        if not redis_url or redis_async is None:
            _redis_init_done = True
            _redis_client = None
            return None

        try:
            client = redis_async.from_url(redis_url, decode_responses=True)
            await client.ping()
            _redis_client = client
        except Exception:
            _redis_client = None

        _redis_init_done = True
        return _redis_client


async def _check_sliding_window(key: str, limit: int, window_seconds: float) -> tuple[bool, int]:
    """Return (allowed, retry_after_seconds)."""
    client = await _get_redis_client()

    if client is not None:
        now_ms = int(time.time() * 1000)
        window_ms = int(window_seconds * 1000)
        redis_key = f"rl:{key}"
        member = f"{now_ms}-{time.monotonic_ns()}"

        async with client.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(redis_key, 0, now_ms - window_ms)
            pipe.zadd(redis_key, {member: now_ms})
            pipe.zcard(redis_key)
            pipe.pexpire(redis_key, window_ms + 5000)
            _, _, count, _ = await pipe.execute()

        if count > limit:
            await client.zrem(redis_key, member)
            oldest = await client.zrange(redis_key, 0, 0, withscores=True)
            if oldest:
                oldest_ms = int(oldest[0][1])
                retry_after = max(1, int((oldest_ms + window_ms - now_ms) / 1000) + 1)
            else:
                retry_after = 1
            return False, retry_after

        return True, 0

    # In-memory fallback
    now = time.monotonic()
    async with _lock:
        dq = _windows[key]
        while dq and now - dq[0] > window_seconds:
            dq.popleft()
        if len(dq) >= limit:
            retry_after = max(1, int(window_seconds - (now - dq[0])) + 1)
            return False, retry_after
        dq.append(now)
    return True, 0


async def check_and_set_slowmode(channel_key: str, user_key: str, delay_seconds: int) -> int:
    """Return retry_after seconds when blocked, otherwise 0 and record the send."""
    if delay_seconds <= 0:
        return 0

    client = await _get_redis_client()
    now = time.time()

    if client is not None:
        key = f"slowmode:{channel_key}:{user_key}"
        last_raw = await client.get(key)
        if last_raw is not None:
            try:
                last = float(last_raw)
            except ValueError:
                last = 0.0
            elapsed = now - last
            if elapsed < delay_seconds:
                return max(1, int(delay_seconds - elapsed) + 1)

        await client.set(key, str(now), ex=delay_seconds + 5)
        return 0

    # In-memory fallback
    async with _slowmode_lock:
        channel_bucket = _slowmode_last[channel_key]
        prune_before = now - max(delay_seconds * 4, 300)
        stale_users = [uid for uid, ts in channel_bucket.items() if ts < prune_before]
        for uid in stale_users:
            channel_bucket.pop(uid, None)
        if not channel_bucket:
            _slowmode_last.pop(channel_key, None)
            channel_bucket = _slowmode_last[channel_key]

        last = channel_bucket.get(user_key, 0.0)
        elapsed = now - last
        if elapsed < delay_seconds:
            return max(1, int(delay_seconds - elapsed) + 1)
        channel_bucket[user_key] = now
    return 0


async def _enforce_limit(key: str, limit: int, window_seconds: float, detail: str) -> None:
    """Check *key* against the shared sliding-window limiter and raise 429 if
    over limit. *detail* may contain a ``{retry_after}`` placeholder, which is
    filled in with the computed retry-after seconds.
    """
    if not settings.ratelimit_enabled:
        return
    allowed, retry_after = await _check_sliding_window(key, limit, window_seconds)
    if not allowed:
        if "{retry_after}" in detail:
            detail = detail.format(retry_after=retry_after)
        raise HTTPException(
            status_code=429,
            detail=detail,
            headers={"Retry-After": str(retry_after)},
        )


async def rate_limit_messages(current_user: CurrentUser) -> None:
    await _enforce_limit(
        key=f"messages:{current_user.id}",
        limit=settings.ratelimit_messages,
        window_seconds=float(settings.ratelimit_window_seconds),
        detail="You are sending messages too quickly. Please slow down!",
    )


async def rate_limit_auth(request: Request) -> None:
    if os.getenv("PYTEST_CURRENT_TEST"):
        return
    ip = request.client.host if request.client else "unknown"
    await _enforce_limit(
        key=f"auth:{ip}",
        limit=settings.ratelimit_auth_ip_per_minute,
        window_seconds=60.0,
        detail="Too many requests. Please try again later.",
    )


async def rate_limit_auth_login(request: Request, username: str) -> None:
    """Extra anti-bruteforce guard for /auth/login.

    Limits repeated login attempts for the same username from the same IP.
    """
    if os.getenv("PYTEST_CURRENT_TEST"):
        return
    ip = request.client.host if request.client else "unknown"
    normalized = (username or "").strip().lower()[:128] or "unknown-user"
    await _enforce_limit(
        key=f"auth-login:{ip}:{normalized}",
        limit=settings.ratelimit_auth_login_ip_user_per_minute,
        window_seconds=60.0,
        detail="Too many login attempts for this account. Please try again later.",
    )


async def rate_limit_friend_requests(current_user: CurrentUser) -> None:
    await _enforce_limit(
        key=f"friend-request:{current_user.id}",
        limit=10,
        window_seconds=60.0,
        detail="You're sending friend requests too quickly. Please slow down!",
    )


async def rate_limit_reactions(current_user: CurrentUser) -> None:
    await _enforce_limit(
        key=f"reaction:{current_user.id}",
        limit=30,
        window_seconds=60.0,
        detail="You're changing reactions too quickly. Please slow down!",
    )


async def rate_limit_dm_channel(current_user: CurrentUser) -> None:
    await _enforce_limit(
        key=f"dm-channel:{current_user.id}",
        limit=20,
        window_seconds=60.0,
        detail="You're opening DMs too quickly. Please slow down!",
    )


# ---------------------------------------------------------------------------
# Profile / avatar / banner / decoration limits
#
# These used to live in a second, separate in-memory-only rate limiter
# (app/utils/rate_limiter.py) that didn't share state across workers/
# processes and never pruned old per-user entries. Consolidated here onto
# the same Redis-backed sliding window as everything else.
# ---------------------------------------------------------------------------

async def rate_limit_profile_update(current_user: CurrentUser) -> None:
    """Bio / pronouns changes: max 5 per 10 minutes per user."""
    await _enforce_limit(
        key=f"profile-update:{current_user.id}",
        limit=5,
        window_seconds=600.0,
        detail="You're updating your profile too quickly. Please wait {retry_after} seconds.",
    )


async def rate_limit_avatar_change(current_user: CurrentUser) -> None:
    """Avatar changes: max 2 per 10 minutes per user."""
    await _enforce_limit(
        key=f"avatar:{current_user.id}",
        limit=2,
        window_seconds=600.0,
        detail="You're updating your profile too quickly. Please wait {retry_after} seconds.",
    )


async def rate_limit_banner_change(current_user: CurrentUser) -> None:
    """Banner changes: max 2 per 10 minutes per user."""
    await _enforce_limit(
        key=f"banner:{current_user.id}",
        limit=2,
        window_seconds=600.0,
        detail="You're updating your profile too quickly. Please wait {retry_after} seconds.",
    )


async def rate_limit_decoration_generate(current_user: CurrentUser) -> None:
    """Decoration-code generation batches: max 2 per 10 minutes per admin."""
    await _enforce_limit(
        key=f"deco-gen:{current_user.id}",
        limit=2,
        window_seconds=600.0,
        detail="Too many requests. Please slow down.",
    )


# ---------------------------------------------------------------------------
# MLS (RFC 9420) delivery-service limits
# ---------------------------------------------------------------------------

async def rate_limit_mls_key_package_publish(current_user: CurrentUser) -> None:
    """Publishing KeyPackages: max 30 per 10 minutes per user (clients keep a
    small pool topped up; this generously covers normal churn while blocking
    a runaway/misbehaving client from flooding storage)."""
    await _enforce_limit(
        key=f"mls-kp-publish:{current_user.id}",
        limit=30,
        window_seconds=600.0,
        detail="Publishing key packages too quickly. Please wait {retry_after} seconds.",
    )


async def rate_limit_mls_key_package_purge(current_user: CurrentUser) -> None:
    """Purging one's own unclaimed KeyPackages: max 5 per 10 minutes per user.
    Only ever called once per fresh device (see the DELETE /mls/key-packages
    handler), so this is purely a brake on a buggy or hostile client
    repeatedly wiping its own pool."""
    await _enforce_limit(
        key=f"mls-kp-purge:{current_user.id}",
        limit=5,
        window_seconds=600.0,
        detail="Resetting key packages too quickly. Please wait {retry_after} seconds.",
    )


async def rate_limit_mls_commit(current_user: CurrentUser) -> None:
    """Submitting commits: max 20 per minute per user across all their groups."""
    await _enforce_limit(
        key=f"mls-commit:{current_user.id}",
        limit=20,
        window_seconds=60.0,
        detail="Too many group updates too quickly. Please wait {retry_after} seconds.",
    )
