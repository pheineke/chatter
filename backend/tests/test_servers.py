"""Tests for /servers endpoints (CRUD, members, roles)."""
import uuid
import pytest
from httpx import AsyncClient

from tests.conftest import create_server


# ---------------------------------------------------------------------------
# Server CRUD
# ---------------------------------------------------------------------------

async def test_create_server(client: AsyncClient, alice_headers):
    r = await client.post(
        "/servers/", json={"title": "My Server", "description": "desc"}, headers=alice_headers
    )
    assert r.status_code == 201
    data = r.json()
    assert data["title"] == "My Server"
    assert data["description"] == "desc"
    assert "id" in data


async def test_list_servers_shows_only_joined(client: AsyncClient, alice_headers, bob_headers):
    await create_server(client, alice_headers, "Alice's Server")
    await create_server(client, bob_headers, "Bob's Server")

    r = await client.get("/servers/", headers=alice_headers)
    assert r.status_code == 200
    titles = [s["title"] for s in r.json()]
    assert "Alice's Server" in titles
    assert "Bob's Server" not in titles


async def test_get_server_as_member(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    r = await client.get(f"/servers/{s['id']}", headers=alice_headers)
    assert r.status_code == 200
    assert r.json()["id"] == s["id"]


async def test_get_server_not_member(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    r = await client.get(f"/servers/{s['id']}", headers=bob_headers)
    assert r.status_code == 403


async def test_update_server_by_owner(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers, "Old Title")
    r = await client.patch(
        f"/servers/{s['id']}", json={"title": "New Title"}, headers=alice_headers
    )
    assert r.status_code == 200
    assert r.json()["title"] == "New Title"


async def test_update_server_by_non_admin(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    r = await client.patch(
        f"/servers/{s['id']}", json={"title": "Hijacked"}, headers=bob_headers
    )
    assert r.status_code == 403


async def test_delete_server_by_owner(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    r = await client.delete(f"/servers/{s['id']}", headers=alice_headers)
    assert r.status_code == 204
    r = await client.get(f"/servers/{s['id']}", headers=alice_headers)
    assert r.status_code in (403, 404)


async def test_delete_server_by_non_owner(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    r = await client.delete(f"/servers/{s['id']}", headers=bob_headers)
    assert r.status_code == 403


async def test_get_nonexistent_server(client: AsyncClient, alice_headers):
    r = await client.get(f"/servers/{uuid.uuid4()}", headers=alice_headers)
    assert r.status_code in (403, 404)


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------

async def test_join_server(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    r = await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    assert r.status_code == 200

    r = await client.get(f"/servers/{s['id']}/members", headers=alice_headers)
    usernames = [m["user"]["username"] for m in r.json()]
    assert "bob" in usernames


async def test_join_server_twice(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    r = await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    assert r.status_code == 400


async def test_leave_server(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)

    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    r = await client.delete(f"/servers/{s['id']}/members/{bob_id}", headers=bob_headers)
    assert r.status_code == 204


async def test_owner_cannot_be_kicked(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)

    # Give bob admin role first
    roles_r = await client.get(f"/servers/{s['id']}/roles", headers=alice_headers)
    admin_role_id = roles_r.json()[0]["id"]
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]
    await client.post(f"/servers/{s['id']}/members/{bob_id}/roles/{admin_role_id}", headers=alice_headers)

    alice_id = (await client.get("/users/me", headers=alice_headers)).json()["id"]
    r = await client.delete(f"/servers/{s['id']}/members/{alice_id}", headers=bob_headers)
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------

async def test_default_admin_role_created(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    r = await client.get(f"/servers/{s['id']}/roles", headers=alice_headers)
    assert r.status_code == 200
    roles = r.json()
    assert any(role["is_admin"] for role in roles)


async def test_create_role(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    r = await client.post(
        f"/servers/{s['id']}/roles",
        json={"name": "Moderator", "color": "#FF0000"},
        headers=alice_headers,
    )
    assert r.status_code == 201
    assert r.json()["name"] == "Moderator"
    assert r.json()["color"] == "#FF0000"


async def test_create_role_non_admin_forbidden(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)
    r = await client.post(
        f"/servers/{s['id']}/roles", json={"name": "Hacker"}, headers=bob_headers
    )
    assert r.status_code == 403


async def test_update_role(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    role_r = await client.post(
        f"/servers/{s['id']}/roles", json={"name": "OldName"}, headers=alice_headers
    )
    role_id = role_r.json()["id"]
    r = await client.patch(
        f"/servers/{s['id']}/roles/{role_id}", json={"name": "NewName"}, headers=alice_headers
    )
    assert r.status_code == 200
    assert r.json()["name"] == "NewName"


async def test_delete_role(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    role_r = await client.post(
        f"/servers/{s['id']}/roles", json={"name": "Temp"}, headers=alice_headers
    )
    role_id = role_r.json()["id"]
    r = await client.delete(f"/servers/{s['id']}/roles/{role_id}", headers=alice_headers)
    assert r.status_code == 204


async def test_assign_and_remove_role(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    await client.post(f"/servers/{s['id']}/join", headers=bob_headers)

    role_r = await client.post(
        f"/servers/{s['id']}/roles", json={"name": "Member"}, headers=alice_headers
    )
    role_id = role_r.json()["id"]
    bob_id = (await client.get("/users/me", headers=bob_headers)).json()["id"]

    # Assign
    r = await client.post(
        f"/servers/{s['id']}/members/{bob_id}/roles/{role_id}", headers=alice_headers
    )
    assert r.status_code == 204

    # Remove
    r = await client.delete(
        f"/servers/{s['id']}/members/{bob_id}/roles/{role_id}", headers=alice_headers
    )
    assert r.status_code == 204
