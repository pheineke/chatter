"""Regression tests for the four critical findings in docs/security_pass.md.

S1 — /meta link-preview proxy: auth required, no SSRF to non-public addresses
S2 — /interactions: no impersonation, no posting into inaccessible channels
S3 — channel permission overwrites are enforced
S4 — no invite-less server join (covered in test_servers.py)
"""
import uuid

import httpx
import pytest
from httpx import AsyncClient

from app.routers import meta as meta_router
from models.channel import ChannelPerm
from models.interaction import ApplicationCommand
from models.user import User
from tests.conftest import (
    create_channel,
    create_server,
    join_server,
    register_and_login,
    send_message,
)


async def _me(client: AsyncClient, headers: dict) -> dict:
    return (await client.get("/users/me", headers=headers)).json()


# ===========================================================================
# S1 — link-preview SSRF
# ===========================================================================

async def test_meta_requires_auth(client: AsyncClient):
    r = await client.get("/meta", params={"url": "https://example.com"})
    assert r.status_code == 401


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://localhost/",
        "http://10.0.0.1/",
        "http://192.168.1.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://0.0.0.0/",
        "http://100.64.0.1/",
    ],
)
async def test_meta_blocks_non_public_targets(client: AsyncClient, alice_headers, url):
    r = await client.get("/meta", params={"url": url}, headers=alice_headers)
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == "URL is not allowed"


@pytest.mark.parametrize(
    "url",
    ["http://example.com:8000/", "ftp://example.com/", "file:///etc/passwd", "http://user:pw@example.com/"],
)
async def test_meta_rejects_bad_scheme_port_credentials(client: AsyncClient, alice_headers, url):
    r = await client.get("/meta", params={"url": url}, headers=alice_headers)
    assert r.status_code == 400


@pytest.mark.parametrize(
    "ip,expected",
    [
        ("8.8.8.8", True),
        ("2606:4700:4700::1111", True),
        ("127.0.0.1", False),
        ("10.1.2.3", False),
        ("172.16.0.1", False),
        ("192.168.0.1", False),
        ("169.254.169.254", False),
        ("100.64.0.1", False),
        ("224.0.0.1", False),
        ("::1", False),
        ("fd00::1", False),
        ("fe80::1%eth0", False),
        ("::ffff:10.0.0.1", False),
        ("64:ff9b::a00:1", False),  # NAT64 of 10.0.0.1
        ("not-an-ip", False),
    ],
)
def test_is_public_ip(ip, expected):
    assert meta_router.is_public_ip(ip) is expected


async def test_guarded_transport_blocks_at_connect_time():
    """The guard lives in the network layer, so it also covers every redirect
    hop and DNS-rebinding (it checks the address actually connected to)."""
    async with httpx.AsyncClient(transport=meta_router._PublicOnlyTransport()) as c:
        with pytest.raises(meta_router.BlockedDestination):
            await c.get("http://127.0.0.1/")
        with pytest.raises(meta_router.BlockedDestination):
            await c.get("http://localhost:80/")


# ===========================================================================
# S2 — interactions impersonation
# ===========================================================================

async def _make_bot(db, name: str = "TestBot") -> User:
    bot = User(username=name, password_hash="x", is_bot=True)
    db.add(bot)
    await db.commit()
    await db.refresh(bot)
    return bot


async def _make_command(db, application_id, name: str = "echo") -> ApplicationCommand:
    cmd = ApplicationCommand(application_id=application_id, name=name, description="d")
    db.add(cmd)
    await db.commit()
    await db.refresh(cmd)
    return cmd


def _echo_payload(cmd: ApplicationCommand, channel_id: str, text: str = "hi") -> dict:
    return {
        "type": 2,
        "data": {
            "id": str(cmd.id),
            "name": cmd.name,
            "type": 1,
            "options": [{"name": "message", "value": text, "type": 3}],
        },
        "channel_id": channel_id,
    }


async def test_cannot_register_command_for_another_user(client: AsyncClient, alice_headers, bob_headers):
    bob = await _me(client, bob_headers)
    r = await client.post(
        f"/applications/{bob['id']}/commands",
        json={"name": "echo", "description": "x"},
        headers=alice_headers,
    )
    assert r.status_code == 403


async def test_human_cannot_register_commands_for_self(client: AsyncClient, alice_headers):
    alice = await _me(client, alice_headers)
    r = await client.post(
        f"/applications/{alice['id']}/commands",
        json={"name": "echo", "description": "x"},
        headers=alice_headers,
    )
    assert r.status_code == 403


async def test_interaction_cannot_post_as_human(client: AsyncClient, db, alice_headers, bob_headers):
    """A command attached to a human account must never produce a message authored by them."""
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    bob = await _me(client, bob_headers)
    cmd = await _make_command(db, uuid.UUID(bob["id"]))

    r = await client.post("/interactions", json=_echo_payload(cmd, ch["id"], "I am bob"), headers=alice_headers)
    assert r.status_code == 403

    msgs = (await client.get(f"/channels/{ch['id']}/messages", headers=alice_headers)).json()
    assert msgs == []


async def test_interaction_cannot_target_inaccessible_channel(client: AsyncClient, db, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    bot = await _make_bot(db)
    cmd = await _make_command(db, bot.id)

    # Bob is not a member of Alice's server.
    r = await client.post("/interactions", json=_echo_payload(cmd, ch["id"]), headers=bob_headers)
    assert r.status_code == 403
    msgs = (await client.get(f"/channels/{ch['id']}/messages", headers=alice_headers)).json()
    assert msgs == []


async def test_interaction_happy_path_posts_as_bot(client: AsyncClient, db, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    bot = await _make_bot(db)
    cmd = await _make_command(db, bot.id)

    r = await client.post("/interactions", json=_echo_payload(cmd, ch["id"], "hello"), headers=alice_headers)
    assert r.status_code == 200, r.text
    msgs = (await client.get(f"/channels/{ch['id']}/messages", headers=alice_headers)).json()
    assert len(msgs) == 1
    assert msgs[0]["content"] == "hello"
    assert msgs[0]["author"]["id"] == str(bot.id)


async def test_interaction_respects_word_filters(client: AsyncClient, db, alice_headers, bob_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    await join_server(client, s["id"], alice_headers, bob_headers)
    r = await client.post(
        f"/servers/{s['id']}/word-filters", json={"pattern": "badword", "action": "delete"}, headers=alice_headers
    )
    assert r.status_code == 201, r.text
    bot = await _make_bot(db)
    cmd = await _make_command(db, bot.id)

    r = await client.post("/interactions", json=_echo_payload(cmd, ch["id"], "badword"), headers=bob_headers)
    assert r.status_code == 400


async def test_command_listing_requires_auth(client: AsyncClient):
    assert (await client.get("/commands")).status_code == 401


# ===========================================================================
# S3 — channel permission overwrites
# ===========================================================================

async def _role(client, headers, server_id, name, is_admin=False) -> str:
    r = await client.post(
        f"/servers/{server_id}/roles", json={"name": name, "is_admin": is_admin}, headers=headers
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _assign(client, headers, server_id, user_id, role_id):
    r = await client.post(f"/servers/{server_id}/members/{user_id}/roles/{role_id}", headers=headers)
    assert r.status_code == 204, r.text


async def _overwrite(client, headers, server_id, channel_id, role_id, allow=0, deny=0):
    r = await client.put(
        f"/servers/{server_id}/channels/{channel_id}/permissions/{role_id}",
        json={"allow_bits": allow, "deny_bits": deny},
        headers=headers,
    )
    assert r.status_code == 200, r.text


@pytest.fixture()
async def perm_setup(client: AsyncClient, alice_headers, bob_headers):
    """Alice owns a server with #secret; Bob is a member holding role 'Member'."""
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"], title="secret")
    await join_server(client, s["id"], alice_headers, bob_headers)
    bob = await _me(client, bob_headers)
    role = await _role(client, alice_headers, s["id"], "Member")
    await _assign(client, alice_headers, s["id"], bob["id"], role)
    return {"server": s["id"], "channel": ch["id"], "bob_id": bob["id"], "role": role}


async def test_default_member_can_read_and_write(client: AsyncClient, alice_headers, bob_headers, perm_setup):
    p = perm_setup
    await send_message(client, bob_headers, p["channel"], "hi")
    r = await client.get(f"/channels/{p['channel']}/messages", headers=bob_headers)
    assert r.status_code == 200


async def test_deny_view_hides_channel(client: AsyncClient, alice_headers, bob_headers, perm_setup):
    p = perm_setup
    await send_message(client, alice_headers, p["channel"], "top secret")
    await _overwrite(client, alice_headers, p["server"], p["channel"], p["role"], deny=ChannelPerm.VIEW_CHANNEL)

    r = await client.get(f"/channels/{p['channel']}/messages", headers=bob_headers)
    assert r.status_code == 403
    r = await client.post(f"/channels/{p['channel']}/messages", json={"content": "x"}, headers=bob_headers)
    assert r.status_code == 403
    r = await client.get(f"/channels/{p['channel']}/pins", headers=bob_headers)
    assert r.status_code == 403

    listed = (await client.get(f"/servers/{p['server']}/channels", headers=bob_headers)).json()
    assert p["channel"] not in [c["id"] for c in listed]

    # Owner still sees everything
    listed = (await client.get(f"/servers/{p['server']}/channels", headers=alice_headers)).json()
    assert p["channel"] in [c["id"] for c in listed]
    r = await client.get(f"/channels/{p['channel']}/messages", headers=alice_headers)
    assert r.status_code == 200


async def test_deny_send_is_read_only(client: AsyncClient, alice_headers, bob_headers, perm_setup):
    p = perm_setup
    bob_msg = await send_message(client, bob_headers, p["channel"], "before")
    await _overwrite(client, alice_headers, p["server"], p["channel"], p["role"], deny=ChannelPerm.SEND_MESSAGES)

    assert (await client.get(f"/channels/{p['channel']}/messages", headers=bob_headers)).status_code == 200
    r = await client.post(f"/channels/{p['channel']}/messages", json={"content": "x"}, headers=bob_headers)
    assert r.status_code == 403
    r = await client.patch(
        f"/channels/{p['channel']}/messages/{bob_msg['id']}", json={"content": "edited"}, headers=bob_headers
    )
    assert r.status_code == 403


async def test_deny_reactions(client: AsyncClient, alice_headers, bob_headers, perm_setup):
    p = perm_setup
    msg = await send_message(client, alice_headers, p["channel"], "react")
    await _overwrite(client, alice_headers, p["server"], p["channel"], p["role"], deny=ChannelPerm.ADD_REACTIONS)
    r = await client.post(f"/channels/{p['channel']}/messages/{msg['id']}/reactions/👍", headers=bob_headers)
    assert r.status_code == 403


async def test_deny_attach_files(client: AsyncClient, alice_headers, bob_headers, perm_setup):
    p = perm_setup
    msg = await send_message(client, bob_headers, p["channel"], "file")
    await _overwrite(client, alice_headers, p["server"], p["channel"], p["role"], deny=ChannelPerm.ATTACH_FILES)
    r = await client.post(
        f"/channels/{p['channel']}/messages/{msg['id']}/attachments",
        files={"file": ("a.txt", b"hello", "text/plain")},
        headers=bob_headers,
    )
    assert r.status_code == 403


async def test_allow_on_one_role_beats_deny_on_another(client: AsyncClient, alice_headers, bob_headers, perm_setup):
    p = perm_setup
    await _overwrite(client, alice_headers, p["server"], p["channel"], p["role"], deny=ChannelPerm.VIEW_CHANNEL)
    vip = await _role(client, alice_headers, p["server"], "VIP")
    await _overwrite(client, alice_headers, p["server"], p["channel"], vip, allow=ChannelPerm.VIEW_CHANNEL)
    assert (await client.get(f"/channels/{p['channel']}/messages", headers=bob_headers)).status_code == 403

    await _assign(client, alice_headers, p["server"], p["bob_id"], vip)
    assert (await client.get(f"/channels/{p['channel']}/messages", headers=bob_headers)).status_code == 200


async def test_admin_role_ignores_overwrites(client: AsyncClient, alice_headers, bob_headers, perm_setup):
    p = perm_setup
    await _overwrite(client, alice_headers, p["server"], p["channel"], p["role"], deny=ChannelPerm.VIEW_CHANNEL)
    admin = await _role(client, alice_headers, p["server"], "Mods", is_admin=True)
    await _assign(client, alice_headers, p["server"], p["bob_id"], admin)
    assert (await client.get(f"/channels/{p['channel']}/messages", headers=bob_headers)).status_code == 200


async def test_manage_messages_needed_to_delete_others(client: AsyncClient, alice_headers, bob_headers, perm_setup):
    p = perm_setup
    m1 = await send_message(client, alice_headers, p["channel"], "one")
    m2 = await send_message(client, alice_headers, p["channel"], "two")

    # Plain member: cannot delete someone else's message (MANAGE_MESSAGES is never a base perm)
    r = await client.delete(f"/channels/{p['channel']}/messages/{m1['id']}", headers=bob_headers)
    assert r.status_code == 403

    await _overwrite(client, alice_headers, p["server"], p["channel"], p["role"], allow=ChannelPerm.MANAGE_MESSAGES)
    r = await client.delete(f"/channels/{p['channel']}/messages/{m2['id']}", headers=bob_headers)
    assert r.status_code == 204


async def test_dm_access_unchanged(client: AsyncClient, alice_headers, bob_headers):
    """DMs have no overwrites: participants keep full access, outsiders none."""
    from app.authz import DM_PERMS
    assert DM_PERMS & ChannelPerm.VIEW_CHANNEL and DM_PERMS & ChannelPerm.SEND_MESSAGES
    carol = await register_and_login(client, "carol", "secret123")
    bob = await _me(client, bob_headers)
    r = await client.get(f"/dms/{bob['id']}/channel", headers=alice_headers)
    assert r.status_code == 200, r.text
    channel_id = r.json()["channel_id"]
    assert (await client.get(f"/channels/{channel_id}/messages", headers=alice_headers)).status_code == 200
    assert (await client.get(f"/channels/{channel_id}/messages", headers=carol)).status_code == 403


# ===========================================================================
# @everyone role — private channels
# ===========================================================================

async def _everyone(client, headers, server_id) -> dict:
    roles = (await client.get(f"/servers/{server_id}/roles", headers=headers)).json()
    defaults = [r for r in roles if r["is_default"]]
    assert len(defaults) == 1
    return defaults[0]


async def test_new_server_has_everyone_role_listed_last(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    roles = (await client.get(f"/servers/{s['id']}/roles", headers=alice_headers)).json()
    assert roles[-1]["name"] == "@everyone" and roles[-1]["is_default"] is True
    assert roles[0]["name"] == "Admin"


async def test_private_channel_via_everyone(client: AsyncClient, alice_headers, bob_headers, perm_setup):
    """Deny VIEW for @everyone, allow it for one role → only that role (and admins) see it."""
    p = perm_setup
    carol = await register_and_login(client, "carol", "secret123")
    await join_server(client, p["server"], alice_headers, carol)
    everyone = await _everyone(client, alice_headers, p["server"])

    await _overwrite(client, alice_headers, p["server"], p["channel"], everyone["id"], deny=ChannelPerm.VIEW_CHANNEL)
    # Nobody but the owner can see it now — not even Bob, whose 'Member' role has no overwrite.
    for h in (bob_headers, carol):
        assert (await client.get(f"/channels/{p['channel']}/messages", headers=h)).status_code == 403
        listed = (await client.get(f"/servers/{p['server']}/channels", headers=h)).json()
        assert p["channel"] not in [c["id"] for c in listed]
    assert (await client.get(f"/channels/{p['channel']}/messages", headers=alice_headers)).status_code == 200

    # A role allow beats the @everyone deny.
    await _overwrite(client, alice_headers, p["server"], p["channel"], p["role"], allow=ChannelPerm.VIEW_CHANNEL)
    assert (await client.get(f"/channels/{p['channel']}/messages", headers=bob_headers)).status_code == 200
    assert (await client.get(f"/channels/{p['channel']}/messages", headers=carol)).status_code == 403


async def test_everyone_deny_send_makes_announcement_channel(client: AsyncClient, alice_headers, bob_headers, perm_setup):
    p = perm_setup
    everyone = await _everyone(client, alice_headers, p["server"])
    await _overwrite(client, alice_headers, p["server"], p["channel"], everyone["id"], deny=ChannelPerm.SEND_MESSAGES)
    assert (await client.get(f"/channels/{p['channel']}/messages", headers=bob_headers)).status_code == 200
    r = await client.post(f"/channels/{p['channel']}/messages", json={"content": "x"}, headers=bob_headers)
    assert r.status_code == 403
    await send_message(client, alice_headers, p["channel"], "announcement")


async def test_mls_fanout_respects_everyone(db, client: AsyncClient, alice_headers, bob_headers, perm_setup):
    from app.authz import channel_viewer_ids
    from models.channel import Channel

    p = perm_setup
    alice = await _me(client, alice_headers)
    everyone = await _everyone(client, alice_headers, p["server"])
    channel = await db.get(Channel, uuid.UUID(p["channel"]))

    viewers = {str(u) for u in await channel_viewer_ids(channel, db)}
    assert viewers == {alice["id"], p["bob_id"]}

    await _overwrite(client, alice_headers, p["server"], p["channel"], everyone["id"], deny=ChannelPerm.VIEW_CHANNEL)
    assert {str(u) for u in await channel_viewer_ids(channel, db)} == {alice["id"]}

    await _overwrite(client, alice_headers, p["server"], p["channel"], p["role"], allow=ChannelPerm.VIEW_CHANNEL)
    assert {str(u) for u in await channel_viewer_ids(channel, db)} == {alice["id"], p["bob_id"]}


async def test_everyone_role_is_protected(client: AsyncClient, alice_headers, bob_headers, perm_setup):
    p = perm_setup
    everyone = await _everyone(client, alice_headers, p["server"])
    base = f"/servers/{p['server']}/roles/{everyone['id']}"

    assert (await client.delete(base, headers=alice_headers)).status_code == 400
    for body in ({"name": "renamed"}, {"is_admin": True}, {"hoist": True}, {"mentionable": True}):
        assert (await client.patch(base, json=body, headers=alice_headers)).status_code == 400, body
    # Colour is harmless and allowed; re-sending the same name is a no-op.
    assert (await client.patch(base, json={"color": "#123456", "name": "@everyone"}, headers=alice_headers)).status_code == 200
    r = await client.post(
        f"/servers/{p['server']}/members/{p['bob_id']}/roles/{everyone['id']}", headers=alice_headers
    )
    assert r.status_code == 400


async def test_cannot_set_overwrite_on_another_servers_channel(client: AsyncClient, alice_headers, bob_headers):
    """Admin of server A must not be able to write overwrites onto server B's channel."""
    a = await create_server(client, alice_headers, "A")
    a_role = await _role(client, alice_headers, a["id"], "Spy")
    b = await create_server(client, bob_headers, "B")
    b_ch = await create_channel(client, bob_headers, b["id"], title="b-private")
    r = await client.put(
        f"/servers/{a['id']}/channels/{b_ch['id']}/permissions/{a_role}",
        json={"allow_bits": ChannelPerm.VIEW_CHANNEL, "deny_bits": 0},
        headers=alice_headers,
    )
    assert r.status_code == 404
    r = await client.get(f"/servers/{a['id']}/channels/{b_ch['id']}/permissions", headers=alice_headers)
    assert r.json() == []


async def test_cannot_remove_role_via_another_server(client: AsyncClient, alice_headers, bob_headers):
    """Admin of server A must not strip a role that belongs to server B."""
    b = await create_server(client, bob_headers, "B")
    b_role = await _role(client, bob_headers, b["id"], "Mods")
    bob = await _me(client, bob_headers)
    await _assign(client, bob_headers, b["id"], bob["id"], b_role)

    a = await create_server(client, alice_headers, "A")
    r = await client.delete(f"/servers/{a['id']}/members/{bob['id']}/roles/{b_role}", headers=alice_headers)
    assert r.status_code == 204  # idempotent no-op
    members = (await client.get(f"/servers/{b['id']}/members", headers=bob_headers)).json()
    me = next(m for m in members if m["user"]["id"] == bob["id"])
    assert b_role in [r["id"] for r in me["roles"]]
