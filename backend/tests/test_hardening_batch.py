"""Regression tests for the "quick wins" batch in docs/security_pass.md:
S6 token lifetime guard, S9 edit path, S10 reply scope, S14 usernames.
(S13 voice presence lives in test_voice.py; S5 is deploy config.)
"""
import pytest
from httpx import AsyncClient

from app.config import Settings
from tests.conftest import create_channel, create_server, join_server, register_and_login, send_message


# ---- S6: access token lifetime --------------------------------------------

def _prod(**overrides) -> dict:
    base = dict(
        environment="production",
        secret_key="x" * 40,
        decoration_admin_ids="",
        database_url="postgresql+asyncpg://chat:strong@db:5432/chat",
    )
    base.update(overrides)
    return base


def test_production_rejects_long_access_tokens():
    with pytest.raises(RuntimeError, match="ACCESS_TOKEN_EXPIRE_MINUTES"):
        Settings(**_prod(access_token_expire_minutes=10080))


def test_production_accepts_short_access_tokens():
    assert Settings(**_prod(access_token_expire_minutes=15)).access_token_expire_minutes == 15


def test_env_example_ships_short_tokens():
    import pathlib
    text = (pathlib.Path(__file__).parent.parent / ".env.example").read_text()
    assert "ACCESS_TOKEN_EXPIRE_MINUTES=15" in text


# ---- S9: edits go through the same filters as sends ------------------------

async def test_edit_cannot_bypass_word_filter(client: AsyncClient, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    await join_server(client, s["id"], alice_headers, bob_headers)
    r = await client.post(
        f"/servers/{s['id']}/word-filters", json={"pattern": "badword", "action": "delete"}, headers=alice_headers
    )
    assert r.status_code == 201

    msg = await send_message(client, bob_headers, ch["id"], "perfectly clean")
    r = await client.patch(
        f"/channels/{ch['id']}/messages/{msg['id']}", json={"content": "now a badword"}, headers=bob_headers
    )
    assert r.status_code == 400
    msgs = (await client.get(f"/channels/{ch['id']}/messages", headers=alice_headers)).json()
    assert msgs[0]["content"] == "perfectly clean"


# ---- S10: replies are scoped to the channel --------------------------------

async def test_reply_to_message_in_other_channel_rejected(client: AsyncClient, alice_headers, bob_headers):
    # Alice's private server with a secret message Bob can't see
    secret_srv = await create_server(client, alice_headers, "Secret")
    secret_ch = await create_channel(client, alice_headers, secret_srv["id"])
    secret = await send_message(client, alice_headers, secret_ch["id"], "the launch codes")

    # Bob's own server
    bob_srv = await create_server(client, bob_headers, "Bob's")
    bob_ch = await create_channel(client, bob_headers, bob_srv["id"])
    r = await client.post(
        f"/channels/{bob_ch['id']}/messages",
        json={"content": "peek", "reply_to_id": secret["id"]},
        headers=bob_headers,
    )
    assert r.status_code == 400
    assert "the launch codes" not in r.text


async def test_reply_to_deleted_message_rejected(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    parent = await send_message(client, alice_headers, ch["id"], "gone soon")
    await client.delete(f"/channels/{ch['id']}/messages/{parent['id']}", headers=alice_headers)
    r = await client.post(
        f"/channels/{ch['id']}/messages",
        json={"content": "re", "reply_to_id": parent["id"]},
        headers=alice_headers,
    )
    assert r.status_code == 400


# ---- S14: usernames --------------------------------------------------------

async def test_username_unique_case_insensitively(client: AsyncClient):
    r = await client.post("/auth/register", json={"username": "Alice", "password": "secret123"})
    assert r.status_code == 201
    r = await client.post("/auth/register", json={"username": "alice", "password": "secret123"})
    assert r.status_code == 400


async def test_search_does_not_crash_on_case(client: AsyncClient):
    """Used to 500 (MultipleResultsFound) once case-variants existed."""
    headers = await register_and_login(client, "Carol", "secret123")
    r = await client.get("/users/search", params={"username": "CAROL"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["username"] == "Carol"  # display case preserved


async def test_login_is_case_insensitive(client: AsyncClient):
    await client.post("/auth/register", json={"username": "Dave", "password": "secret123"})
    r = await client.post("/auth/login", data={"username": "dave", "password": "secret123"})
    assert r.status_code == 200


@pytest.mark.parametrize(
    "name",
    [
        "a",                      # too short
        "x" * 33,                 # too long
        "has space",
        "dot.name",
        "аdmin",                  # Cyrillic 'а' homoglyph
        "zero​width",        # zero-width space
        "emoji😀",
    ],
)
async def test_username_charset_enforced(client: AsyncClient, name):
    r = await client.post("/auth/register", json={"username": name, "password": "secret123"})
    assert r.status_code == 422, (name, r.text)


async def test_fullwidth_username_normalised_and_deduplicated(client: AsyncClient):
    """NFKC folds full-width letters, so 'Ｅｖｅ' can't shadow 'Eve'."""
    assert (await client.post("/auth/register", json={"username": "Eve", "password": "secret123"})).status_code == 201
    r = await client.post("/auth/register", json={"username": "Ｅｖｅ", "password": "secret123"})
    assert r.status_code == 400


async def test_db_enforces_case_insensitive_uniqueness(db):
    from sqlalchemy.exc import IntegrityError
    from models.user import User
    db.add(User(username="Frank", password_hash="x"))
    await db.commit()
    db.add(User(username="FRANK", password_hash="x"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


# ---- S26: invite max_uses under concurrency ---------------------------------

async def test_concurrent_joins_respect_max_uses(client, db):
    """Five users race for a 2-use invite: exactly two get in."""
    import asyncio

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.database import get_db
    from main import app
    from models.invite import ServerInvite
    from tests.conftest import create_server, register_and_login

    owner = await register_and_login(client, "inv_owner")
    server = await create_server(client, owner)
    r = await client.post(f"/servers/{server['id']}/invites", json={"max_uses": 2}, headers=owner)
    code = r.json()["code"]
    joiners = [await register_and_login(client, f"joiner{i}") for i in range(5)]

    factory = async_sessionmaker(db.bind, expire_on_commit=False)

    async def per_request_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = per_request_db
    results = await asyncio.gather(*[client.post(f"/invites/{code}/join", headers=h) for h in joiners])
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 200, 410, 410, 410], codes

    async with factory() as s:
        uses = (await s.execute(select(ServerInvite.uses).where(ServerInvite.code == code))).scalar_one()
    assert uses == 2
    members = await client.get(f"/servers/{server['id']}/members", headers=owner)
    assert len(members.json()) == 3  # owner + 2


async def test_rejoin_does_not_use_up_invite(client):
    from tests.conftest import create_server, register_and_login

    owner = await register_and_login(client, "inv_owner2")
    bob = await register_and_login(client, "inv_bob")
    server = await create_server(client, owner)
    code = (await client.post(f"/servers/{server['id']}/invites", json={"max_uses": 1}, headers=owner)).json()["code"]
    assert (await client.post(f"/invites/{code}/join", headers=bob)).status_code == 200
    assert (await client.post(f"/invites/{code}/join", headers=bob)).status_code == 410  # used up, even for a member
