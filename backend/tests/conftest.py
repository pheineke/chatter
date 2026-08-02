"""
Shared pytest fixtures.

Each test function gets its own in-memory SQLite database so tests are fully
isolated.  The `client` fixture exposes an httpx.AsyncClient wired to the
FastAPI app with the real database dependency replaced by the per-test session.

Code that can't receive a Depends(get_db) session — WebSocket handlers, and
background tasks that outlive the request — opens its own via
app.database.session_factory(). This fixture redirects that at the test engine
so those paths see the same data as the request-scoped session.

The database is a file rather than ":memory:" precisely because of them. An
in-memory SQLite database only exists on the connection that created it, so it
has to be pinned to one connection with StaticPool — and a second, concurrent
session then deadlocks waiting for that connection. A file is readable by as
many connections as we need. Durability is switched off below since the file
is discarded at the end of the test.
"""
import tempfile
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Ensure backend/ is on sys.path whether pytest is run from backend/ or the
# repo root.
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.database import get_db, reset_session_factory, set_session_factory
from models.base import Base

# Importing the app at module scope is load-bearing, not just convenience:
# it transitively imports every router and therefore every model module,
# which is what registers those tables on Base.metadata. The `db` fixture
# below calls Base.metadata.create_all(), so anything not imported by then
# simply doesn't get a table — previously the only import of `main` lived
# inside the `client` fixture, which runs *after* `db`, so create_all() saw
# whatever subset of models happened to be imported already. That made table
# creation depend on pytest's collection order: run the suite one way and
# you'd get "no such table: users", run a single file another way and it
# passed.
import main  # noqa: E402,F401  (imported for its import side effects)

# ---------------------------------------------------------------------------
# Database fixture
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture()
async def db() -> AsyncSession:
    """A fresh SQLite database for one test function."""
    fd, db_path = tempfile.mkstemp(suffix=".sqlite3", prefix="chatter-test-")
    os.close(fd)
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )

    # The file is thrown away at the end of the test, so fsync-per-commit buys
    # nothing and costs a lot. WAL additionally lets the app's own sessions
    # read while the fixture session holds a write open, instead of blocking.
    @event.listens_for(engine.sync_engine, "connect")
    def _fast_pragmas(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=OFF")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    test_sessions = async_sessionmaker(engine, expire_on_commit=False)
    set_session_factory(test_sessions)

    async with test_sessions() as session:
        yield session

    reset_session_factory()
    await engine.dispose()
    # Leave the file to the OS temp dir if it's still held: a background task
    # that outlived the request may still be finishing with it, and failing to
    # unlink is not worth failing a test over.
    try:
        os.unlink(db_path)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# HTTP client fixture (overrides get_db with the per-test session above)
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture()
async def client(db: AsyncSession) -> AsyncClient:
    from main import app  # already imported at module scope; cheap lookup

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
    # 8 chars minimum — see the password policy in app/schemas/user.py.
    # "bobpass" (7) predates that rule and made every test depending on this
    # fixture fail at registration with a 422.
    return await register_and_login(client, "bob", "bobpassword")


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
