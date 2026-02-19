"""Tests for friend requests, accepting/declining, listing, and removal."""
import uuid
import pytest
from httpx import AsyncClient


# ---------------------------------------------------------------------------
# Sending requests
# ---------------------------------------------------------------------------

async def test_send_friend_request(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    r = await client.post(
        "/friends/requests", json={"recipient_id": bob_id}, headers=alice_headers
    )
    assert r.status_code == 201
    data = r.json()
    assert data["status"] == "pending"
    assert data["sender"]["username"] == "alice"
    assert data["recipient"]["username"] == "bob"


async def test_cannot_send_request_to_self(client: AsyncClient, alice_headers):
    alice_id = (await client.get("/users/me", headers=alice_headers)).json()["id"]
    r = await client.post(
        "/friends/requests", json={"recipient_id": alice_id}, headers=alice_headers
    )
    assert r.status_code == 400


async def test_cannot_send_request_to_unknown_user(client: AsyncClient, alice_headers):
    r = await client.post(
        "/friends/requests", json={"recipient_id": str(uuid.uuid4())}, headers=alice_headers
    )
    assert r.status_code == 404


async def test_cannot_send_duplicate_request(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    await client.post(
        "/friends/requests", json={"recipient_id": bob_id}, headers=alice_headers
    )
    r = await client.post(
        "/friends/requests", json={"recipient_id": bob_id}, headers=alice_headers
    )
    assert r.status_code == 400


async def test_cannot_send_reverse_request_while_pending(
    client: AsyncClient, alice_headers, bob_headers
):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    alice_id = (await client.get("/users/me", headers=alice_headers)).json()["id"]

    await client.post(
        "/friends/requests", json={"recipient_id": bob_id}, headers=alice_headers
    )
    r = await client.post(
        "/friends/requests", json={"recipient_id": alice_id}, headers=bob_headers
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Listing requests
# ---------------------------------------------------------------------------

async def test_list_pending_requests(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    await client.post(
        "/friends/requests", json={"recipient_id": bob_id}, headers=alice_headers
    )

    # Sender sees it
    r = await client.get("/friends/requests", headers=alice_headers)
    assert r.status_code == 200
    assert len(r.json()) == 1

    # Recipient sees it too
    r = await client.get("/friends/requests", headers=bob_headers)
    assert r.status_code == 200
    assert len(r.json()) == 1


# ---------------------------------------------------------------------------
# Accept / decline
# ---------------------------------------------------------------------------

async def test_accept_request(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    req = (
        await client.post(
            "/friends/requests", json={"recipient_id": bob_id}, headers=alice_headers
        )
    ).json()

    r = await client.post(f"/friends/requests/{req['id']}/accept", headers=bob_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "accepted"


async def test_decline_request(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    req = (
        await client.post(
            "/friends/requests", json={"recipient_id": bob_id}, headers=alice_headers
        )
    ).json()

    r = await client.post(f"/friends/requests/{req['id']}/decline", headers=bob_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "declined"


async def test_only_recipient_can_accept(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    req = (
        await client.post(
            "/friends/requests", json={"recipient_id": bob_id}, headers=alice_headers
        )
    ).json()

    # Alice (sender) tries to accept her own request
    r = await client.post(f"/friends/requests/{req['id']}/accept", headers=alice_headers)
    assert r.status_code == 403


async def test_cannot_accept_already_accepted(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    req = (
        await client.post(
            "/friends/requests", json={"recipient_id": bob_id}, headers=alice_headers
        )
    ).json()
    await client.post(f"/friends/requests/{req['id']}/accept", headers=bob_headers)

    r = await client.post(f"/friends/requests/{req['id']}/accept", headers=bob_headers)
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Friends list
# ---------------------------------------------------------------------------

async def test_list_friends(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    req = (
        await client.post(
            "/friends/requests", json={"recipient_id": bob_id}, headers=alice_headers
        )
    ).json()
    await client.post(f"/friends/requests/{req['id']}/accept", headers=bob_headers)

    r = await client.get("/friends/", headers=alice_headers)
    assert r.status_code == 200
    usernames = [f["user"]["username"] for f in r.json()]
    assert "bob" in usernames

    r = await client.get("/friends/", headers=bob_headers)
    usernames = [f["user"]["username"] for f in r.json()]
    assert "alice" in usernames


async def test_friends_list_empty_before_accept(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    await client.post(
        "/friends/requests", json={"recipient_id": bob_id}, headers=alice_headers
    )
    r = await client.get("/friends/", headers=alice_headers)
    assert r.status_code == 200
    assert r.json() == []


# ---------------------------------------------------------------------------
# Remove friend
# ---------------------------------------------------------------------------

async def test_remove_friend(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    req = (
        await client.post(
            "/friends/requests", json={"recipient_id": bob_id}, headers=alice_headers
        )
    ).json()
    await client.post(f"/friends/requests/{req['id']}/accept", headers=bob_headers)

    r = await client.delete(f"/friends/{bob_id}", headers=alice_headers)
    assert r.status_code == 204

    r = await client.get("/friends/", headers=alice_headers)
    assert r.json() == []


async def test_remove_nonexistent_friend(client: AsyncClient, alice_headers):
    r = await client.delete(f"/friends/{uuid.uuid4()}", headers=alice_headers)
    assert r.status_code == 404


async def test_cannot_befriend_after_decline(client: AsyncClient, alice_headers, bob_headers):
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    req = (
        await client.post(
            "/friends/requests", json={"recipient_id": bob_id}, headers=alice_headers
        )
    ).json()
    await client.post(f"/friends/requests/{req['id']}/decline", headers=bob_headers)

    # Alice can try again (declined doesn't block re-requests)
    r = await client.post(
        "/friends/requests", json={"recipient_id": bob_id}, headers=alice_headers
    )
    assert r.status_code == 201  # new request allowed after decline
