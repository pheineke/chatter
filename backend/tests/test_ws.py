"""
WebSocket tests.

Manager unit tests use plain asyncio (no HTTP).
Integration tests use starlette's sync TestClient (supports ws_connect)
with a disposable in-memory SQLite database.
"""
import asyncio
import os
import tempfile
import threading
import uuid
from datetime import datetime

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
    # connect() no longer accepts the socket itself — that now happens as
    # part of the auth handshake (app/ws_auth.py) before connect() is called.
    await ws.accept()
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
    await ws.accept()
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
    await ws.accept()
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
    await ws1.accept()
    await ws2.accept()
    await mgr.connect(room, ws1)
    await mgr.connect(room, ws2)
    await mgr.broadcast_channel(cid, {"type": "hello"})
    assert len(ws1.sent) == 1
    assert len(ws2.sent) == 1


# ---------------------------------------------------------------------------
# Integration tests via starlette sync TestClient
# ---------------------------------------------------------------------------

# A file, not ":memory:". Tables are created here via asyncio.run(), which
# closes that event loop when it finishes; TestClient then runs the app in a
# different loop and thread. An in-memory SQLite database belongs to the
# connection that made it, so the app's loop would open a fresh, empty one and
# every query would fail with "no such table". A file is shared by every
# connection regardless of loop or thread.
_DB_FD, _DB_PATH = tempfile.mkstemp(suffix=".sqlite3", prefix="chatter-ws-test-")
os.close(_DB_FD)
DB_URL_SYNC = f"sqlite+aiosqlite:///{_DB_PATH}"


@pytest.fixture(scope="module")
def ws_app():
    """
    Starlette TestClient backed by an in-memory SQLite database.
    Shared across all tests in this module (module scope).
    """
    import os, sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

    from main import app
    from app.database import get_db, reset_session_factory, set_session_factory
    from models.base import Base

    # No StaticPool: it pins the engine to one connection, and that connection
    # belongs to the loop that opened it — the one asyncio.run() below closes.
    # Reusing it afterwards fails with "no active connection". Pooling normally
    # is fine now the database is a file every connection can reach.
    engine = create_async_engine(
        DB_URL_SYNC,
        connect_args={"check_same_thread": False},
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _setup():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_setup())

    async def _override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    # WebSocket handlers have no request-scoped dependency to hang a session
    # on, so they open their own via app.database.session_factory(). Overriding
    # get_db alone leaves them pointed at the configured Postgres, holding none
    # of this module's fixture data.
    set_session_factory(session_factory)

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()
    reset_session_factory()

    # No drop_all: the database is a temp file we're about to delete, and
    # WebSocket connections opened during these tests may still be closing,
    # holding a lock that makes DROP TABLE fail with "database is locked".
    async def _teardown():
        await engine.dispose()

    asyncio.run(_teardown())
    try:
        os.unlink(_DB_PATH)
    except OSError:
        pass


def _get_token(ws_app: TestClient, username: str, password: str = "pass1234") -> str:
    ws_app.post("/auth/register", json={"username": username, "password": password})
    r = ws_app.post("/auth/login", data={"username": username, "password": password})
    return r.json()["access_token"]


def _ws_authenticate(ws, token: str) -> dict:
    """Send the post-connect auth frame and return the server's ack.

    Every endpoint now accepts the connection first and expects
    {"type": "auth", "token": ...} as the first client frame (see
    app/ws_auth.py) instead of a `?token=` query param.
    """
    ws.send_json({"type": "auth", "token": token})
    return ws.receive_json()


def test_ws_me_invalid_token_rejected(ws_app):
    """A bad token should cause the server to close the connection after
    the auth frame is rejected (no auth.ok, and the next receive raises)."""
    with pytest.raises(Exception):
        with ws_app.websocket_connect("/ws/me") as ws:
            ws.send_json({"type": "auth", "token": "this_is_wrong"})
            ws.receive_json()


def test_ws_me_valid_token_accepted(ws_app):
    """A valid token should result in an auth.ok ack."""
    token = _get_token(ws_app, "ws_me_user")
    with ws_app.websocket_connect("/ws/me") as ws:
        ack = _ws_authenticate(ws, token)
        assert ack["type"] == "auth.ok"


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

    with ws_app.websocket_connect(f"/ws/channels/{channel_id}") as ws:
        ack = _ws_authenticate(ws, token)
        assert ack["type"] == "auth.ok"


def test_ws_server_non_member_rejected(ws_app):
    """A user who is not a member of a server should authenticate fine
    (their token is valid) but then get rejected (4003) by the membership
    check that runs right after."""
    owner_token = _get_token(ws_app, "ws_srv_owner")
    guest_token = _get_token(ws_app, "ws_srv_guest")

    r = ws_app.post(
        "/servers/",
        json={"title": "PrivateServer"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    server_id = r.json()["id"]

    with pytest.raises(Exception):
        with ws_app.websocket_connect(f"/ws/servers/{server_id}") as ws:
            ack = _ws_authenticate(ws, guest_token)
            assert ack["type"] == "auth.ok"  # token itself is valid
            ws.receive_json()  # membership check closes the connection here


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

    with ws_app.websocket_connect(f"/ws/channels/{channel_id}") as ws:
        _ws_authenticate(ws, token)
        # Auth.ok confirms the client is authenticated, but the server still
        # has one more await (membership check) before it registers this
        # socket in the room via manager.connect(). Give it a beat before
        # triggering the broadcast, so we don't race it (same pattern used
        # in test_voice.py for the equivalent cross-WS timing).
        import time; time.sleep(0.05)
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


def test_ws_me_receives_dm_read_updated_event(ws_app):
    """Marking a DM as read should broadcast dm.read_updated to the user's personal WS."""
    alice_token = _get_token(ws_app, "ws_dm_read_alice")
    bob_token = _get_token(ws_app, "ws_dm_read_bob")
    alice_headers = {"Authorization": f"Bearer {alice_token}"}
    bob_headers = {"Authorization": f"Bearer {bob_token}"}

    bob_id = ws_app.get("/users/me", headers=bob_headers).json()["id"]
    dm = ws_app.get(f"/dms/{bob_id}/channel", headers=alice_headers)
    channel_id = dm.json()["channel_id"]

    event_holder: list[dict] = []
    read_at = "2026-03-12T00:00:00+00:00"

    with ws_app.websocket_connect("/ws/me") as ws:
        _ws_authenticate(ws, alice_token)
        import time; time.sleep(0.05)   # let manager.connect() land before we trigger the broadcast
        def _mark_read():
            ws_app.put(
                f"/dms/channels/{channel_id}/read",
                json={"last_read_at": read_at},
                headers=alice_headers,
            )

        t = threading.Thread(target=_mark_read)
        t.start()

        # The personal room carries more than one kind of event — connecting
        # publishes a presence change, so "user.status_changed" can arrive
        # first. Read until the one under test shows up rather than assuming
        # it's frame zero.
        for _ in range(5):
            event = ws.receive_json()
            if event["type"] == "dm.read_updated":
                event_holder.append(event)
                break
        t.join()

    assert len(event_holder) == 1, "never received dm.read_updated"
    assert event_holder[0]["data"]["channel_id"] == channel_id
    assert datetime.fromisoformat(event_holder[0]["data"]["last_read_at"].replace("Z", "+00:00")) == datetime.fromisoformat(read_at)
