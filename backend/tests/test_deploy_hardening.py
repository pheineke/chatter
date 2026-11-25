"""Deployment hardening: registration modes, backend security headers,
API docs in production (docs/security_pass.md S23, step 6 of the plan)."""
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import update

from app.config import settings
from models.invite import ServerInvite
from tests.conftest import create_server, register_and_login

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


async def _register(client, name, invite_code=None):
    body = {"username": name, "password": "password1"}
    if invite_code is not None:
        body["invite_code"] = invite_code
    return await client.post("/auth/register", json=body)


async def _invite(client, headers, **body):
    server = await create_server(client, headers)
    r = await client.post(f"/servers/{server['id']}/invites", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["code"]


# ---- registration modes ----------------------------------------------------

async def test_auth_config_reports_mode(client: AsyncClient, monkeypatch):
    assert (await client.get("/auth/config")).json() == {"registration_mode": "open"}
    monkeypatch.setattr(settings, "registration_mode", "invite")
    assert (await client.get("/auth/config")).json() == {"registration_mode": "invite"}


async def test_closed_registration(client: AsyncClient, monkeypatch):
    headers = await register_and_login(client, "existing")
    monkeypatch.setattr(settings, "registration_mode", "closed")
    r = await _register(client, "newcomer")
    assert r.status_code == 403
    # existing accounts still work
    assert (await client.get("/users/me", headers=headers)).status_code == 200


async def test_invite_mode_lets_first_account_bootstrap(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "registration_mode", "invite")
    assert (await _register(client, "owner")).status_code == 201
    assert (await _register(client, "second")).status_code == 403


async def test_invite_mode_requires_valid_invite(client: AsyncClient, monkeypatch):
    owner = await register_and_login(client, "owner")
    code = await _invite(client, owner)
    monkeypatch.setattr(settings, "registration_mode", "invite")

    assert (await _register(client, "nocode")).status_code == 403
    assert (await _register(client, "badcode", "not-a-code")).status_code == 403
    r = await _register(client, "invited", code)
    assert r.status_code == 201, r.text
    # registering doesn't use up the invite; joining does
    login = await client.post("/auth/login", data={"username": "invited", "password": "password1"})
    invited = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await client.post(f"/invites/{code}/join", headers=invited)).status_code == 200


@pytest.mark.parametrize("kind", ["expired", "used_up"])
async def test_invite_mode_rejects_dead_invites(client: AsyncClient, db, monkeypatch, kind):
    owner = await register_and_login(client, "owner")
    code = await _invite(client, owner, max_uses=1)
    values = (
        {"expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)}
        if kind == "expired" else {"uses": 1}
    )
    await db.execute(update(ServerInvite).where(ServerInvite.code == code).values(**values))
    await db.commit()
    monkeypatch.setattr(settings, "registration_mode", "invite")
    assert (await _register(client, "late", code)).status_code == 403


# ---- headers ----------------------------------------------------------------

async def test_backend_sets_security_headers(client: AsyncClient, alice_headers):
    r = await client.get("/users/me", headers=alice_headers)
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert "default-src 'none'" in r.headers["content-security-policy"]


async def test_auth_responses_not_cached(client: AsyncClient):
    await _register(client, "cachey")
    r = await client.post("/auth/login", data={"username": "cachey", "password": "password1"})
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"


# ---- API docs ------------------------------------------------------------------

_PROBE = """
from fastapi.testclient import TestClient
import main
c = TestClient(main.app)
print(*(c.get(p).status_code for p in ("/docs", "/redoc", "/openapi.json")))
"""


def _docs_status(environment: str) -> list[int]:
    env = {
        **os.environ,
        "ENVIRONMENT": environment,
        "SECRET_KEY": "x" * 40,
        "DECORATION_ADMIN_IDS": "",
        "DATABASE_URL": "postgresql+asyncpg://chat:pw@localhost/chat",
    }
    out = subprocess.run(
        [sys.executable, "-c", _PROBE], cwd=BACKEND, env=env,
        capture_output=True, text=True, timeout=60,
    )
    assert out.returncode == 0, out.stderr
    return [int(x) for x in out.stdout.split()[-3:]]


def test_api_docs_hidden_in_production():
    assert _docs_status("production") == [404, 404, 404]


def test_api_docs_available_in_development():
    assert _docs_status("development") == [200, 200, 200]
