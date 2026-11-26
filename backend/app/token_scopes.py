"""What a personal API token (``Authorization: Bot <token>``) may do.

Every token carries a set of scopes (security_pass S19):

* ``read``   – GET requests, and connecting to the WebSocket gateways.
* ``send``   – posting, editing and deleting your own messages, attachments and
  reactions, marking DMs read, bot interactions and slash commands.
* ``manage`` – every other write: servers, channels, roles, members, invites,
  friends, blocks, notes, your profile.

Some routes are never available to a token, whatever its scopes: anything that
mints or revokes credentials, changes the password, lists or ends login
sessions, approves a QR login, or publishes E2EE key material. A leaked token
must not be able to turn itself into a full login or swap someone's keys.
"""
from __future__ import annotations

from typing import Literal

Scope = Literal["read", "send", "manage"]
ALL_SCOPES: tuple[Scope, ...] = ("read", "send", "manage")

# Route-template prefixes a token can never use.
_BLOCKED_PREFIXES = (
    "/auth/",          # login, refresh, sessions, QR approve
    "/me/tokens",      # a token must not mint or revoke tokens
    "/me/e2ee-public-key",
    "/mls/",           # E2EE groups and key packages
    "/decorations/",   # redeem / generate codes
)
_BLOCKED_EXACT = {
    ("POST", "/users/me/change-password"),
}

# (method, route template) pairs covered by the ``send`` scope.
_SEND_ROUTES = {
    ("POST", "/channels/{channel_id}/messages"),
    ("PATCH", "/channels/{channel_id}/messages/{message_id}"),
    ("DELETE", "/channels/{channel_id}/messages/{message_id}"),
    ("POST", "/channels/{channel_id}/messages/{message_id}/attachments"),
    ("POST", "/channels/{channel_id}/messages/{message_id}/reactions/{emoji}"),
    ("DELETE", "/channels/{channel_id}/messages/{message_id}/reactions/{emoji}"),
    ("PUT", "/dms/channels/{channel_id}/read"),
    ("POST", "/interactions"),
    ("POST", "/applications/{application_id}/commands"),
}


def required_scope(method: str, route_path: str) -> Scope | None:
    """The scope a token needs for *method* on *route_path* (the route
    template, e.g. ``/servers/{server_id}``), or None if tokens may not use
    the route at all."""
    method = method.upper()
    if route_path.startswith(_BLOCKED_PREFIXES) or (method, route_path) in _BLOCKED_EXACT:
        return None
    if method in ("GET", "HEAD", "OPTIONS"):
        return "read"
    if (method, route_path) in _SEND_ROUTES:
        return "send"
    return "manage"


def parse_scopes(raw: str | None) -> set[str]:
    """Scopes stored as a comma-separated string."""
    return {s for s in (raw or "").split(",") if s}
