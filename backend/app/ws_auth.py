"""Shared WebSocket authentication handshake.

Previously, every WebSocket endpoint authenticated via a `?token=<jwt>` query
parameter, validated *before* accepting the connection. That put live JWTs
and personal API tokens in every URL — which meant they could land in proxy
access logs, APM/network-request loggers, and any other layer that records
full request URLs. There's also no way to avoid this by design: browsers'
native `WebSocket` constructor has no API for attaching custom headers to
the handshake request, so an `Authorization: Bearer <token>` header (like
every other endpoint uses) simply isn't an option here.

New flow, used by every endpoint in app/routers/ws.py and
app/routers/voice.py:

  1. Server accepts the connection immediately (no secret has been sent
     yet, so there's nothing to protect at this point).
  2. Client's first frame must be:
         {"type": "auth", "token": "<jwt-or-api-token>"}
  3. Server validates it (same JWT/session-revocation and personal
     API-token checks as every other authenticated endpoint) and either:
       - replies {"type": "auth.ok", "data": {"user_id": "<uuid>"}} and
         returns the user_id, or
       - closes the connection (4001 invalid/expired token, 4008 timed out
         or malformed first frame) and returns None.

Callers must treat a None return as "stop — the connection is already
closed", exactly like the old _authenticate_ws contract.

This keeps the token out of every URL and out of any access log, at the
cost of one extra round trip after the TCP/TLS handshake. Still use wss://
(TLS) in production — this only removes the query-string/log exposure, it
doesn't make the token safe to send over plaintext ws://.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass

from fastapi import WebSocket
from sqlalchemy import select

from app.auth import decode_access_token, hash_api_token
from app.token_scopes import parse_scopes
from app.database import AsyncSessionLocal
from models.api_token import ApiToken
from models.refresh_token import RefreshToken

# How long to wait for the client's {"type": "auth", ...} frame before
# giving up and closing the connection.
AUTH_TIMEOUT_SECONDS = 10


@dataclass(frozen=True)
class WSIdentity:
    """Who a socket belongs to. Stored on ``ws.state.identity`` so the
    connection manager can close the right sockets when a session or API
    token is revoked, or a user loses access to a server or channel."""

    user_id: uuid.UUID
    session_id: uuid.UUID | None = None    # JWT logins (refresh_tokens.id)
    api_token_id: uuid.UUID | None = None  # personal API / bot tokens


def identity_of(ws) -> WSIdentity | None:
    return getattr(ws.state, "identity", None)


async def _resolve_token(token: str) -> WSIdentity | None:
    """Validate a JWT access token or personal API token and return who it
    belongs to, or None if invalid/revoked/expired. Mirrors the HTTP auth
    logic in app/dependencies.py's get_current_user.
    """
    payload = decode_access_token(token)
    if payload is not None:
        sub = payload.get("sub")
        sid = payload.get("sid")
        if not sub or not sid:
            # Missing subject, or a legacy token with no session id (can't
            # be revoked securely) — reject.
            return None
        try:
            user_id = uuid.UUID(sub)
            session_id = uuid.UUID(sid)
        except ValueError:
            return None

        async with AsyncSessionLocal() as db:
            rt = await db.execute(select(RefreshToken).where(RefreshToken.id == session_id))
            rt_row = rt.scalar_one_or_none()
        if rt_row and not rt_row.revoked:
            return WSIdentity(user_id=user_id, session_id=session_id)
        return None

    # Not a valid JWT — fall back to a personal API token
    # (format "<prefix8>.<body>").
    if "." in token:
        token_hash = hash_api_token(token)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(ApiToken).where(
                    ApiToken.token_hash == token_hash,
                    ApiToken.revoked.is_(False),
                )
            )
            api_token = result.scalar_one_or_none()
        if (
            api_token is not None
            and "read" in parse_scopes(api_token.scopes)
            and not api_token.is_expired()
        ):
            return WSIdentity(user_id=api_token.user_id, api_token_id=api_token.id)

    return None


async def accept_and_authenticate(ws: WebSocket) -> uuid.UUID | None:
    """Accept *ws* and run the post-connect auth handshake described above.

    Returns the authenticated user_id, or None if the connection was
    rejected (and already closed) — callers must return immediately in
    that case.
    """
    await ws.accept()

    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=AUTH_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        await ws.close(code=4008, reason="Timed out waiting for auth message")
        return None
    except Exception:
        # Client disconnected before sending anything — nothing to close.
        return None

    if len(raw) > 16 * 1024:  # a token is a few hundred bytes
        await ws.close(code=1009, reason="Auth message too big")
        return None

    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        await ws.close(code=4001, reason='First message must be {"type": "auth", "token": "..."}')
        return None

    token = msg.get("token") if isinstance(msg, dict) else None
    if not isinstance(msg, dict) or msg.get("type") != "auth" or not isinstance(token, str) or not token:
        await ws.close(code=4001, reason='First message must be {"type": "auth", "token": "..."}')
        return None

    identity = await _resolve_token(token)
    if identity is None:
        await ws.close(code=4001, reason="Invalid or expired token")
        return None

    ws.state.identity = identity
    await ws.send_text(json.dumps({"type": "auth.ok", "data": {"user_id": str(identity.user_id)}}))
    return identity.user_id
