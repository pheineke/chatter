"""Password length limits and change-password side effects (security_pass S21)."""
from httpx import AsyncClient


async def _login(client: AsyncClient, username: str, password: str) -> dict:
    r = await client.post("/auth/login", data={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


async def test_register_rejects_passwords_bcrypt_cannot_take(client: AsyncClient):
    r = await client.post("/auth/register", json={"username": "long1", "password": "a" * 73})
    assert r.status_code == 422
    assert "too long" in r.text
    # 25 emoji = 100 UTF-8 bytes: under 73 characters but over bcrypt's limit.
    r = await client.post("/auth/register", json={"username": "long2", "password": "😀" * 25})
    assert r.status_code == 422


async def test_register_accepts_exactly_72_bytes(client: AsyncClient):
    r = await client.post("/auth/register", json={"username": "long3", "password": "a" * 72})
    assert r.status_code == 201, r.text
    await _login(client, "long3", "a" * 72)


async def test_overlong_login_attempt_is_401_not_500(client: AsyncClient):
    await client.post("/auth/register", json={"username": "victim", "password": "victimpass"})
    r = await client.post("/auth/login", data={"username": "victim", "password": "x" * 5000})
    assert r.status_code == 401


async def test_change_password_rejects_overlong_new_password(client: AsyncClient):
    await client.post("/auth/register", json={"username": "chg1", "password": "chg1pass!"})
    tok = await _login(client, "chg1", "chg1pass!")
    r = await client.post(
        "/users/me/change-password",
        json={"current_password": "chg1pass!", "new_password": "b" * 73},
        headers={"Authorization": f"Bearer {tok['access_token']}"},
    )
    assert r.status_code == 422


async def test_change_password_signs_out_other_sessions(client: AsyncClient):
    await client.post("/auth/register", json={"username": "chg2", "password": "oldpassword"})
    here = await _login(client, "chg2", "oldpassword")
    elsewhere = await _login(client, "chg2", "oldpassword")

    r = await client.post(
        "/users/me/change-password",
        json={"current_password": "oldpassword", "new_password": "newpassword"},
        headers={"Authorization": f"Bearer {here['access_token']}"},
    )
    assert r.status_code == 204, r.text

    # The other device is out: its access token and refresh token stop working.
    r = await client.get("/users/me", headers={"Authorization": f"Bearer {elsewhere['access_token']}"})
    assert r.status_code == 401
    r = await client.post("/auth/refresh", json={"refresh_token": elsewhere["refresh_token"]})
    assert r.status_code == 401

    # The session that changed the password stays signed in.
    r = await client.get("/users/me", headers={"Authorization": f"Bearer {here['access_token']}"})
    assert r.status_code == 200
    r = await client.post("/auth/refresh", json={"refresh_token": here["refresh_token"]})
    assert r.status_code == 200


async def test_change_password_current_password_guesses_are_limited(client: AsyncClient):
    await client.post("/auth/register", json={"username": "chg3", "password": "rightpass1"})
    tok = await _login(client, "chg3", "rightpass1")
    h = {"Authorization": f"Bearer {tok['access_token']}"}
    for i in range(5):
        r = await client.post(
            "/users/me/change-password",
            json={"current_password": f"guess{i}xx", "new_password": "whatever12"},
            headers=h,
        )
        assert r.status_code == 400
    r = await client.post(
        "/users/me/change-password",
        json={"current_password": "rightpass1", "new_password": "whatever12"},
        headers=h,
    )
    assert r.status_code == 429
