from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

# The session factory actually used at runtime, looked up through this module
# rather than captured at import time.
#
# Most code receives a session via Depends(get_db). Some can't: WebSocket
# handlers have no request-scoped dependency to hang it on, and fire-and-forget
# background tasks outlive the request whose session they'd otherwise borrow.
# Those paths call session_factory() below.
#
# The indirection exists so tests can point that at their own engine. Modules
# used to do `from app.database import AsyncSessionLocal`, which binds the
# object by value — rebinding it here afterwards had no effect on them, so WS
# handlers kept talking to the configured Postgres while the test's data lived
# in SQLite. Going through a function means there's exactly one place to
# override, and no import-order subtleties.
_session_factory = AsyncSessionLocal


def session_factory() -> AsyncSession:
    """Open a new session against the current engine.

    Call this instead of AsyncSessionLocal() anywhere a Depends(get_db)
    session isn't available.
    """
    return _session_factory()


def set_session_factory(factory) -> None:
    """Point session_factory() at a different sessionmaker.

    Intended for tests; returns nothing so callers keep the previous value
    themselves if they need to restore it.
    """
    global _session_factory
    _session_factory = factory


def reset_session_factory() -> None:
    """Restore the application's own sessionmaker."""
    global _session_factory
    _session_factory = AsyncSessionLocal


async def get_db() -> AsyncSession:
    async with session_factory() as session:
        yield session
