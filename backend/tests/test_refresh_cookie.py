"""Refresh token in an HttpOnly cookie for browsers (security_pass S15)."""
from httpx import AsyncClient

from app.config import settings

COOKIE = settings.refresh_cookie_name
CM = {"X-Refresh-Cookie": "1"}


async def register(client: AsyncClient, username="carol", password="carolpass1"):
    r = await client.post("/auth/register", json={"username": username, "password": password})
    assert r.status_code == 201, r.text


async def cookie_login(client: AsyncClient, url="/auth/login", username="carol", password="carolpass1"):
    r = await client.post(url, data={"username": username, "password": password}, headers=CM)
    assert r.status_code == 200, r.text
    return r


def set_cookie_header(r) -> str:
    return next(v for k, v in r.headers.multi_items() if k == "set-cookie" and v.startswith(f"{COOKIE}="))


def with_cookie(value: str) -> dict:
    return {"Cookie": f"{COOKIE}={value}"}


async def test_cookie_login_keeps_refresh_token_out_of_the_body(client):
    await register(client)
    r = await cookie_login(client)
    assert r.json()["refresh_token"] is None
    assert r.json()["access_token"]
    header = set_cookie_header(r).lower()
    assert "httponly" in header
    assert "samesite=strict" in header
    assert "path=/api/auth" in header
    assert "secure" not in header  # plain-HTTP request


async def test_cookie_is_secure_over_https(client):
    await register(client)
    r = await cookie_login(client, url="https://test/auth/login")
    assert "secure" in set_cookie_header(r).lower()


async def test_refresh_with_cookie_rotates_and_never_returns_the_token(client):
    await register(client)
    first = (await cookie_login(client)).cookies[COOKIE]

    # Even without the opt-in header, a cookie refresh answers in cookie mode:
    # page script can't trade the cookie for a readable refresh token.
    r = await client.post("/auth/refresh", json={}, headers=with_cookie(first))
    assert r.status_code == 200, r.text
    assert r.json()["refresh_token"] is None
    second = r.cookies[COOKIE]
    assert second != first

    me = await client.get("/users/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
    assert me.status_code == 200

    # the old cookie value is spent
    r = await client.post("/auth/refresh", headers=with_cookie(first))
    assert r.status_code == 401


async def test_body_token_can_be_adopted_into_the_cookie(client):
    """QR login and pre-cookie localStorage tokens: hand the token over once
    in the body, get it back as a cookie."""
    await register(client)
    r = await client.post("/auth/login", data={"username": "carol", "password": "carolpass1"})
    legacy = r.json()["refresh_token"]
    assert legacy  # non-browser clients still get it in the body

    r = await client.post("/auth/refresh", json={"refresh_token": legacy}, headers=CM)
    assert r.status_code == 200
    assert r.json()["refresh_token"] is None
    assert r.cookies[COOKIE]


async def test_body_refresh_without_header_is_unchanged(client):
    await register(client)
    r = await client.post("/auth/login", data={"username": "carol", "password": "carolpass1"})
    r = await client.post("/auth/refresh", json={"refresh_token": r.json()["refresh_token"]})
    assert r.status_code == 200
    assert r.json()["refresh_token"]
    assert COOKIE not in r.cookies


async def test_refresh_without_any_token_is_401(client):
    assert (await client.post("/auth/refresh")).status_code == 401
    assert (await client.post("/auth/refresh", json={})).status_code == 401


async def test_logout_with_cookie_revokes_and_clears_it(client):
    await register(client)
    value = (await cookie_login(client)).cookies[COOKIE]
    r = await client.post("/auth/logout", headers=with_cookie(value))
    assert r.status_code == 204
    assert 'max-age=0' in set_cookie_header(r).lower() or "expires=" in set_cookie_header(r).lower()
    assert (await client.post("/auth/refresh", headers=with_cookie(value))).status_code == 401


async def test_revoke_other_sessions_keeps_the_access_tokens_session(client):
    await register(client)
    here = await cookie_login(client)
    other = (await cookie_login(client)).cookies[COOKIE]
    auth = {"Authorization": f"Bearer {here.json()['access_token']}"}

    r = await client.request("DELETE", "/auth/sessions", headers=auth)
    assert r.status_code == 204, r.text
    # this session survives, the other one is gone
    assert (await client.post("/auth/refresh", headers=with_cookie(here.cookies[COOKIE]))).status_code == 200
    assert (await client.post("/auth/refresh", headers=with_cookie(other))).status_code == 401
