"""Tests for channel messages, replies, reactions, and attachments."""
import uuid
import pytest
from httpx import AsyncClient

from tests.conftest import create_server, create_channel, send_message


# ---------------------------------------------------------------------------
# Send & list
# ---------------------------------------------------------------------------

async def test_send_message(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    r = await client.post(
        f"/channels/{ch['id']}/messages",
        json={"content": "Hello world"},
        headers=alice_headers,
    )
    assert r.status_code == 201
    data = r.json()
    assert data["content"] == "Hello world"
    assert data["author"]["username"] == "alice"
    assert data["is_deleted"] is False


async def test_list_messages(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    for i in range(3):
        await send_message(client, alice_headers, ch["id"], f"msg {i}")

    r = await client.get(f"/channels/{ch['id']}/messages", headers=alice_headers)
    assert r.status_code == 200
    assert len(r.json()) == 3


async def test_list_messages_limit(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    for i in range(10):
        await send_message(client, alice_headers, ch["id"], f"msg {i}")

    r = await client.get(
        f"/channels/{ch['id']}/messages", params={"limit": 5}, headers=alice_headers
    )
    assert r.status_code == 200
    assert len(r.json()) == 5


async def test_list_messages_non_member_forbidden(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    r = await client.get(f"/channels/{ch['id']}/messages", headers=bob_headers)
    assert r.status_code == 403


async def test_send_message_non_member_forbidden(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    r = await client.post(
        f"/channels/{ch['id']}/messages",
        json={"content": "intruder"},
        headers=bob_headers,
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Edit & delete
# ---------------------------------------------------------------------------

async def test_edit_own_message(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    msg = await send_message(client, alice_headers, ch["id"], "original")

    r = await client.patch(
        f"/channels/{ch['id']}/messages/{msg['id']}",
        json={"content": "edited"},
        headers=alice_headers,
    )
    assert r.status_code == 200
    assert r.json()["content"] == "edited"


async def test_edit_other_users_message_forbidden(
    client: AsyncClient, alice_headers, bob_headers
):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    msg = await send_message(client, alice_headers, ch["id"])

    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    r = await client.patch(
        f"/channels/{ch['id']}/messages/{msg['id']}",
        json={"content": "hijacked"},
        headers=bob_headers,
    )
    assert r.status_code == 403


async def test_delete_own_message(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    msg = await send_message(client, alice_headers, ch["id"])

    r = await client.delete(
        f"/channels/{ch['id']}/messages/{msg['id']}", headers=alice_headers
    )
    assert r.status_code == 204

    # Message should no longer appear in list
    r = await client.get(f"/channels/{ch['id']}/messages", headers=alice_headers)
    assert all(m["id"] != msg["id"] for m in r.json())


async def test_admin_can_delete_any_message(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    msg = await send_message(client, bob_headers, ch["id"], "bob's msg")

    r = await client.delete(
        f"/channels/{ch['id']}/messages/{msg['id']}", headers=alice_headers
    )
    assert r.status_code == 204


# ---------------------------------------------------------------------------
# Replies
# ---------------------------------------------------------------------------

async def test_reply_to_message(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    parent = await send_message(client, alice_headers, ch["id"], "parent")

    r = await client.post(
        f"/channels/{ch['id']}/messages",
        json={"content": "reply", "reply_to_id": parent["id"]},
        headers=alice_headers,
    )
    assert r.status_code == 201
    assert r.json()["reply_to_id"] == parent["id"]


# ---------------------------------------------------------------------------
# Reactions
# ---------------------------------------------------------------------------

async def test_add_and_remove_reaction(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    msg = await send_message(client, alice_headers, ch["id"])

    r = await client.post(
        f"/channels/{ch['id']}/messages/{msg['id']}/reactions/👍", headers=alice_headers
    )
    assert r.status_code == 204

    r = await client.delete(
        f"/channels/{ch['id']}/messages/{msg['id']}/reactions/👍", headers=alice_headers
    )
    assert r.status_code == 204


async def test_add_reaction_idempotent(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    msg = await send_message(client, alice_headers, ch["id"])

    await client.post(
        f"/channels/{ch['id']}/messages/{msg['id']}/reactions/❤️", headers=alice_headers
    )
    r = await client.post(
        f"/channels/{ch['id']}/messages/{msg['id']}/reactions/❤️", headers=alice_headers
    )
    assert r.status_code == 204  # second add is a no-op


async def test_multiple_users_can_react(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    msg = await send_message(client, alice_headers, ch["id"])

    await client.post(
        f"/channels/{ch['id']}/messages/{msg['id']}/reactions/🔥", headers=alice_headers
    )
    r = await client.post(
        f"/channels/{ch['id']}/messages/{msg['id']}/reactions/🔥", headers=bob_headers
    )
    assert r.status_code == 204


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------

async def test_upload_attachment_invalid_type(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    msg = await send_message(client, alice_headers, ch["id"])

    r = await client.post(
        f"/channels/{ch['id']}/messages/{msg['id']}/attachments",
        files={"file": ("virus.exe", b"\x00\x01", "application/octet-stream")},
        headers=alice_headers,
    )
    assert r.status_code == 400


async def test_upload_image_attachment(client: AsyncClient, alice_headers):
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00"
        b"\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18"
        b"\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    msg = await send_message(client, alice_headers, ch["id"])

    r = await client.post(
        f"/channels/{ch['id']}/messages/{msg['id']}/attachments",
        files={"file": ("img.png", png_bytes, "image/png")},
        headers=alice_headers,
    )
    assert r.status_code == 200
    assert len(r.json()["attachments"]) == 1
    assert r.json()["attachments"][0]["file_type"] == "image"
