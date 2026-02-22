"""Tests for categories, channels, permissions and mute under /servers/{id}/."""
import uuid
import pytest
from httpx import AsyncClient

from tests.conftest import create_server, create_channel


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

async def test_create_category(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    r = await client.post(
        f"/servers/{s['id']}/categories",
        json={"title": "Text Channels", "position": 0},
        headers=alice_headers,
    )
    assert r.status_code == 201
    assert r.json()["title"] == "Text Channels"


async def test_create_category_non_admin_forbidden(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    r = await client.post(
        f"/servers/{s['id']}/categories", json={"title": "Unauthorized"}, headers=bob_headers
    )
    assert r.status_code == 403


async def test_list_categories(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    await client.post(
        f"/servers/{s['id']}/categories", json={"title": "Cat A"}, headers=alice_headers
    )
    await client.post(
        f"/servers/{s['id']}/categories", json={"title": "Cat B"}, headers=alice_headers
    )
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    r = await client.get(f"/servers/{s['id']}/categories", headers=bob_headers)
    assert r.status_code == 200
    titles = [c["title"] for c in r.json()]
    assert "Cat A" in titles
    assert "Cat B" in titles


async def test_update_category(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    cat_r = await client.post(
        f"/servers/{s['id']}/categories", json={"title": "Old"}, headers=alice_headers
    )
    cat_id = cat_r.json()["id"]
    r = await client.patch(
        f"/servers/{s['id']}/categories/{cat_id}", json={"title": "New"}, headers=alice_headers
    )
    assert r.status_code == 200
    assert r.json()["title"] == "New"


async def test_delete_category(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    cat_r = await client.post(
        f"/servers/{s['id']}/categories", json={"title": "Temp"}, headers=alice_headers
    )
    cat_id = cat_r.json()["id"]
    r = await client.delete(
        f"/servers/{s['id']}/categories/{cat_id}", headers=alice_headers
    )
    assert r.status_code == 204


async def test_update_category_not_found(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    r = await client.patch(
        f"/servers/{s['id']}/categories/{uuid.uuid4()}", json={"title": "X"}, headers=alice_headers
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------

async def test_create_text_channel(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    r = await client.post(
        f"/servers/{s['id']}/channels",
        json={"title": "general", "type": "text"},
        headers=alice_headers,
    )
    assert r.status_code == 201
    data = r.json()
    assert data["title"] == "general"
    assert data["type"] == "text"


async def test_create_voice_channel(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    r = await client.post(
        f"/servers/{s['id']}/channels",
        json={"title": "Voice 1", "type": "voice"},
        headers=alice_headers,
    )
    assert r.status_code == 201
    assert r.json()["type"] == "voice"


async def test_create_channel_with_category(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    cat = (
        await client.post(
            f"/servers/{s['id']}/categories", json={"title": "Text"}, headers=alice_headers
        )
    ).json()
    r = await client.post(
        f"/servers/{s['id']}/channels",
        json={"title": "announcements", "type": "text", "category_id": cat["id"]},
        headers=alice_headers,
    )
    assert r.status_code == 201
    assert r.json()["category_id"] == cat["id"]


async def test_create_channel_non_admin_forbidden(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    r = await client.post(
        f"/servers/{s['id']}/channels", json={"title": "hack"}, headers=bob_headers
    )
    assert r.status_code == 403


async def test_list_channels_as_member(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    await create_channel(client, alice_headers, s["id"], "alpha")
    await create_channel(client, alice_headers, s["id"], "beta")
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)

    r = await client.get(f"/servers/{s['id']}/channels", headers=bob_headers)
    assert r.status_code == 200
    titles = [c["title"] for c in r.json()]
    assert "alpha" in titles
    assert "beta" in titles


async def test_update_channel(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"], "old-name")
    r = await client.patch(
        f"/servers/{s['id']}/channels/{ch['id']}",
        json={"title": "new-name"},
        headers=alice_headers,
    )
    assert r.status_code == 200
    assert r.json()["title"] == "new-name"


async def test_delete_channel(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    r = await client.delete(
        f"/servers/{s['id']}/channels/{ch['id']}", headers=alice_headers
    )
    assert r.status_code == 204


# ---------------------------------------------------------------------------
# Channel permissions
# ---------------------------------------------------------------------------

async def test_set_channel_permission(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    roles_r = await client.get(f"/servers/{s['id']}/roles", headers=alice_headers)
    role_id = roles_r.json()[0]["id"]

    # allow VIEW_CHANNEL (1) only — SEND_MESSAGES (2) denied
    r = await client.put(
        f"/servers/{s['id']}/channels/{ch['id']}/permissions/{role_id}",
        json={"allow_bits": 1, "deny_bits": 2},
        headers=alice_headers,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["allow_bits"] == 1
    assert data["deny_bits"] == 2


async def test_list_channel_permissions(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    roles_r = await client.get(f"/servers/{s['id']}/roles", headers=alice_headers)
    role_id = roles_r.json()[0]["id"]
    # allow VIEW_CHANNEL | SEND_MESSAGES | MANAGE_MESSAGES (bits 0-2)
    await client.put(
        f"/servers/{s['id']}/channels/{ch['id']}/permissions/{role_id}",
        json={"allow_bits": 7, "deny_bits": 0},
        headers=alice_headers,
    )
    r = await client.get(
        f"/servers/{s['id']}/channels/{ch['id']}/permissions", headers=alice_headers
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 1
    assert data[0]["allow_bits"] == 7


# ---------------------------------------------------------------------------
# Mute / unmute
# ---------------------------------------------------------------------------

async def test_mute_and_unmute_channel(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])

    r = await client.post(
        f"/servers/{s['id']}/channels/{ch['id']}/mute", headers=alice_headers
    )
    assert r.status_code == 204

    r = await client.delete(
        f"/servers/{s['id']}/channels/{ch['id']}/mute", headers=alice_headers
    )
    assert r.status_code == 204


async def test_mute_idempotent(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])

    await client.post(f"/servers/{s['id']}/channels/{ch['id']}/mute", headers=alice_headers)
    r = await client.post(
        f"/servers/{s['id']}/channels/{ch['id']}/mute", headers=alice_headers
    )
    assert r.status_code == 204  # second mute is a no-op
