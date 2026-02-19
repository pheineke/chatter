"""
Tests for @mention parsing in channel messages.
"""
import pytest
from tests.conftest import create_server, register_and_login


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _create_channel(client, server_id, headers, name="general"):
    r = await client.post(
        f"/servers/{server_id}/channels",
        json={"title": name, "type": "text"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

async def test_message_without_mention(client, alice_headers):
    server = await create_server(client, alice_headers, "Srv1")
    channel_id = await _create_channel(client, server["id"], alice_headers)

    r = await client.post(
        f"/channels/{channel_id}/messages",
        json={"content": "Hello world!"},
        headers=alice_headers,
    )
    assert r.status_code == 201
    assert r.json()["mentions"] == []


async def test_user_mention_parsed(client, alice_headers, bob_headers):
    """@bob in a channel message should create a user Mention for bob."""
    server = await create_server(client, alice_headers, "MentionSrv")
    server_id = server["id"]
    channel_id = await _create_channel(client, server_id, alice_headers)

    # Bob joins the server
    r = await client.post(f"/servers/{server_id}/join", headers=bob_headers)
    assert r.status_code == 200, r.text

    # Get bob's user ID
    r = await client.get("/users/me", headers=bob_headers)
    bob_id = r.json()["id"]

    # Alice sends a message mentioning Bob
    r = await client.post(
        f"/channels/{channel_id}/messages",
        json={"content": "Hey @bob, welcome!"},
        headers=alice_headers,
    )
    assert r.status_code == 201
    data = r.json()
    assert len(data["mentions"]) == 1
    m = data["mentions"][0]
    assert m["mentioned_user_id"] == bob_id
    assert m["mentioned_username"] == "bob"
    assert m["mentioned_role_id"] is None


async def test_nonmember_mention_ignored(client, alice_headers, bob_headers):
    """@bob should NOT create a Mention if bob isn't a member of the server."""
    server = await create_server(client, alice_headers, "NonMemberSrv")
    channel_id = await _create_channel(client, server["id"], alice_headers)

    # Bob is NOT joined

    r = await client.post(
        f"/channels/{channel_id}/messages",
        json={"content": "Hey @bob, are you there?"},
        headers=alice_headers,
    )
    assert r.status_code == 201
    assert r.json()["mentions"] == []


async def test_role_mention_parsed(client, alice_headers):
    """@Admin in a message should create a role Mention for the Admin role."""
    server = await create_server(client, alice_headers, "RoleMentionSrv")
    server_id = server["id"]
    channel_id = await _create_channel(client, server_id, alice_headers)

    # Fetch the auto-created Admin role id
    r = await client.get(f"/servers/{server_id}/roles", headers=alice_headers)
    assert r.status_code == 200
    roles = r.json()
    admin_role = next((ro for ro in roles if ro["name"] == "Admin"), None)
    assert admin_role is not None

    r = await client.post(
        f"/channels/{channel_id}/messages",
        json={"content": "Attention @Admin!"},
        headers=alice_headers,
    )
    assert r.status_code == 201
    data = r.json()
    assert len(data["mentions"]) == 1
    m = data["mentions"][0]
    assert m["mentioned_role_id"] == admin_role["id"]
    assert m["mentioned_role_name"] == "Admin"
    assert m["mentioned_user_id"] is None


async def test_edit_message_reparses_mentions(client, alice_headers, bob_headers):
    """Editing a message should drop old mentions and re-parse new ones."""
    server = await create_server(client, alice_headers, "EditMentionSrv")
    server_id = server["id"]
    channel_id = await _create_channel(client, server_id, alice_headers)

    # Bob joins
    await client.post(f"/servers/{server_id}/join", headers=bob_headers)

    # Send message with no mention
    r = await client.post(
        f"/channels/{channel_id}/messages",
        json={"content": "Plain message"},
        headers=alice_headers,
    )
    assert r.status_code == 201
    msg_id = r.json()["id"]
    assert r.json()["mentions"] == []

    # Edit to add a mention
    r = await client.patch(
        f"/channels/{channel_id}/messages/{msg_id}",
        json={"content": "Now mentioning @bob"},
        headers=alice_headers,
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data["mentions"]) == 1
    assert data["mentions"][0]["mentioned_username"] == "bob"

    # Edit again to remove the mention
    r = await client.patch(
        f"/channels/{channel_id}/messages/{msg_id}",
        json={"content": "No one mentioned"},
        headers=alice_headers,
    )
    assert r.status_code == 200
    assert r.json()["mentions"] == []


async def test_multiple_mentions(client, alice_headers, bob_headers):
    """A message can mention both a user and a role at once."""
    server = await create_server(client, alice_headers, "MultiMentionSrv")
    server_id = server["id"]
    channel_id = await _create_channel(client, server_id, alice_headers)

    # Bob joins
    await client.post(f"/servers/{server_id}/join", headers=bob_headers)

    r = await client.get("/users/me", headers=bob_headers)
    bob_id = r.json()["id"]

    r = await client.post(
        f"/channels/{channel_id}/messages",
        json={"content": "@bob and @Admin please check!"},
        headers=alice_headers,
    )
    assert r.status_code == 201
    mentions = r.json()["mentions"]
    assert len(mentions) == 2
    user_mentions = [m for m in mentions if m["mentioned_user_id"] is not None]
    role_mentions = [m for m in mentions if m["mentioned_role_id"] is not None]
    assert len(user_mentions) == 1
    assert len(role_mentions) == 1
    assert user_mentions[0]["mentioned_user_id"] == bob_id
