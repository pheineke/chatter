"""Personal API tokens: scopes, expiry, blocked routes (security_pass S19)."""
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import update

from app.token_scopes import required_scope
from models.api_token import ApiToken
from tests.conftest import create_server, send_message


async def make_token(client: AsyncClient, headers: dict, **body) -> dict:
    r = await client.post("/me/tokens", json={"name": "bot", **body}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def bot(token: dict) -> dict:
    return {"Authorization": f"Bot {token['token']}"}


async def test_new_token_defaults_to_read_only_and_90_days(client, alice_headers):
    tok = await make_token(client, alice_headers)
    assert tok["scopes"] == ["read"]
    expires = datetime.fromisoformat(tok["expires_at"])
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    assert timedelta(days=89) < expires - datetime.now(timezone.utc) <= timedelta(days=90)

    listed = (await client.get("/me/tokens", headers=alice_headers)).json()
    assert listed[0]["scopes"] == ["read"] and listed[0]["expires_at"]


async def test_read_scope_can_read_but_not_write(client, alice_headers):
    server = await create_server(client, alice_headers)
    channels = (await client.get(f"/servers/{server['id']}/channels", headers=alice_headers)).json()
    text = next(c for c in channels if c["type"] == "text")
    tok = await make_token(client, alice_headers, scopes=["read"])

    assert (await client.get("/users/me", headers=bot(tok))).status_code == 200
    assert (await client.get(f"/channels/{text['id']}/messages", headers=bot(tok))).status_code == 200

    r = await client.post(f"/channels/{text['id']}/messages", json={"content": "hi"}, headers=bot(tok))
    assert r.status_code == 403 and "send" in r.json()["detail"]
    r = await client.delete(f"/servers/{server['id']}", headers=bot(tok))
    assert r.status_code == 403 and "manage" in r.json()["detail"]


async def test_send_scope_posts_messages_but_cannot_manage(client, alice_headers):
    server = await create_server(client, alice_headers)
    channels = (await client.get(f"/servers/{server['id']}/channels", headers=alice_headers)).json()
    text = next(c for c in channels if c["type"] == "text")
    tok = await make_token(client, alice_headers, scopes=["send"])

    r = await client.post(f"/channels/{text['id']}/messages", json={"content": "hi"}, headers=bot(tok))
    assert r.status_code == 201, r.text
    # send without read: can't read history
    assert (await client.get(f"/channels/{text['id']}/messages", headers=bot(tok))).status_code == 403
    r = await client.patch(f"/servers/{server['id']}", json={"title": "pwned"}, headers=bot(tok))
    assert r.status_code == 403


async def test_manage_scope_can_manage(client, alice_headers):
    server = await create_server(client, alice_headers)
    tok = await make_token(client, alice_headers, scopes=["read", "manage"])
    r = await client.patch(f"/servers/{server['id']}", json={"title": "Renamed"}, headers=bot(tok))
    assert r.status_code == 200, r.text


@pytest.mark.parametrize(
    "method,path",
    [
        ("POST", "/me/tokens"),
        ("GET", "/me/tokens"),
        ("GET", "/auth/sessions"),
        ("DELETE", "/auth/sessions"),
        ("POST", "/users/me/change-password"),
        ("PUT", "/me/e2ee-public-key"),
        ("POST", "/mls/key-packages"),
        ("POST", "/decorations/redeem"),
    ],
)
async def test_account_routes_blocked_even_with_all_scopes(client, alice_headers, method, path):
    tok = await make_token(client, alice_headers, scopes=["read", "send", "manage"])
    r = await client.request(method, path, json={}, headers=bot(tok))
    assert r.status_code == 403, (path, r.status_code, r.text)
    assert "cannot be used" in r.json()["detail"]


async def test_expired_token_is_rejected(client, alice_headers, db):
    tok = await make_token(client, alice_headers, expires_in_days=1)
    assert (await client.get("/users/me", headers=bot(tok))).status_code == 200
    await db.execute(
        update(ApiToken)
        .where(ApiToken.token_prefix == tok["token_prefix"])
        .values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
    )
    await db.commit()
    assert (await client.get("/users/me", headers=bot(tok))).status_code == 401


async def test_never_expiring_token_and_validation(client, alice_headers):
    tok = await make_token(client, alice_headers, expires_in_days=None)
    assert tok["expires_at"] is None
    for body in (
        {"name": "x", "scopes": []},
        {"name": "x", "scopes": ["admin"]},
        {"name": "x", "expires_in_days": 0},
        {"name": "x", "expires_in_days": 366},
        {"name": "   "},
    ):
        r = await client.post("/me/tokens", json=body, headers=alice_headers)
        assert r.status_code == 422, body


async def test_per_token_rate_limit(client, alice_headers):
    tok = await make_token(client, alice_headers)
    for _ in range(120):
        assert (await client.get("/users/me", headers=bot(tok))).status_code == 200
    r = await client.get("/users/me", headers=bot(tok))
    assert r.status_code == 429


async def test_messages_sent_by_login_unaffected(client, alice_headers):
    """The normal JWT path has no scope checks."""
    server = await create_server(client, alice_headers)
    channels = (await client.get(f"/servers/{server['id']}/channels", headers=alice_headers)).json()
    text = next(c for c in channels if c["type"] == "text")
    await send_message(client, alice_headers, text["id"])


def test_every_route_has_a_policy():
    """Pin the classification of the sensitive routes so a refactor of the
    prefixes can't silently open them up."""
    assert required_scope("GET", "/servers/{server_id}") == "read"
    assert required_scope("POST", "/channels/{channel_id}/messages") == "send"
    assert required_scope("DELETE", "/servers/{server_id}") == "manage"
    assert required_scope("POST", "/auth/qr/{session_id}/approve") is None
    assert required_scope("POST", "/me/tokens") is None
    assert required_scope("DELETE", "/me/tokens/{token_id}") is None
    assert required_scope("GET", "/mls/groups/{channel_id}/events") is None


async def test_websocket_needs_read_scope_and_unexpired_token(client, alice_headers, db):
    from app import ws_auth

    reader = await make_token(client, alice_headers, scopes=["read"])
    sender = await make_token(client, alice_headers, scopes=["send"])
    assert await ws_auth._resolve_token(reader["token"]) is not None
    assert await ws_auth._resolve_token(sender["token"]) is None

    await db.execute(
        update(ApiToken)
        .where(ApiToken.token_prefix == reader["token_prefix"])
        .values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
    )
    await db.commit()
    assert await ws_auth._resolve_token(reader["token"]) is None
