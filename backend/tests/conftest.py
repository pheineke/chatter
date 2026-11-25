"""
Shared pytest fixtures.

Each test function gets its own in-memory SQLite database so tests are fully
isolated.  The `client` fixture exposes an httpx.AsyncClient wired to the
FastAPI app with the real database dependency replaced by the per-test session.
"""
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

# Ensure backend/ is on sys.path whether pytest is run from backend/ or the
# repo root.
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.database import get_db
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

# Default: a fresh file-backed SQLite DB per test. Set TEST_DATABASE_URL to run
# the whole suite against Postgres instead (CI does), e.g.
#   TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:55432/chat_test
# The tables are created and dropped around every test either way.
DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "sqlite")
IS_SQLITE = DATABASE_URL.startswith("sqlite")


def make_test_engine(threaded: bool = False):
    """Engine for the test DB, with one connection per session — like production.

    SQLite: a throwaway file in WAL mode (readers don't block the writer).
    An in-memory DB would force every session onto a single shared
    connection, and then concurrent sessions (e.g. the background notifier
    spawned by send_message, or WebSocket handlers on TestClient's portal
    thread) interfere with each other's transactions in ways production never
    sees. *threaded* is kept for call-site readability; both paths are the same.
    """
    if IS_SQLITE:
        import atexit
        import shutil
        import tempfile

        from sqlalchemy import event

        tmp = tempfile.mkdtemp(prefix="chat-test-")
        atexit.register(shutil.rmtree, tmp, ignore_errors=True)
        engine = create_async_engine(
            f"sqlite+aiosqlite:///{tmp}/test.db",
            connect_args={"check_same_thread": False, "timeout": 30},
            poolclass=NullPool,
        )

        @event.listens_for(engine.sync_engine, "connect")
        def _pragmas(dbapi_conn, _record):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

        return engine
    # NullPool: TestClient-based fixtures hop between event loops, and pooled
    # asyncpg connections are bound to the loop that created them.
    return create_async_engine(DATABASE_URL, poolclass=NullPool)


def install_session_factory(factory) -> "callable":
    """Point every direct user of app.database.AsyncSessionLocal at *factory*.

    Overriding get_db only covers request-scoped sessions. WebSocket auth,
    the WS routers and background notifiers open their own sessions via
    AsyncSessionLocal, which (before this) silently went to the real
    DATABASE_URL — that's why WS tests needed a live Postgres on :5432.
    Returns a callable that restores the originals.
    """
    import app.database as database

    original = database.AsyncSessionLocal
    patched = []
    for mod in list(sys.modules.values()):
        if mod is not None and getattr(mod, "AsyncSessionLocal", None) is original:
            setattr(mod, "AsyncSessionLocal", factory)
            patched.append(mod)

    def restore():
        for mod in patched:
            setattr(mod, "AsyncSessionLocal", original)

    return restore


@pytest_asyncio.fixture()
async def db() -> AsyncSession:
    """A fresh database session for one test function."""
    engine = make_test_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    restore = install_session_factory(session_factory)
    try:
        async with session_factory() as session:
            yield session
    finally:
        restore()
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()


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


async def join_server(
    client: AsyncClient, server_id: str, owner_headers: dict, joiner_headers: dict
) -> None:
    """Join *server_id* the only supported way: owner creates an invite, joiner uses it."""
    r = await client.post(f"/servers/{server_id}/invites", json={}, headers=owner_headers)
    assert r.status_code == 201, r.text
    r = await client.post(f"/invites/{r.json()['code']}/join", headers=joiner_headers)
    assert r.status_code == 200, r.text
