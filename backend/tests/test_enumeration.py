"""Username enumeration hardening (security_pass S20)."""
import asyncio

import bcrypt
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker


async def test_unknown_username_still_costs_a_bcrypt_check(client: AsyncClient, monkeypatch):
    """Login does the same work whether or not the user exists, so its timing
    doesn't tell an attacker which usernames are registered."""
    await client.post("/auth/register", json={"username": "realuser", "password": "realpass1"})

    calls = []
    real_checkpw = bcrypt.checkpw

    def counting_checkpw(pw, hashed):
        calls.append(hashed)
        return real_checkpw(pw, hashed)

    monkeypatch.setattr("app.auth.bcrypt.checkpw", counting_checkpw)

    r = await client.post("/auth/login", data={"username": "nobody_here", "password": "whatever1"})
    assert r.status_code == 401
    r2 = await client.post("/auth/login", data={"username": "realuser", "password": "wrongpass1"})
    assert r2.status_code == 401
    assert len(calls) == 2  # one bcrypt check each
    assert r.json() == r2.json()  # and the same answer


async def test_concurrent_registration_of_one_name_is_400_not_500(client: AsyncClient, db):
    from app.database import get_db
    from main import app

    factory = async_sessionmaker(db.bind, expire_on_commit=False)

    async def per_request_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = per_request_db
    results = await asyncio.gather(*[
        client.post("/auth/register", json={"username": "samename", "password": "samepass1"})
        for _ in range(4)
    ])
    codes = sorted(r.status_code for r in results)
    assert codes == [201, 400, 400, 400], codes
