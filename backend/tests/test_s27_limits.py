"""Rate limits and size caps added for security_pass S27."""
import asyncio

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from models.decoration_code import DecorationCode
from tests.conftest import register_and_login


async def test_refresh_is_rate_limited_per_ip(client: AsyncClient):
    for _ in range(60):
        r = await client.post("/auth/refresh", json={"refresh_token": "nope"})
        assert r.status_code == 401
    r = await client.post("/auth/refresh", json={"refresh_token": "nope"})
    assert r.status_code == 429
    assert "Retry-After" in r.headers


async def test_decoration_redeem_is_rate_limited(client: AsyncClient):
    h = await register_and_login(client, "guesser", "guesserpass")
    for i in range(10):
        r = await client.post("/decorations/redeem", json={"code": f"WRONG{i}"}, headers=h)
        assert r.status_code == 404
    r = await client.post("/decorations/redeem", json={"code": "WRONG-AGAIN"}, headers=h)
    assert r.status_code == 429


async def test_decoration_code_cannot_be_redeemed_twice_concurrently(client: AsyncClient, db):
    from app.database import get_db
    from main import app

    users = [await register_and_login(client, f"racer{i}", "racerpass1") for i in range(4)]
    db.add(DecorationCode(code="RACE0000RACE0000", frame_id="gold"))
    await db.commit()

    factory = async_sessionmaker(db.bind, expire_on_commit=False)

    async def per_request_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = per_request_db
    results = await asyncio.gather(
        *[client.post("/decorations/redeem", json={"code": "RACE0000RACE0000"}, headers=h) for h in users]
    )
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 400, 400, 400], codes
    async with factory() as s:
        owner = (await s.execute(
            select(DecorationCode.redeemed_by).where(DecorationCode.code == "RACE0000RACE0000")
        )).scalar_one()
    assert owner is not None


async def test_note_length_is_capped(client: AsyncClient):
    a = await register_and_login(client, "noter", "noterpass1")
    b = await register_and_login(client, "noted", "notedpass1")
    b_id = (await client.get("/users/me", headers=b)).json()["id"]

    r = await client.put(f"/users/{b_id}/note", json={"content": "x" * 2048}, headers=a)
    assert r.status_code == 200
    r = await client.put(f"/users/{b_id}/note", json={"content": "x" * 2049}, headers=a)
    assert r.status_code == 422


async def test_note_writes_are_rate_limited(client: AsyncClient):
    a = await register_and_login(client, "noter2", "noterpass1")
    b = await register_and_login(client, "noted2", "notedpass1")
    b_id = (await client.get("/users/me", headers=b)).json()["id"]
    for i in range(60):
        r = await client.put(f"/users/{b_id}/note", json={"content": str(i)}, headers=a)
        assert r.status_code == 200
    r = await client.put(f"/users/{b_id}/note", json={"content": "one more"}, headers=a)
    assert r.status_code == 429


async def test_patch_me_is_rate_limited(client: AsyncClient):
    h = await register_and_login(client, "toggler", "togglerpass")
    for i in range(60):
        r = await client.patch("/users/me", json={"hide_status": i % 2 == 0}, headers=h)
        assert r.status_code == 200, r.text
    r = await client.patch("/users/me", json={"hide_status": True}, headers=h)
    assert r.status_code == 429
