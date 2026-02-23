"""
Security-focused tests for the backend.

Domains covered:
  1.  auth.py unit tests        – password hashing, JWT lifecycle, token helpers
  2.  Auth endpoint hardening   – malformed / tampered / replayed credentials
  3.  Refresh-token rotation    – new pair on refresh, old token rejected
  4.  Refresh-token replay      – double-use triggers full session wipe
  5.  Logout / revocation       – token rejected after logout, idempotent
  6.  Session management        – list, revoke own, cannot touch other user's
  7.  Password-change guards    – wrong current pw, min-length, old pw invalidated
  8.  Authorization gates       – membership, admin, ownership checks
  9.  Rate limiting             – 429 + Retry-After after burst
 10.  DM block enforcement      – blocked user cannot open a DM channel
 11.  Input validation          – username constraints, HTML sanitisation
"""
import uuid
import time
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from jose import jwt

from app.auth import (
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
    generate_refresh_token,
    hash_refresh_token,
    generate_api_token,
    hash_api_token,
)
from app.config import settings
from tests.conftest import register_and_login, create_server, create_channel, send_message


# ===========================================================================
# 1. auth.py unit tests (pure Python – no HTTP needed)
# ===========================================================================

class TestPasswordHashing:
    def test_hash_is_not_plaintext(self):
        h = hash_password("hunter2")
        assert h != "hunter2"

    def test_correct_password_verifies(self):
        h = hash_password("correct")
        assert verify_password("correct", h) is True

    def test_wrong_password_rejected(self):
        h = hash_password("correct")
        assert verify_password("wrong", h) is False

    def test_empty_password_verifies_against_its_own_hash(self):
        h = hash_password("")
        assert verify_password("", h) is True
        assert verify_password("x", h) is False

    def test_hashes_differ_for_same_input(self):
        """bcrypt uses a random salt each call."""
        h1 = hash_password("same")
        h2 = hash_password("same")
        assert h1 != h2


class TestJWT:
    def test_roundtrip(self):
        uid = uuid.uuid4()
        token = create_access_token(uid)
        decoded = decode_access_token(token)
        assert decoded == uid

    def test_tampered_signature_rejected(self):
        token = create_access_token(uuid.uuid4())
        header, payload, sig = token.split(".")
        bad_token = f"{header}.{payload}.badsignature"
        assert decode_access_token(bad_token) is None

    def test_wrong_secret_rejected(self):
        uid = uuid.uuid4()
        payload = {"sub": str(uid), "exp": datetime.now(timezone.utc) + timedelta(minutes=15)}
        bad_token = jwt.encode(payload, "wrong-secret", algorithm=settings.algorithm)
        assert decode_access_token(bad_token) is None

    def test_expired_token_rejected(self):
        uid = uuid.uuid4()
        payload = {"sub": str(uid), "exp": datetime.now(timezone.utc) - timedelta(seconds=1)}
        expired_token = jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)
        assert decode_access_token(expired_token) is None

    def test_missing_sub_rejected(self):
        payload = {"exp": datetime.now(timezone.utc) + timedelta(minutes=15)}
        token = jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)
        assert decode_access_token(token) is None

    def test_garbage_string_rejected(self):
        assert decode_access_token("notavalidtoken") is None
        assert decode_access_token("") is None
        assert decode_access_token("a.b.c") is None


class TestRefreshTokenHelpers:
    def test_generate_returns_raw_and_hash(self):
        raw, hashed = generate_refresh_token()
        assert isinstance(raw, str) and len(raw) > 20
        assert isinstance(hashed, str) and len(hashed) == 64  # sha256 hex

    def test_hash_is_deterministic(self):
        raw, _ = generate_refresh_token()
        assert hash_refresh_token(raw) == hash_refresh_token(raw)

    def test_different_tokens_produce_different_hashes(self):
        raw1, _ = generate_refresh_token()
        raw2, _ = generate_refresh_token()
        assert raw1 != raw2
        assert hash_refresh_token(raw1) != hash_refresh_token(raw2)

    def test_hash_from_generate_matches_separate_hash(self):
        raw, hashed = generate_refresh_token()
        assert hash_refresh_token(raw) == hashed


class TestApiTokenHelpers:
    def test_format_contains_dot_separator(self):
        raw, prefix, hashed = generate_api_token()
        assert "." in raw
        parts = raw.split(".")
        assert len(parts) == 2
        assert raw.startswith(prefix)

    def test_hash_is_sha256(self):
        raw, _, hashed = generate_api_token()
        assert len(hashed) == 64
        assert hash_api_token(raw) == hashed


# ===========================================================================
# 2. Auth endpoint hardening
# ===========================================================================

async def test_missing_auth_header_returns_401(client: AsyncClient):
    r = await client.get("/users/me")
    assert r.status_code == 401


async def test_empty_bearer_returns_401(client: AsyncClient):
    r = await client.get("/users/me", headers={"Authorization": "Bearer "})
    assert r.status_code == 401


async def test_garbage_bearer_returns_401(client: AsyncClient):
    r = await client.get("/users/me", headers={"Authorization": "Bearer notatoken"})
    assert r.status_code == 401


async def test_jwt_from_wrong_secret_returns_401(client: AsyncClient):
    uid = uuid.uuid4()
    payload = {"sub": str(uid), "exp": datetime.now(timezone.utc) + timedelta(minutes=15)}
    bad_token = jwt.encode(payload, "attacker-secret", algorithm="HS256")
    r = await client.get("/users/me", headers={"Authorization": f"Bearer {bad_token}"})
    assert r.status_code == 401


async def test_expired_jwt_returns_401(client: AsyncClient):
    uid = uuid.uuid4()
    payload = {"sub": str(uid), "exp": datetime.now(timezone.utc) - timedelta(seconds=1)}
    expired = jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)
    r = await client.get("/users/me", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401


async def test_bot_token_header_with_invalid_token_returns_401(client: AsyncClient):
    r = await client.get("/users/me", headers={"Authorization": "Bot fake-api-token"})
    assert r.status_code == 401


# ===========================================================================
# 3. Refresh-token rotation
# ===========================================================================

async def test_refresh_returns_new_token_pair(client: AsyncClient):
    await client.post("/auth/register", json={"username": "ref_user", "password": "password1"})
    r = await client.post("/auth/login", data={"username": "ref_user", "password": "password1"})
    original = r.json()

    r2 = await client.post("/auth/refresh", json={"refresh_token": original["refresh_token"]})
    assert r2.status_code == 200
    refreshed = r2.json()
    assert "access_token" in refreshed
    assert "refresh_token" in refreshed
    # New tokens are issued; the refresh token must rotate (one-time use)
    assert refreshed["refresh_token"] != original["refresh_token"]


async def test_used_refresh_token_is_rejected(client: AsyncClient):
    """Token rotation: a refresh token can only be used once."""
    await client.post("/auth/register", json={"username": "rotation_user", "password": "password1"})
    r = await client.post("/auth/login", data={"username": "rotation_user", "password": "password1"})
    rt = r.json()["refresh_token"]

    await client.post("/auth/refresh", json={"refresh_token": rt})
    # Second use of the same refresh token must fail
    r2 = await client.post("/auth/refresh", json={"refresh_token": rt})
    assert r2.status_code == 401


async def test_garbage_refresh_token_rejected(client: AsyncClient):
    r = await client.post("/auth/refresh", json={"refresh_token": "notarealtoken"})
    assert r.status_code == 401


# ===========================================================================
# 4. Refresh-token replay → full session wipe
# ===========================================================================

async def test_replay_of_revoked_token_wipes_all_sessions(client: AsyncClient):
    """
    Using a token that has already been rotated/revoked indicates a potential
    replay attack. The server must revoke ALL active sessions for that user.
    """
    await client.post("/auth/register", json={"username": "replay_user", "password": "password1"})

    # Login twice to establish two separate sessions
    r1 = await client.post("/auth/login", data={"username": "replay_user", "password": "password1"})
    rt1 = r1.json()["refresh_token"]
    r2 = await client.post("/auth/login", data={"username": "replay_user", "password": "password1"})
    rt2 = r2.json()["refresh_token"]

    # Rotate rt1 once (marks it revoked); then replay rt1
    await client.post("/auth/refresh", json={"refresh_token": rt1})
    r_replay = await client.post("/auth/refresh", json={"refresh_token": rt1})
    assert r_replay.status_code == 401

    # rt2 was a valid session but must now also be invalidated
    r_rt2 = await client.post("/auth/refresh", json={"refresh_token": rt2})
    assert r_rt2.status_code == 401


# ===========================================================================
# 5. Logout / revocation
# ===========================================================================

async def test_logout_invalidates_refresh_token(client: AsyncClient):
    await client.post("/auth/register", json={"username": "logout_user", "password": "password1"})
    r = await client.post("/auth/login", data={"username": "logout_user", "password": "password1"})
    rt = r.json()["refresh_token"]

    await client.post("/auth/logout", json={"refresh_token": rt})

    # Cannot refresh after logout
    r2 = await client.post("/auth/refresh", json={"refresh_token": rt})
    assert r2.status_code == 401


async def test_logout_is_idempotent(client: AsyncClient):
    """Logging out twice with the same (already revoked) token still returns 204."""
    await client.post("/auth/register", json={"username": "logout2_user", "password": "password1"})
    r = await client.post("/auth/login", data={"username": "logout2_user", "password": "password1"})
    rt = r.json()["refresh_token"]

    r1 = await client.post("/auth/logout", json={"refresh_token": rt})
    r2 = await client.post("/auth/logout", json={"refresh_token": rt})
    assert r1.status_code == 204
    assert r2.status_code == 204


# ===========================================================================
# 6. Session management
# ===========================================================================

async def test_list_sessions_returns_own_sessions(client: AsyncClient, alice_headers):
    r = await client.get("/auth/sessions", headers=alice_headers)
    assert r.status_code == 200
    # Alice logged in once, so at least one session exists
    sessions = r.json()
    assert len(sessions) >= 1
    for s in sessions:
        assert "id" in s
        assert "expires_at" in s


async def test_revoke_specific_own_session(client: AsyncClient):
    await client.post("/auth/register", json={"username": "sess_user", "password": "password1"})
    r = await client.post("/auth/login", data={"username": "sess_user", "password": "password1"})
    tokens = r.json()
    hdrs = {"Authorization": f"Bearer {tokens['access_token']}"}

    sessions = (await client.get("/auth/sessions", headers=hdrs)).json()
    sid = sessions[0]["id"]

    r_del = await client.delete(f"/auth/sessions/{sid}", headers=hdrs)
    assert r_del.status_code == 204

    # Token should now be gone from session list
    sessions_after = (await client.get("/auth/sessions", headers=hdrs)).json()
    assert all(s["id"] != sid for s in sessions_after)


async def test_cannot_revoke_another_users_session(client: AsyncClient, alice_headers, bob_headers):
    """Bob must not be able to revoke Alice's session."""
    alice_sessions = (await client.get("/auth/sessions", headers=alice_headers)).json()
    assert alice_sessions, "Alice should have at least one session"
    alice_sid = alice_sessions[0]["id"]

    r = await client.delete(f"/auth/sessions/{alice_sid}", headers=bob_headers)
    assert r.status_code == 404


async def test_revoke_all_other_sessions(client: AsyncClient):
    """DELETE /auth/sessions keeps the current session and removes the rest."""
    await client.post("/auth/register", json={"username": "multi_sess", "password": "password1"})

    # Establish three sessions
    login_results = []
    for _ in range(3):
        r = await client.post("/auth/login", data={"username": "multi_sess", "password": "password1"})
        login_results.append(r.json())

    keep = login_results[-1]
    hdrs = {"Authorization": f"Bearer {keep['access_token']}"}

    r = await client.request(
        "DELETE",
        "/auth/sessions",
        json={"current_refresh_token": keep["refresh_token"]},
        headers=hdrs,
    )
    assert r.status_code == 204

    # The kept refresh token should still work
    r_refresh = await client.post("/auth/refresh", json={"refresh_token": keep["refresh_token"]})
    assert r_refresh.status_code == 200

    # The other two should be dead
    for old in login_results[:-1]:
        r_old = await client.post("/auth/refresh", json={"refresh_token": old["refresh_token"]})
        assert r_old.status_code == 401


# ===========================================================================
# 7. Password-change guards
# ===========================================================================

async def test_change_password_wrong_current_password(client: AsyncClient, alice_headers):
    r = await client.post(
        "/users/me/change-password",
        json={"current_password": "wrongpassword", "new_password": "newpassword1"},
        headers=alice_headers,
    )
    assert r.status_code == 400
    assert "incorrect" in r.json()["detail"].lower()


async def test_change_password_too_short(client: AsyncClient, alice_headers):
    r = await client.post(
        "/users/me/change-password",
        json={"current_password": "alicepass", "new_password": "short"},
        headers=alice_headers,
    )
    assert r.status_code == 422


async def test_change_password_success_and_old_password_rejected(client: AsyncClient):
    await client.post("/auth/register", json={"username": "chpw_user", "password": "oldpassword"})
    r = await client.post("/auth/login", data={"username": "chpw_user", "password": "oldpassword"})
    hdrs = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r = await client.post(
        "/users/me/change-password",
        json={"current_password": "oldpassword", "new_password": "newpassword1"},
        headers=hdrs,
    )
    assert r.status_code == 204

    # Old password no longer works
    r_old = await client.post("/auth/login", data={"username": "chpw_user", "password": "oldpassword"})
    assert r_old.status_code == 401

    # New password works
    r_new = await client.post("/auth/login", data={"username": "chpw_user", "password": "newpassword1"})
    assert r_new.status_code == 200


# ===========================================================================
# 8. Authorization gates
# ===========================================================================

async def test_non_member_cannot_get_server(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    r = await client.get(f"/servers/{s['id']}", headers=bob_headers)
    assert r.status_code == 403


async def test_non_member_cannot_post_message(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    r = await client.post(
        f"/channels/{ch['id']}/messages",
        json={"content": "I shouldn't be here"},
        headers=bob_headers,
    )
    assert r.status_code == 403


async def test_non_admin_cannot_create_category(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    r = await client.post(
        f"/servers/{s['id']}/categories",
        json={"title": "Stealth category"},
        headers=bob_headers,
    )
    assert r.status_code == 403


async def test_non_admin_cannot_kick_member(client: AsyncClient, alice_headers, bob_headers):
    """Bob joins Alice's server; Bob tries to kick Alice — must be denied."""
    s = await create_server(client, alice_headers)
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)

    alice_id_r = await client.get("/users/me", headers=alice_headers)
    alice_id = alice_id_r.json()["id"]

    r = await client.delete(f"/servers/{s['id']}/members/{alice_id}", headers=bob_headers)
    assert r.status_code == 403


async def test_non_owner_cannot_delete_server(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    r = await client.delete(f"/servers/{s['id']}", headers=bob_headers)
    assert r.status_code == 403


async def test_owner_cannot_be_kicked_by_admin(client: AsyncClient, alice_headers, bob_headers):
    """Even an admin role should not be able to remove the owner."""
    s = await create_server(client, alice_headers)
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)

    # Grant Bob the default Admin role
    roles_r = await client.get(f"/servers/{s['id']}/roles", headers=alice_headers)
    roles = roles_r.json()
    admin_role = next(ro for ro in roles if ro["is_admin"])
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    await client.post(
        f"/servers/{s['id']}/members/{bob_id}/roles/{admin_role['id']}",
        headers=alice_headers,
    )

    # Bob (now admin) tries to kick Alice (the owner)
    alice_id = (await client.get("/users/me", headers=alice_headers)).json()["id"]
    r = await client.delete(f"/servers/{s['id']}/members/{alice_id}", headers=bob_headers)
    assert r.status_code == 400


async def test_cannot_edit_another_users_message(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    msg = await send_message(client, alice_headers, ch["id"], "Alice's message")

    r = await client.patch(
        f"/channels/{ch['id']}/messages/{msg['id']}",
        json={"content": "Bob was here"},
        headers=bob_headers,
    )
    assert r.status_code == 403


async def test_cannot_delete_another_users_message_without_admin(
    client: AsyncClient, alice_headers, bob_headers
):
    s = await create_server(client, alice_headers)
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    msg = await send_message(client, alice_headers, ch["id"], "Alice's message")

    r = await client.delete(
        f"/channels/{ch['id']}/messages/{msg['id']}",
        headers=bob_headers,
    )
    assert r.status_code == 403


# ===========================================================================
# 9. Rate limiting
# ===========================================================================

async def test_message_rate_limit_returns_429(client: AsyncClient, monkeypatch):
    """Sending more messages than the window allows must yield 429 + Retry-After."""
    # Use a low limit so we trip it quickly without many requests
    monkeypatch.setattr(settings, "ratelimit_messages", 3)
    monkeypatch.setattr(settings, "ratelimit_enabled", True)

    # Clear any accumulated state for this user from previous tests
    import app.rate_limiter as rl
    rl._windows.clear()

    hdrs = await register_and_login(client, "ratelimit_user", "password1")
    s = await create_server(client, hdrs)
    ch = await create_channel(client, hdrs, s["id"])

    responses = []
    for i in range(5):
        r = await client.post(
            f"/channels/{ch['id']}/messages",
            json={"content": f"msg {i}"},
            headers=hdrs,
        )
        responses.append(r.status_code)

    assert 429 in responses, f"Expected a 429 among {responses}"

    # Find the 429 response and check Retry-After header
    rate_limited = [
        await client.post(
            f"/channels/{ch['id']}/messages",
            json={"content": "overflow"},
            headers=hdrs,
        )
        for _ in range(1)
    ][0]
    if rate_limited.status_code == 429:
        assert "retry-after" in rate_limited.headers


async def test_rate_limit_disabled_allows_burst(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "ratelimit_enabled", False)

    import app.rate_limiter as rl
    rl._windows.clear()

    hdrs = await register_and_login(client, "norl_user", "password1")
    s = await create_server(client, hdrs)
    ch = await create_channel(client, hdrs, s["id"])

    for i in range(15):
        r = await client.post(
            f"/channels/{ch['id']}/messages",
            json={"content": f"burst {i}"},
            headers=hdrs,
        )
        assert r.status_code == 201, f"Expected 201 on msg {i}, got {r.status_code}"


# ===========================================================================
# 10. DM block enforcement
# ===========================================================================

async def test_blocked_user_cannot_open_dm_channel(client: AsyncClient, alice_headers, bob_headers):
    """When Alice blocks Bob, Bob must not be able to create/get a DM with Alice."""
    alice_id = (await client.get("/users/me", headers=alice_headers)).json()["id"]
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]

    # Alice blocks Bob
    r_block = await client.post(f"/users/{bob_id}/block", headers=alice_headers)
    assert r_block.status_code in (200, 201, 204)

    # Bob tries to DM Alice
    r_dm = await client.get(f"/dms/{alice_id}/channel", headers=bob_headers)
    assert r_dm.status_code == 403


async def test_blocker_cannot_dm_blocked_user(client: AsyncClient, alice_headers, bob_headers):
    """The blocker (Alice) also cannot open a DM channel with the person she blocked."""
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    alice_id = (await client.get("/users/me", headers=alice_headers)).json()["id"]

    await client.post(f"/users/{bob_id}/block", headers=alice_headers)

    r_dm = await client.get(f"/dms/{bob_id}/channel", headers=alice_headers)
    assert r_dm.status_code == 403


# ===========================================================================
# 11. Input validation / injection
# ===========================================================================

async def test_empty_username_rejected(client: AsyncClient):
    r = await client.post("/auth/register", json={"username": "", "password": "password1"})
    assert r.status_code == 422


async def test_username_too_long_rejected(client: AsyncClient):
    long_name = "a" * 51
    r = await client.post("/auth/register", json={"username": long_name, "password": "password1"})
    assert r.status_code == 422


async def test_html_in_username_is_stripped(client: AsyncClient):
    """HTML tags in username must be sanitised away by the schema validator."""
    r = await client.post(
        "/auth/register",
        json={"username": "<script>xss</script>", "password": "password1"},
    )
    # Either the remaining text 'xss' is used as username (sanitised)
    # or the empty result causes a 422. Both are acceptable.
    if r.status_code == 201:
        assert "<script>" not in r.json()["username"]
    else:
        assert r.status_code == 422


async def test_self_dm_rejected(client: AsyncClient, alice_headers):
    alice_id = (await client.get("/users/me", headers=alice_headers)).json()["id"]
    r = await client.get(f"/dms/{alice_id}/channel", headers=alice_headers)
    assert r.status_code == 400
