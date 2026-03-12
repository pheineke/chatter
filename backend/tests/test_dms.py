"""Tests for direct messages (/dms)."""
import pytest
from httpx import AsyncClient


# ---------------------------------------------------------------------------
# GET /dms/{user_id}/channel
# ---------------------------------------------------------------------------

async def test_get_or_create_dm_channel(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    r = await client.get(f"/dms/{bob_id}/channel", headers=alice_headers)
    assert r.status_code == 200
    data = r.json()
    assert "channel_id" in data


async def test_dm_channel_is_idempotent(client: AsyncClient, alice_headers, bob_headers):
    """Calling /channel twice returns the same channel_id."""
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    r1 = await client.get(f"/dms/{bob_id}/channel", headers=alice_headers)
    r2 = await client.get(f"/dms/{bob_id}/channel", headers=alice_headers)
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["channel_id"] == r2.json()["channel_id"]


async def test_dm_channel_symmetric(client: AsyncClient, alice_headers, bob_headers):
    """Alice->Bob and Bob->Alice resolve to the same channel."""
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    alice_id = (await client.get("/users/me", headers=alice_headers)).json()["id"]
    r_alice = await client.get(f"/dms/{bob_id}/channel", headers=alice_headers)
    r_bob = await client.get(f"/dms/{alice_id}/channel", headers=bob_headers)
    assert r_alice.json()["channel_id"] == r_bob.json()["channel_id"]


async def test_cannot_dm_yourself(client: AsyncClient, alice_headers):
    alice_id = (await client.get("/users/me", headers=alice_headers)).json()["id"]
    r = await client.get(f"/dms/{alice_id}/channel", headers=alice_headers)
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# GET /dms/conversations
# ---------------------------------------------------------------------------

async def test_list_conversations_empty(client: AsyncClient, alice_headers):
    r = await client.get("/dms/conversations", headers=alice_headers)
    assert r.status_code == 200
    assert r.json() == []


async def test_list_conversations_after_dm_channel(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    await client.get(f"/dms/{bob_id}/channel", headers=alice_headers)

    r = await client.get("/dms/conversations", headers=alice_headers)
    assert r.status_code == 200
    convs = r.json()
    assert len(convs) >= 1
    assert any(c["other_user"]["id"] == bob_id for c in convs)


async def test_conversation_has_expected_fields(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    await client.get(f"/dms/{bob_id}/channel", headers=alice_headers)

    r = await client.get("/dms/conversations", headers=alice_headers)
    assert r.status_code == 200
    conv = next(c for c in r.json() if c["other_user"]["id"] == bob_id)
    assert "channel_id" in conv
    assert "other_user" in conv
    assert "last_message_at" in conv
    assert "last_read_at" in conv


async def test_mark_dm_read_persists_to_conversations(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    dm = await client.get(f"/dms/{bob_id}/channel", headers=alice_headers)
    channel_id = dm.json()["channel_id"]

    sent = await client.post(
        f"/messages?channel_id={channel_id}",
        json={"content": "hello bob"},
        headers=alice_headers,
    )
    assert sent.status_code == 201

    convs_before = await client.get("/dms/conversations", headers=alice_headers)
    assert convs_before.status_code == 200
    conv_before = next(c for c in convs_before.json() if c["channel_id"] == channel_id)
    assert conv_before["last_message_at"] is not None

    mark = await client.put(
        f"/dms/channels/{channel_id}/read",
        json={"last_read_at": conv_before["last_message_at"]},
        headers=alice_headers,
    )
    assert mark.status_code == 200
    assert mark.json()["channel_id"] == channel_id
    assert mark.json()["last_read_at"] == conv_before["last_message_at"]

    convs_after = await client.get("/dms/conversations", headers=alice_headers)
    assert convs_after.status_code == 200
    conv_after = next(c for c in convs_after.json() if c["channel_id"] == channel_id)
    assert conv_after["last_read_at"] == conv_before["last_message_at"]
