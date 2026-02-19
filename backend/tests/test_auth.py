"""Tests for POST /auth/register and POST /auth/login."""
import pytest
from httpx import AsyncClient


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

async def test_register_success(client: AsyncClient):
    r = await client.post("/auth/register", json={"username": "newuser", "password": "pass1234"})
    assert r.status_code == 201
    data = r.json()
    assert data["username"] == "newuser"
    assert "id" in data
    assert "password_hash" not in data
    assert data["status"] == "offline"


async def test_register_duplicate_username(client: AsyncClient):
    payload = {"username": "dup", "password": "pass"}
    await client.post("/auth/register", json=payload)
    r = await client.post("/auth/register", json=payload)
    assert r.status_code == 400
    assert "already taken" in r.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

async def test_login_success(client: AsyncClient):
    await client.post("/auth/register", json={"username": "loginuser", "password": "mypass"})
    r = await client.post("/auth/login", data={"username": "loginuser", "password": "mypass"})
    assert r.status_code == 200
    data = r.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


async def test_login_wrong_password(client: AsyncClient):
    await client.post("/auth/register", json={"username": "u1", "password": "correct"})
    r = await client.post("/auth/login", data={"username": "u1", "password": "wrong"})
    assert r.status_code == 401


async def test_login_unknown_user(client: AsyncClient):
    r = await client.post("/auth/login", data={"username": "nobody", "password": "x"})
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Protected-route auth
# ---------------------------------------------------------------------------

async def test_protected_route_no_token(client: AsyncClient):
    r = await client.get("/users/me")
    assert r.status_code == 401


async def test_protected_route_bad_token(client: AsyncClient):
    r = await client.get("/users/me", headers={"Authorization": "Bearer notavalidtoken"})
    assert r.status_code == 401


async def test_protected_route_valid_token(client: AsyncClient, alice_headers):
    r = await client.get("/users/me", headers=alice_headers)
    assert r.status_code == 200
    assert r.json()["username"] == "alice"
