"""Refresh-token rotation races and reuse handling (docs/security_pass.md S7)."""
import asyncio

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import settings
from app.database import get_db


async def _login(client: AsyncClient, name: str) -> dict:
    await client.post("/auth/register", json={"username": name, "password": "password1"})
    r = await client.post("/auth/login", data={"username": name, "password": "password1"})
    assert r.status_code == 200, r.text
    return r.json()


async def _refresh(client: AsyncClient, rt: str):
    return await client.post("/auth/refresh", json={"refresh_token": rt})


async def test_concurrent_refresh_has_one_winner(client: AsyncClient, db):
    """Two tabs refreshing the same token at once must not fork the session:
    exactly one gets a new pair."""
    from main import app

    rt = (await _login(client, "racer"))["refresh_token"]

    # The client fixture shares one session; real requests each get their own.
    factory = async_sessionmaker(db.bind, expire_on_commit=False)

    async def per_request_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = per_request_db
    results = await asyncio.gather(*[_refresh(client, rt) for _ in range(5)])
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 401, 401, 401, 401], codes


async def test_replay_inside_grace_window_keeps_other_sessions(client: AsyncClient):
    other = (await _login(client, "graceful"))["refresh_token"]
    rt = (await _login(client, "graceful"))["refresh_token"]

    winner = await _refresh(client, rt)
    assert winner.status_code == 200
    assert (await _refresh(client, rt)).status_code == 401  # the losing tab

    # Neither the winner's new token nor the other device were wiped.
    assert (await _refresh(client, winner.json()["refresh_token"])).status_code == 200
    assert (await _refresh(client, other)).status_code == 200


async def test_replay_after_grace_window_wipes_sessions(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "refresh_reuse_grace_seconds", 0)
    other = (await _login(client, "stolen"))["refresh_token"]
    rt = (await _login(client, "stolen"))["refresh_token"]

    winner = await _refresh(client, rt)
    assert winner.status_code == 200
    await asyncio.sleep(0.01)
    assert (await _refresh(client, rt)).status_code == 401

    assert (await _refresh(client, winner.json()["refresh_token"])).status_code == 401
    assert (await _refresh(client, other)).status_code == 401


async def test_logged_out_token_replay_does_not_wipe_other_sessions(client: AsyncClient, monkeypatch):
    """A device that was logged out (or whose session was revoked) and still
    tries to refresh must not log the user out everywhere."""
    monkeypatch.setattr(settings, "refresh_reuse_grace_seconds", 0)
    keep = await _login(client, "loggedout")
    gone = (await _login(client, "loggedout"))["refresh_token"]

    await client.post("/auth/logout", json={"refresh_token": gone})
    assert (await _refresh(client, gone)).status_code == 401
    assert (await _refresh(client, keep["refresh_token"])).status_code == 200


async def test_revoked_session_replay_does_not_wipe_revoker(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "refresh_reuse_grace_seconds", 0)
    me = await _login(client, "revoker")
    victim = (await _login(client, "revoker"))["refresh_token"]
    headers = {"Authorization": f"Bearer {me['access_token']}"}

    sessions = (await client.get("/auth/sessions", headers=headers)).json()
    other_id = next(s["id"] for s in sessions if not s["is_current"])
    assert (await client.delete(f"/auth/sessions/{other_id}", headers=headers)).status_code == 204

    assert (await _refresh(client, victim)).status_code == 401
    assert (await client.get("/auth/sessions", headers=headers)).status_code == 200
    assert (await _refresh(client, me["refresh_token"])).status_code == 200
