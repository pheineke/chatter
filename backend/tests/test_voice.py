"""
Tests for the voice signaling system.

Part 1 – VoiceManager unit tests (no HTTP transport needed).
Part 2 – Integration tests via starlette sync TestClient.
"""
from __future__ import annotations

import asyncio
import threading
import uuid

import pytest
from starlette.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

# ============================================================================
# Part 1 – VoiceManager unit tests
# ============================================================================

class _MockWS:
    """Minimal WebSocket stub."""

    def __init__(self):
        self.accepted = False
        self.sent: list[dict] = []
        self._closed = False

    async def accept(self):
        self.accepted = True

    async def send_text(self, text: str):
        import json
        if self._closed:
            raise RuntimeError("closed")
        self.sent.append(json.loads(text))

    def close(self):
        self._closed = True


async def test_voice_manager_connect_sends_member_list():
    from app.voice_manager import VoiceManager
    mgr = VoiceManager()
    cid = uuid.uuid4()
    uid = uuid.uuid4()
    ws = _MockWS()
    await mgr.connect(cid, uid, ws)
    assert ws.accepted
    # First message must be voice.members list
    assert ws.sent[0]["type"] == "voice.members"
    assert any(p["user_id"] == str(uid) for p in ws.sent[0]["data"])


async def test_voice_manager_connect_broadcasts_joined_to_others():
    from app.voice_manager import VoiceManager
    mgr = VoiceManager()
    cid = uuid.uuid4()
    uid_a, uid_b = uuid.uuid4(), uuid.uuid4()
    ws_a, ws_b = _MockWS(), _MockWS()
    await mgr.connect(cid, uid_a, ws_a)
    await mgr.connect(cid, uid_b, ws_b)
    # A should receive a voice.user_joined event about B
    joined_events = [m for m in ws_a.sent if m["type"] == "voice.user_joined"]
    assert len(joined_events) == 1
    assert joined_events[0]["data"]["user_id"] == str(uid_b)


async def test_voice_manager_disconnect_broadcasts_left():
    from app.voice_manager import VoiceManager
    mgr = VoiceManager()
    cid = uuid.uuid4()
    uid_a, uid_b = uuid.uuid4(), uuid.uuid4()
    ws_a, ws_b = _MockWS(), _MockWS()
    await mgr.connect(cid, uid_a, ws_a)
    await mgr.connect(cid, uid_b, ws_b)
    await mgr.disconnect(cid, uid_b)
    left_events = [m for m in ws_a.sent if m["type"] == "voice.user_left"]
    assert len(left_events) == 1
    assert left_events[0]["data"]["user_id"] == str(uid_b)


async def test_voice_manager_update_state_mute():
    from app.voice_manager import VoiceManager
    mgr = VoiceManager()
    cid = uuid.uuid4()
    uid = uuid.uuid4()
    ws = _MockWS()
    await mgr.connect(cid, uid, ws)
    await mgr.update_state(cid, uid, is_muted=True)
    state_events = [m for m in ws.sent if m["type"] == "voice.state_changed"]
    assert state_events[-1]["data"]["is_muted"] is True


async def test_voice_manager_update_state_all_flags():
    from app.voice_manager import VoiceManager
    mgr = VoiceManager()
    cid = uuid.uuid4()
    uid = uuid.uuid4()
    ws = _MockWS()
    await mgr.connect(cid, uid, ws)
    await mgr.update_state(
        cid, uid,
        is_muted=True, is_deafened=True,
        is_sharing_screen=True, is_sharing_webcam=True,
    )
    state_event = [m for m in ws.sent if m["type"] == "voice.state_changed"][-1]["data"]
    assert state_event["is_muted"] is True
    assert state_event["is_deafened"] is True
    assert state_event["is_sharing_screen"] is True
    assert state_event["is_sharing_webcam"] is True


async def test_voice_manager_relay_offer():
    from app.voice_manager import VoiceManager
    mgr = VoiceManager()
    cid = uuid.uuid4()
    uid_a, uid_b = uuid.uuid4(), uuid.uuid4()
    ws_a, ws_b = _MockWS(), _MockWS()
    await mgr.connect(cid, uid_a, ws_a)
    await mgr.connect(cid, uid_b, ws_b)
    payload = {"type": "offer", "to": str(uid_b), "sdp": "v=0..."}
    await mgr.relay(cid, uid_a, uid_b, payload)
    relayed = [m for m in ws_b.sent if m["type"] == "offer"]
    assert len(relayed) == 1
    assert relayed[0]["from"] == str(uid_a)
    assert relayed[0]["sdp"] == "v=0..."
    # A should NOT receive the relay
    assert not any(m["type"] == "offer" for m in ws_a.sent)


async def test_voice_manager_relay_ignores_missing_target():
    from app.voice_manager import VoiceManager
    mgr = VoiceManager()
    cid = uuid.uuid4()
    uid_a = uuid.uuid4()
    uid_ghost = uuid.uuid4()
    ws_a = _MockWS()
    await mgr.connect(cid, uid_a, ws_a)
    # relay to a user not in the room — should not raise
    await mgr.relay(cid, uid_a, uid_ghost, {"type": "offer", "sdp": "..."})


async def test_voice_manager_get_participants():
    from app.voice_manager import VoiceManager
    mgr = VoiceManager()
    cid = uuid.uuid4()
    uid_a, uid_b = uuid.uuid4(), uuid.uuid4()
    assert mgr.get_participants(cid) == []
    await mgr.connect(cid, uid_a, _MockWS())
    await mgr.connect(cid, uid_b, _MockWS())
    parts = mgr.get_participants(cid)
    assert len(parts) == 2
    ids = {p["user_id"] for p in parts}
    assert str(uid_a) in ids
    assert str(uid_b) in ids


async def test_voice_manager_disconnect_cleans_empty_room():
    from app.voice_manager import VoiceManager
    mgr = VoiceManager()
    cid = uuid.uuid4()
    uid = uuid.uuid4()
    await mgr.connect(cid, uid, _MockWS())
    await mgr.disconnect(cid, uid)
    assert cid not in mgr._rooms


# ============================================================================
# Part 2 – Integration tests (starlette sync TestClient)
# ============================================================================

DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="module")
def voice_app():
    import os, sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

    from main import app
    from app.database import get_db
    from models.base import Base

    engine = create_async_engine(
        DB_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool
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

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()

    async def _teardown():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()

    asyncio.run(_teardown())


def _token(tc: TestClient, user: str, pw: str = "pass123") -> str:
    tc.post("/auth/register", json={"username": user, "password": pw})
    r = tc.post("/auth/login", data={"username": user, "password": pw})
    return r.json()["access_token"]


def _setup_voice_channel(tc: TestClient, owner_token: str) -> tuple[str, str]:
    """Create a server + voice channel, return (server_id, channel_id)."""
    r = tc.post("/servers/", json={"title": "VoiceSrv"}, headers={"Authorization": f"Bearer {owner_token}"})
    server_id = r.json()["id"]
    r = tc.post(
        f"/servers/{server_id}/channels",
        json={"title": "voice-general", "type": "voice"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    channel_id = r.json()["id"]
    return server_id, channel_id


# --- REST endpoint ----------------------------------------------------------

def test_rest_voice_members_empty(voice_app):
    """GET members on a channel with no active connections returns empty list."""
    token = _token(voice_app, "vmembers_user")
    _, channel_id = _setup_voice_channel(voice_app, token)
    r = voice_app.get(f"/channels/{channel_id}/voice/members")
    assert r.status_code == 200
    assert r.json() == []


# --- WebSocket auth ----------------------------------------------------------

def test_voice_ws_invalid_token_rejected(voice_app):
    token = _token(voice_app, "vauth_user")
    _, channel_id = _setup_voice_channel(voice_app, token)
    with pytest.raises(Exception):
        with voice_app.websocket_connect(f"/ws/voice/{channel_id}?token=BAD") as ws:
            ws.receive_json()


def test_voice_ws_text_channel_rejected(voice_app):
    """Connecting to a text channel via voice WS should be rejected."""
    token = _token(voice_app, "vtextchan_user")
    r = voice_app.post(
        "/servers/", json={"title": "VSrv"}, headers={"Authorization": f"Bearer {token}"}
    )
    server_id = r.json()["id"]
    r = voice_app.post(
        f"/servers/{server_id}/channels",
        json={"title": "text-only", "type": "text"},
        headers={"Authorization": f"Bearer {token}"},
    )
    channel_id = r.json()["id"]
    with pytest.raises(Exception):
        with voice_app.websocket_connect(f"/ws/voice/{channel_id}?token={token}") as ws:
            ws.receive_json()


def test_voice_ws_nonmember_rejected(voice_app):
    owner_token = _token(voice_app, "vowner_mem")
    guest_token = _token(voice_app, "vguest_mem")
    _, channel_id = _setup_voice_channel(voice_app, owner_token)
    with pytest.raises(Exception):
        with voice_app.websocket_connect(f"/ws/voice/{channel_id}?token={guest_token}") as ws:
            ws.receive_json()


# --- Join / leave -----------------------------------------------------------

def test_voice_ws_accepted_and_member_list(voice_app):
    """Connecting as a server member should succeed and immediately deliver member list."""
    token = _token(voice_app, "vjoin_user")
    _, channel_id = _setup_voice_channel(voice_app, token)
    with voice_app.websocket_connect(f"/ws/voice/{channel_id}?token={token}") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "voice.members"
        assert isinstance(msg["data"], list)


def test_voice_ws_user_appears_in_rest_members(voice_app):
    """While connected, the user should show up in the REST members list."""
    token = _token(voice_app, "vrest_user")
    _, channel_id = _setup_voice_channel(voice_app, token)

    results: list[list] = []

    def _ws_thread():
        with voice_app.websocket_connect(f"/ws/voice/{channel_id}?token={token}") as ws:
            ws.receive_json()  # consume voice.members
            # Signal main thread
            results.append(
                voice_app.get(f"/channels/{channel_id}/voice/members").json()
            )
            # Let main thread finish assertion then exit
            ws.close()

    t = threading.Thread(target=_ws_thread)
    t.start()
    t.join(timeout=10)

    assert len(results) == 1
    assert len(results[0]) == 1  # our user


# --- State changes ----------------------------------------------------------

def test_voice_ws_mute_broadcast(voice_app):
    """Sending mute=true should broadcast voice.state_changed with is_muted=true."""
    token = _token(voice_app, "vmute_user")
    _, channel_id = _setup_voice_channel(voice_app, token)

    events: list[dict] = []

    with voice_app.websocket_connect(f"/ws/voice/{channel_id}?token={token}") as ws:
        ws.receive_json()  # voice.members

        def _send_mute():
            import time; time.sleep(0.05)
            ws.send_json({"type": "mute", "is_muted": True})

        t = threading.Thread(target=_send_mute)
        t.start()
        events.append(ws.receive_json())
        t.join()

    assert events[0]["type"] == "voice.state_changed"
    assert events[0]["data"]["is_muted"] is True


def test_voice_ws_deafen_broadcast(voice_app):
    token = _token(voice_app, "vdeafen_user")
    _, channel_id = _setup_voice_channel(voice_app, token)

    events: list[dict] = []

    with voice_app.websocket_connect(f"/ws/voice/{channel_id}?token={token}") as ws:
        ws.receive_json()  # voice.members

        def _send():
            import time; time.sleep(0.05)
            ws.send_json({"type": "deafen", "is_deafened": True})

        t = threading.Thread(target=_send)
        t.start()
        events.append(ws.receive_json())
        t.join()

    assert events[0]["type"] == "voice.state_changed"
    assert events[0]["data"]["is_deafened"] is True


def test_voice_ws_screen_share_broadcast(voice_app):
    token = _token(voice_app, "vscreen_user")
    _, channel_id = _setup_voice_channel(voice_app, token)

    events: list[dict] = []

    with voice_app.websocket_connect(f"/ws/voice/{channel_id}?token={token}") as ws:
        ws.receive_json()  # voice.members

        def _send():
            import time; time.sleep(0.05)
            ws.send_json({"type": "screen_share", "enabled": True})

        t = threading.Thread(target=_send)
        t.start()
        events.append(ws.receive_json())
        t.join()

    assert events[0]["type"] == "voice.state_changed"
    assert events[0]["data"]["is_sharing_screen"] is True


def test_voice_ws_webcam_broadcast(voice_app):
    token = _token(voice_app, "vwebcam_user")
    _, channel_id = _setup_voice_channel(voice_app, token)

    events: list[dict] = []

    with voice_app.websocket_connect(f"/ws/voice/{channel_id}?token={token}") as ws:
        ws.receive_json()  # voice.members

        def _send():
            import time; time.sleep(0.05)
            ws.send_json({"type": "webcam", "enabled": True})

        t = threading.Thread(target=_send)
        t.start()
        events.append(ws.receive_json())
        t.join()

    assert events[0]["type"] == "voice.state_changed"
    assert events[0]["data"]["is_sharing_webcam"] is True


# --- Signaling relay --------------------------------------------------------

def test_voice_ws_offer_relay(voice_app):
    """
    Two users in the same voice channel: A sends an offer to B; B should
    receive it with a 'from' field set to A's user_id.
    """
    token_a = _token(voice_app, "voffer_a")
    token_b = _token(voice_app, "voffer_b")

    server_id, channel_id = _setup_voice_channel(voice_app, token_a)
    # B joins the server
    voice_app.post(
        f"/servers/{server_id}/join",
        headers={"Authorization": f"Bearer {token_b}"},
    )

    # Get A's user_id
    r_a = voice_app.get("/users/me", headers={"Authorization": f"Bearer {token_a}"})
    a_user_id = r_a.json()["id"]
    r_b = voice_app.get("/users/me", headers={"Authorization": f"Bearer {token_b}"})
    b_user_id = r_b.json()["id"]

    b_events: list[dict] = []
    b_ready = threading.Event()
    b_done = threading.Event()

    def _b_thread():
        with voice_app.websocket_connect(f"/ws/voice/{channel_id}?token={token_b}") as ws_b:
            ws_b.receive_json()  # voice.members (just B)
            b_ready.set()
            # Wait for the offer (or a joined event + offer)
            while True:
                msg = ws_b.receive_json()
                b_events.append(msg)
                if msg["type"] == "offer":
                    break
        b_done.set()

    t_b = threading.Thread(target=_b_thread)
    t_b.start()
    b_ready.wait(timeout=5)

    with voice_app.websocket_connect(f"/ws/voice/{channel_id}?token={token_a}") as ws_a:
        ws_a.receive_json()  # voice.members (A + B)
        # consume the voice.user_joined that B may receive
        import time; time.sleep(0.1)
        ws_a.send_json({"type": "offer", "to": b_user_id, "sdp": "v=0 test-sdp"})
        b_done.wait(timeout=5)

    # Find the offer event that B received
    offer_events = [e for e in b_events if e["type"] == "offer"]
    assert len(offer_events) == 1
    assert offer_events[0]["from"] == a_user_id
    assert offer_events[0]["sdp"] == "v=0 test-sdp"
    t_b.join(timeout=5)


def test_voice_ws_user_left_on_disconnect(voice_app):
    """When a user disconnects, others receive a voice.user_left event."""
    token_a = _token(voice_app, "vleft_a")
    token_b = _token(voice_app, "vleft_b")
    server_id, channel_id = _setup_voice_channel(voice_app, token_a)
    voice_app.post(
        f"/servers/{server_id}/join",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    r_b = voice_app.get("/users/me", headers={"Authorization": f"Bearer {token_b}"})
    b_user_id = r_b.json()["id"]

    a_events: list[dict] = []
    a_ready = threading.Event()
    a_done = threading.Event()

    def _a_thread():
        with voice_app.websocket_connect(f"/ws/voice/{channel_id}?token={token_a}") as ws_a:
            ws_a.receive_json()  # voice.members
            a_ready.set()
            while True:
                msg = ws_a.receive_json()
                a_events.append(msg)
                if msg["type"] == "voice.user_left":
                    break
        a_done.set()

    t_a = threading.Thread(target=_a_thread)
    t_a.start()
    a_ready.wait(timeout=5)

    with voice_app.websocket_connect(f"/ws/voice/{channel_id}?token={token_b}") as ws_b:
        ws_b.receive_json()  # voice.members
        # A gets voice.user_joined; then B disconnects

    a_done.wait(timeout=5)

    left_events = [e for e in a_events if e["type"] == "voice.user_left"]
    assert len(left_events) == 1
    assert left_events[0]["data"]["user_id"] == b_user_id
    t_a.join(timeout=5)
