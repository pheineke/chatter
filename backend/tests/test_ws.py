"""
WebSocket tests.

Manager unit tests use plain asyncio (no HTTP).
Integration tests use starlette's sync TestClient (supports ws_connect)
with a disposable in-memory SQLite database.
"""
import asyncio
import threading
import uuid

import pytest
from starlette.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

# ---------------------------------------------------------------------------
# ConnectionManager unit tests (no app needed)
# ---------------------------------------------------------------------------

class _MockWS:
    """Minimal WebSocket stub for manager unit tests."""

    def __init__(self):
        self.accepted = False
        self.sent: list[str] = []
        self._closed = False

    async def accept(self):
        self.accepted = True

    async def send_text(self, text: str):
        if self._closed:
            raise RuntimeError("WS closed")
        self.sent.append(text)

    def close(self):
        self._closed = True


async def test_manager_connect_broadcast():
    from app.ws_manager import ConnectionManager
    mgr = ConnectionManager()
    ws = _MockWS()
    cid = uuid.uuid4()
    room = mgr.channel_room(cid)
    await mgr.connect(room, ws)
    assert ws.accepted

    await mgr.broadcast_channel(cid, {"type": "ping"})
    assert len(ws.sent) == 1
    import json
    assert json.loads(ws.sent[0]) == {"type": "ping"}


async def test_manager_disconnect_stops_delivery():
    from app.ws_manager import ConnectionManager
    mgr = ConnectionManager()
    ws = _MockWS()
    sid = uuid.uuid4()
    room = mgr.server_room(sid)
    await mgr.connect(room, ws)
    await mgr.disconnect(room, ws)
    await mgr.broadcast_server(sid, {"type": "test"})
    assert ws.sent == []


async def test_manager_dead_socket_pruned():
    """A closed WebSocket should be removed on the next broadcast."""
    from app.ws_manager import ConnectionManager
    mgr = ConnectionManager()
    ws = _MockWS()
    uid = uuid.uuid4()
    room = mgr.user_room(uid)
    await mgr.connect(room, ws)
    ws.close()  # mark dead
    # broadcast should not raise and should remove the dead socket
    await mgr.broadcast_user(uid, {"type": "test"})
    # room should now be gone (empty)
    assert mgr.user_room(uid) not in mgr._rooms


async def test_manager_multiple_subscribers():
    """Events reach every subscriber in a room."""
    from app.ws_manager import ConnectionManager
    mgr = ConnectionManager()
    ws1, ws2 = _MockWS(), _MockWS()
    cid = uuid.uuid4()
    room = mgr.channel_room(cid)
    await mgr.connect(room, ws1)
    await mgr.connect(room, ws2)
    await mgr.broadcast_channel(cid, {"type": "hello"})
    assert len(ws1.sent) == 1
    assert len(ws2.sent) == 1


# ---------------------------------------------------------------------------
# Integration tests via starlette sync TestClient
# ---------------------------------------------------------------------------

DB_URL_SYNC = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="module")
def ws_app():
    """
    Starlette TestClient backed by an in-memory SQLite database.
    Shared across all tests in this module (module scope).
    """
    import os, sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

    from main import app
    from app.database import get_db
    from models.base import Base

    engine = create_async_engine(
        DB_URL_SYNC,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _setup():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_setup())
    asyncio.run(_setup())

    async def _override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()

    async def _teardown():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()

    asyncio.run(_teardown())


def _get_token(ws_app: TestClient, username: str, password: str = "pass123") -> str:
    ws_app.post("/auth/register", json={"username": username, "password": password})
    r = ws_app.post("/auth/login", data={"username": username, "password": password})
    return r.json()["access_token"]


def test_ws_me_invalid_token_rejected(ws_app):
    """A bad token should cause the server to close the connection."""
    with pytest.raises(Exception):
        with ws_app.websocket_connect("/ws/me?token=this_is_wrong") as ws:
            ws.receive_json()


def test_ws_me_valid_token_accepted(ws_app):
    """A valid token should result in an accepted WebSocket connection."""
    token = _get_token(ws_app, "ws_me_user")
    with ws_app.websocket_connect(f"/ws/me?token={token}") as ws:
        pass  # no exception == accepted


def test_ws_channel_valid_token(ws_app):
    """Authenticated user can connect to a channel WS."""
    token = _get_token(ws_app, "ws_chan_owner")
    headers = {"Authorization": f"Bearer {token}"}

    r = ws_app.post("/servers/", json={"title": "WSTestServer"}, headers=headers)
    server_id = r.json()["id"]

    r = ws_app.post(
        f"/servers/{server_id}/channels",
        json={"title": "ws-general", "type": "text"},
        headers=headers,
    )
    channel_id = r.json()["id"]

    with ws_app.websocket_connect(f"/ws/channels/{channel_id}?token={token}") as ws:
        pass  # accepted without error


def test_ws_server_non_member_rejected(ws_app):
    """A user who is not a member of a server should be rejected (4003)."""
    owner_token = _get_token(ws_app, "ws_srv_owner")
    guest_token = _get_token(ws_app, "ws_srv_guest")

    r = ws_app.post(
        "/servers/",
        json={"title": "PrivateServer"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    server_id = r.json()["id"]

    with pytest.raises(Exception):
        with ws_app.websocket_connect(f"/ws/servers/{server_id}?token={guest_token}") as ws:
            ws.receive_json()


def test_ws_channel_receives_message_event(ws_app):
    """
    After sending a message via HTTP the WS subscriber receives a
    message.created event.
    """
    token = _get_token(ws_app, "ws_broadcast_user")
    headers = {"Authorization": f"Bearer {token}"}

    r = ws_app.post("/servers/", json={"title": "BroadcastServer"}, headers=headers)
    server_id = r.json()["id"]

    r = ws_app.post(
        f"/servers/{server_id}/channels",
        json={"title": "bcast-chan", "type": "text"},
        headers=headers,
    )
    channel_id = r.json()["id"]

    event_holder: list[dict] = []

    with ws_app.websocket_connect(f"/ws/channels/{channel_id}?token={token}") as ws:
        # Send the HTTP message from a background thread so we don't block
        def _post():
            ws_app.post(
                f"/channels/{channel_id}/messages",
                json={"content": "broadcast test"},
                headers=headers,
            )

        t = threading.Thread(target=_post)
        t.start()

        event = ws.receive_json()
        event_holder.append(event)
        t.join()

    assert len(event_holder) == 1
    assert event_holder[0]["type"] == "message.created"
    assert event_holder[0]["data"]["content"] == "broadcast test"
