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
