"""
Shared pytest fixtures.

Each test function gets its own in-memory SQLite database so tests are fully
isolated.  The `client` fixture exposes an httpx.AsyncClient wired to the
FastAPI app with the real database dependency replaced by the per-test session.
"""
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

# Ensure backend/ is on sys.path whether pytest is run from backend/ or the
# repo root.
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.database import get_db
from models.base import Base

# ---------------------------------------------------------------------------
# Database fixture
# ---------------------------------------------------------------------------

DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture()
async def db() -> AsyncSession:
    """A fresh in-memory SQLite session for one test function."""
    engine = create_async_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


# ---------------------------------------------------------------------------
# HTTP client fixture (overrides get_db with the per-test session above)
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture()
async def client(db: AsyncSession) -> AsyncClient:
    from main import app

    async def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Authentication helpers
# ---------------------------------------------------------------------------

async def register_and_login(
    client: AsyncClient,
    username: str = "alice",
    password: str = "secret123",
) -> dict[str, str]:
    """Register a user (if not yet present) and return Bearer headers."""
    r = await client.post("/auth/register", json={"username": username, "password": password})
    assert r.status_code in (201, 400), r.text  # 400 = already exists (fine for shared tests)
    r = await client.post("/auth/login", data={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture()
async def alice_headers(client: AsyncClient) -> dict[str, str]:
    return await register_and_login(client, "alice", "alicepass")


@pytest_asyncio.fixture()
async def bob_headers(client: AsyncClient) -> dict[str, str]:
    return await register_and_login(client, "bob", "bobpass")


# ---------------------------------------------------------------------------
# Convenience factories
# ---------------------------------------------------------------------------

async def create_server(client: AsyncClient, headers: dict, title: str = "My Server") -> dict:
    r = await client.post("/servers/", json={"title": title}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def create_channel(
    client: AsyncClient,
    headers: dict,
    server_id: str,
    title: str = "general",
    kind: str = "text",
) -> dict:
    r = await client.post(
        f"/servers/{server_id}/channels",
        json={"title": title, "type": kind},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def send_message(
    client: AsyncClient, headers: dict, channel_id: str, content: str = "hello"
) -> dict:
    r = await client.post(
        f"/channels/{channel_id}/messages",
        json={"content": content},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()
