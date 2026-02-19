"""Tests for direct messages (/dms)."""
import uuid
import pytest
from httpx import AsyncClient


# ---------------------------------------------------------------------------
# Send & list
# ---------------------------------------------------------------------------

async def test_send_dm(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    r = await client.post(
        f"/dms/{bob_id}", json={"content": "Hey Bob!"}, headers=alice_headers
    )
    assert r.status_code == 201
    data = r.json()
    assert data["content"] == "Hey Bob!"
    assert data["sender"]["username"] == "alice"
    assert data["recipient"]["username"] == "bob"


async def test_cannot_dm_yourself(client: AsyncClient, alice_headers):
    alice_id = (await client.get("/users/me", headers=alice_headers)).json()["id"]
    r = await client.post(
        f"/dms/{alice_id}", json={"content": "hello me"}, headers=alice_headers
    )
    assert r.status_code == 400


async def test_list_dms_between_users(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    alice_id = (await client.get("/users/me", headers=alice_headers)).json()["id"]

    await client.post(f"/dms/{bob_id}", json={"content": "a->b 1"}, headers=alice_headers)
    await client.post(f"/dms/{bob_id}", json={"content": "a->b 2"}, headers=alice_headers)
    await client.post(f"/dms/{alice_id}", json={"content": "b->a 1"}, headers=bob_headers)

    # Alice views conversation with Bob
    r = await client.get(f"/dms/{bob_id}", headers=alice_headers)
    assert r.status_code == 200
    contents = [m["content"] for m in r.json()]
    assert "a->b 1" in contents
    assert "a->b 2" in contents
    assert "b->a 1" in contents


async def test_list_dms_limit(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    for i in range(10):
        await client.post(f"/dms/{bob_id}", json={"content": f"msg {i}"}, headers=alice_headers)

    r = await client.get(f"/dms/{bob_id}", params={"limit": 3}, headers=alice_headers)
    assert r.status_code == 200
    assert len(r.json()) == 3


async def test_list_dms_empty_conversation(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    r = await client.get(f"/dms/{bob_id}", headers=alice_headers)
    assert r.status_code == 200
    assert r.json() == []


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

async def test_delete_own_dm(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    dm_r = await client.post(
        f"/dms/{bob_id}", json={"content": "delete me"}, headers=alice_headers
    )
    dm_id = dm_r.json()["id"]

    r = await client.delete(f"/dms/{dm_id}", headers=alice_headers)
    assert r.status_code == 204


async def test_cannot_delete_other_users_dm(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    dm_r = await client.post(
        f"/dms/{bob_id}", json={"content": "alice's message"}, headers=alice_headers
    )
    dm_id = dm_r.json()["id"]

    r = await client.delete(f"/dms/{dm_id}", headers=bob_headers)
    assert r.status_code == 403


async def test_delete_nonexistent_dm(client: AsyncClient, alice_headers):
    r = await client.delete(f"/dms/{uuid.uuid4()}", headers=alice_headers)
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------

async def test_dm_attachment_invalid_type(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    dm = (
        await client.post(f"/dms/{bob_id}", json={"content": "with file"}, headers=alice_headers)
    ).json()

    r = await client.post(
        f"/dms/{dm['id']}/attachments",
        files={"file": ("script.sh", b"#!/bin/bash", "text/x-sh")},
        headers=alice_headers,
    )
    assert r.status_code == 400


async def test_dm_image_attachment(client: AsyncClient, alice_headers, bob_headers):
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00"
        b"\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18"
        b"\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    dm = (
        await client.post(f"/dms/{bob_id}", json={"content": "see pic"}, headers=alice_headers)
    ).json()

    r = await client.post(
        f"/dms/{dm['id']}/attachments",
        files={"file": ("photo.png", png_bytes, "image/png")},
        headers=alice_headers,
    )
    assert r.status_code == 200
    assert len(r.json()["attachments"]) == 1
