"""Tests for /users endpoints."""
import pytest
from httpx import AsyncClient


async def test_get_me(client: AsyncClient, alice_headers):
    r = await client.get("/users/me", headers=alice_headers)
    assert r.status_code == 200
    data = r.json()
    assert data["username"] == "alice"
    assert data["avatar"] is None
    assert data["description"] is None


async def test_update_me_description(client: AsyncClient, alice_headers):
    r = await client.patch(
        "/users/me",
        json={"description": "Hello, I'm Alice"},
        headers=alice_headers,
    )
    assert r.status_code == 200
    assert r.json()["description"] == "Hello, I'm Alice"


async def test_update_me_status(client: AsyncClient, alice_headers):
    for status in ("online", "away", "dnd", "offline"):
        r = await client.patch("/users/me", json={"status": status}, headers=alice_headers)
        assert r.status_code == 200
        assert r.json()["status"] == status


async def test_update_me_unauthenticated(client: AsyncClient):
    r = await client.patch("/users/me", json={"description": "x"})
    assert r.status_code == 401


async def test_get_user_by_id(client: AsyncClient, alice_headers, bob_headers):
    # Get alice's id
    me = (await client.get("/users/me", headers=alice_headers)).json()
    # Bob fetches Alice's profile
    r = await client.get(f"/users/{me['id']}", headers=bob_headers)
    assert r.status_code == 200
    assert r.json()["username"] == "alice"


async def test_get_user_not_found(client: AsyncClient, alice_headers):
    import uuid
    r = await client.get(f"/users/{uuid.uuid4()}", headers=alice_headers)
    assert r.status_code == 404


async def test_avatar_upload_invalid_type(client: AsyncClient, alice_headers):
    r = await client.post(
        "/users/me/avatar",
        files={"file": ("test.txt", b"some text", "text/plain")},
        headers=alice_headers,
    )
    assert r.status_code == 400


async def test_avatar_upload_valid(client: AsyncClient, alice_headers, tmp_path):
    # Create a minimal 1x1 PNG (89 bytes)
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00"
        b"\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18"
        b"\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    r = await client.post(
        "/users/me/avatar",
        files={"file": ("avatar.png", png_bytes, "image/png")},
        headers=alice_headers,
    )
    assert r.status_code == 200
    assert r.json()["avatar"] is not None
    assert r.json()["avatar"].endswith(".png")
