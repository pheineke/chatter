"""
WebSocket tests.

Manager unit tests use plain asyncio (no HTTP).
Integration tests use starlette's sync TestClient (supports ws_connect)
with a disposable in-memory SQLite database.
"""
import asyncio
import threading
import uuid
from datetime import datetime

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
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

    from tests.conftest import install_session_factory, make_test_engine

    engine = make_test_engine(threaded=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    restore_sessions = install_session_factory(session_factory)

    async def _setup():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_setup())

    async def _override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()
    restore_sessions()

    async def _teardown():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()

    asyncio.run(_teardown())


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

        # The personal socket also carries presence (user.status_changed on
        # connect), so skip unrelated frames until the one under test arrives.
        for _ in range(10):
            event = ws.receive_json()
            if event["type"] == "dm.read_updated":
                event_holder.append(event)
                break
        t.join()

    assert len(event_holder) == 1
    assert event_holder[0]["type"] == "dm.read_updated"
    assert event_holder[0]["data"]["channel_id"] == channel_id
    assert datetime.fromisoformat(event_holder[0]["data"]["last_read_at"].replace("Z", "+00:00")) == datetime.fromisoformat(read_at)



# ---------------------------------------------------------------------------
# Channel permission enforcement on WebSockets (S3 / @everyone)
# ---------------------------------------------------------------------------

def _private_channel_setup(ws_app, prefix: str, kind: str = "text"):
    """Owner makes a channel private (@everyone denied View Channel), then
    invites a member who holds no role that re-allows it."""
    owner = _get_token(ws_app, f"{prefix}_owner")
    member = _get_token(ws_app, f"{prefix}_member")
    oh = {"Authorization": f"Bearer {owner}"}
    mh = {"Authorization": f"Bearer {member}"}
    server_id = ws_app.post("/servers/", json={"title": f"{prefix}"}, headers=oh).json()["id"]
    channel_id = ws_app.post(
        f"/servers/{server_id}/channels", json={"title": "hidden", "type": kind}, headers=oh
    ).json()["id"]
    code = ws_app.post(f"/servers/{server_id}/invites", json={}, headers=oh).json()["code"]
    assert ws_app.post(f"/invites/{code}/join", headers=mh).status_code == 200
    everyone = next(r for r in ws_app.get(f"/servers/{server_id}/roles", headers=oh).json() if r["is_default"])
    r = ws_app.put(
        f"/servers/{server_id}/channels/{channel_id}/permissions/{everyone['id']}",
        json={"allow_bits": 0, "deny_bits": 1},  # VIEW_CHANNEL
        headers=oh,
    )
    assert r.status_code == 200, r.text
    return owner, member, channel_id


def _assert_rejected(ws_app, path: str, token: str, code: int = 4003):
    """Auth succeeds, then the server must close with *code*. If the check is
    missing the socket stays open and this blocks; the pytest-timeout marker
    on the calling tests turns that into a failure instead of a hung suite."""
    with pytest.raises(WebSocketDisconnect) as exc:
        with ws_app.websocket_connect(path) as ws:
            assert _ws_authenticate(ws, token)["type"] == "auth.ok"
            ws.receive_json()
    assert exc.value.code == code


@pytest.mark.timeout(15)
def test_ws_private_channel_rejects_member_without_view(ws_app):
    owner, member, channel_id = _private_channel_setup(ws_app, "wspriv")
    _assert_rejected(ws_app, f"/ws/channels/{channel_id}", member)
    # The owner still gets in.
    with ws_app.websocket_connect(f"/ws/channels/{channel_id}") as ws:
        assert _ws_authenticate(ws, owner)["type"] == "auth.ok"


@pytest.mark.timeout(15)
def test_ws_private_voice_channel_rejects_member_without_view(ws_app):
    _, member, channel_id = _private_channel_setup(ws_app, "wsvpriv", kind="voice")
    _assert_rejected(ws_app, f"/ws/voice/{channel_id}", member)



# ---------------------------------------------------------------------------
# S11: open sockets follow access changes (app/ws_enforcement.py)
# ---------------------------------------------------------------------------

def _expect_close(ws, code: int, max_frames: int = 25):
    """Read (and ignore) frames until the server closes the socket; assert the code."""
    with pytest.raises(WebSocketDisconnect) as exc:
        for _ in range(max_frames):
            ws.receive_json()
    assert exc.value.code == code


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _server_with_member(ws_app, prefix: str, kind: str = "text"):
    owner = _get_token(ws_app, f"{prefix}_own")
    member = _get_token(ws_app, f"{prefix}_mem")
    server_id = ws_app.post("/servers/", json={"title": prefix}, headers=_h(owner)).json()["id"]
    channel_id = ws_app.post(
        f"/servers/{server_id}/channels", json={"title": "c", "type": kind}, headers=_h(owner)
    ).json()["id"]
    code = ws_app.post(f"/servers/{server_id}/invites", json={}, headers=_h(owner)).json()["code"]
    assert ws_app.post(f"/invites/{code}/join", headers=_h(member)).status_code == 200
    member_id = ws_app.get("/users/me", headers=_h(member)).json()["id"]
    return owner, member, member_id, server_id, channel_id


def _everyone_id(ws_app, owner, server_id):
    roles = ws_app.get(f"/servers/{server_id}/roles", headers=_h(owner)).json()
    return next(r["id"] for r in roles if r["is_default"])


@pytest.mark.timeout(20)
def test_revoked_session_closes_its_sockets(ws_app):
    _get_token(ws_app, "s11_sess")  # registers
    a = ws_app.post("/auth/login", data={"username": "s11_sess", "password": "pass1234"}).json()
    b = ws_app.post("/auth/login", data={"username": "s11_sess", "password": "pass1234"}).json()
    sessions = ws_app.get("/auth/sessions", headers=_h(a["access_token"])).json()
    b_sid = next(s["id"] for s in sessions if not s["is_current"])

    with ws_app.websocket_connect("/ws/me") as ws_a, ws_app.websocket_connect("/ws/me") as ws_b:
        assert _ws_authenticate(ws_a, a["access_token"])["type"] == "auth.ok"
        assert _ws_authenticate(ws_b, b["access_token"])["type"] == "auth.ok"
        assert ws_app.delete(f"/auth/sessions/{b_sid}", headers=_h(a["access_token"])).status_code == 204
        _expect_close(ws_b, 4001)
        # The other session's socket is untouched.
        ws_a.send_json({"type": "ping"})


@pytest.mark.timeout(20)
def test_logout_closes_that_sessions_sockets(ws_app):
    _get_token(ws_app, "s11_logout")
    t = ws_app.post("/auth/login", data={"username": "s11_logout", "password": "pass1234"}).json()
    with ws_app.websocket_connect("/ws/me") as ws:
        assert _ws_authenticate(ws, t["access_token"])["type"] == "auth.ok"
        assert ws_app.post("/auth/logout", json={"refresh_token": t["refresh_token"]}).status_code == 204
        _expect_close(ws, 4001)


@pytest.mark.timeout(20)
def test_kick_closes_server_and_channel_sockets(ws_app):
    owner, member, member_id, server_id, channel_id = _server_with_member(ws_app, "s11kick")
    with ws_app.websocket_connect(f"/ws/servers/{server_id}") as ws_srv, \
         ws_app.websocket_connect(f"/ws/channels/{channel_id}") as ws_ch:
        assert _ws_authenticate(ws_srv, member)["type"] == "auth.ok"
        assert _ws_authenticate(ws_ch, member)["type"] == "auth.ok"
        r = ws_app.delete(f"/servers/{server_id}/members/{member_id}", headers=_h(owner))
        assert r.status_code == 204
        _expect_close(ws_srv, 4003)  # after receiving the member_kicked event
        _expect_close(ws_ch, 4003)


@pytest.mark.timeout(20)
def test_ban_closes_voice_socket(ws_app):
    owner, member, member_id, server_id, channel_id = _server_with_member(ws_app, "s11ban", kind="voice")
    with ws_app.websocket_connect(f"/ws/voice/{channel_id}") as ws:
        assert _ws_authenticate(ws, member)["type"] == "auth.ok"
        assert ws_app.post(f"/servers/{server_id}/bans/{member_id}", headers=_h(owner)).status_code == 204
        _expect_close(ws, 4003)


@pytest.mark.timeout(20)
def test_making_channel_private_closes_member_socket(ws_app):
    owner, member, _mid, server_id, channel_id = _server_with_member(ws_app, "s11priv")
    everyone = _everyone_id(ws_app, owner, server_id)
    with ws_app.websocket_connect(f"/ws/channels/{channel_id}") as ws_mem, \
         ws_app.websocket_connect(f"/ws/channels/{channel_id}") as ws_own:
        assert _ws_authenticate(ws_mem, member)["type"] == "auth.ok"
        assert _ws_authenticate(ws_own, owner)["type"] == "auth.ok"
        r = ws_app.put(
            f"/servers/{server_id}/channels/{channel_id}/permissions/{everyone}",
            json={"allow_bits": 0, "deny_bits": 1},
            headers=_h(owner),
        )
        assert r.status_code == 200
        _expect_close(ws_mem, 4003)
        # Owner keeps the stream: a new message still arrives.
        ws_app.post(f"/channels/{channel_id}/messages", json={"content": "still here"}, headers=_h(owner))
        for _ in range(10):
            ev = ws_own.receive_json()
            if ev["type"] == "message.created":
                assert ev["data"]["content"] == "still here"
                break
        else:
            pytest.fail("owner stopped receiving channel events")


@pytest.mark.timeout(20)
def test_losing_role_closes_socket_of_private_channel(ws_app):
    owner, member, member_id, server_id, channel_id = _server_with_member(ws_app, "s11role")
    everyone = _everyone_id(ws_app, owner, server_id)
    vip = ws_app.post(f"/servers/{server_id}/roles", json={"name": "VIP"}, headers=_h(owner)).json()["id"]
    ws_app.put(f"/servers/{server_id}/channels/{channel_id}/permissions/{everyone}",
               json={"allow_bits": 0, "deny_bits": 1}, headers=_h(owner))
    ws_app.put(f"/servers/{server_id}/channels/{channel_id}/permissions/{vip}",
               json={"allow_bits": 1, "deny_bits": 0}, headers=_h(owner))
    ws_app.post(f"/servers/{server_id}/members/{member_id}/roles/{vip}", headers=_h(owner))

    with ws_app.websocket_connect(f"/ws/channels/{channel_id}") as ws:
        assert _ws_authenticate(ws, member)["type"] == "auth.ok"
        r = ws_app.delete(f"/servers/{server_id}/members/{member_id}/roles/{vip}", headers=_h(owner))
        assert r.status_code == 204
        _expect_close(ws, 4003)


@pytest.mark.timeout(20)
def test_private_channel_activity_not_announced_to_non_viewers(ws_app):
    owner, member, _mid, server_id, hidden = _server_with_member(ws_app, "s11badge")
    visible = ws_app.post(f"/servers/{server_id}/channels", json={"title": "open", "type": "text"},
                          headers=_h(owner)).json()["id"]
    everyone = _everyone_id(ws_app, owner, server_id)
    ws_app.put(f"/servers/{server_id}/channels/{hidden}/permissions/{everyone}",
               json={"allow_bits": 0, "deny_bits": 1}, headers=_h(owner))

    with ws_app.websocket_connect(f"/ws/servers/{server_id}") as ws:
        assert _ws_authenticate(ws, member)["type"] == "auth.ok"
        ws_app.post(f"/channels/{hidden}/messages", json={"content": "secret"}, headers=_h(owner))
        ws_app.post(f"/channels/{visible}/messages", json={"content": "hi"}, headers=_h(owner))
        for _ in range(15):
            ev = ws.receive_json()
            if ev["type"] == "channel.message":
                # The first badge the member sees must be for the visible channel.
                assert ev["data"]["channel_id"] == visible
                break
        else:
            pytest.fail("no channel.message received")
