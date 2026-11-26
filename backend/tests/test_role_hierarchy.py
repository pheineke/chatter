"""Role hierarchy among admins (security_pass S28).

Admins may only act on members and roles ranked strictly below their own
highest role; the owner outranks everyone.
"""
import pytest
from httpx import AsyncClient

from tests.conftest import create_server, join_server, register_and_login


@pytest.fixture()
async def setup(client: AsyncClient):
    owner = await register_and_login(client, "owner", "ownerpass1")
    a = await register_and_login(client, "admina", "adminapass")
    b = await register_and_login(client, "adminb", "adminbpass")
    m = await register_and_login(client, "member", "memberpass")
    server = await create_server(client, owner)
    sid = server["id"]
    for h in (a, b, m):
        await join_server(client, sid, owner, h)

    roles = (await client.get(f"/servers/{sid}/roles", headers=owner)).json()
    admin_role = next(r for r in roles if r["is_admin"])
    everyone = next(r for r in roles if r["is_default"])
    r = await client.post(f"/servers/{sid}/roles", json={"name": "Mod"}, headers=owner)
    assert r.status_code == 201, r.text
    mod_role = r.json()

    members = (await client.get(f"/servers/{sid}/members", headers=owner)).json()
    ids = {mem["user"]["username"]: mem["user_id"] for mem in members}
    for name in ("admina", "adminb"):
        r = await client.post(
            f"/servers/{sid}/members/{ids[name]}/roles/{admin_role['id']}", headers=owner
        )
        assert r.status_code == 204, r.text

    return {
        "sid": sid, "owner": owner, "a": a, "b": b, "m": m, "ids": ids,
        "admin_role": admin_role, "mod_role": mod_role, "everyone": everyone,
    }


async def test_new_server_admin_role_sits_above_default_roles(setup):
    assert setup["admin_role"]["position"] == 1
    assert setup["mod_role"]["position"] == 0


async def test_admin_cannot_act_on_equal_admin(client: AsyncClient, setup):
    s = setup
    sid, a, b_id = s["sid"], s["a"], s["ids"]["adminb"]
    admin_id = s["admin_role"]["id"]

    attempts = [
        client.delete(f"/servers/{sid}/members/{b_id}", headers=a),
        client.post(f"/servers/{sid}/bans/{b_id}", headers=a),
        client.delete(f"/servers/{sid}/members/{b_id}/roles/{admin_id}", headers=a),
        client.patch(f"/servers/{sid}/members/{b_id}/nick", json={"nickname": "x"}, headers=a),
    ]
    for attempt in attempts:
        r = await attempt
        assert r.status_code == 403, r.text

    members = (await client.get(f"/servers/{sid}/members", headers=s["owner"])).json()
    b = next(mem for mem in members if mem["user_id"] == b_id)
    assert any(role["id"] == admin_id for role in b["roles"])


async def test_admin_cannot_edit_delete_or_hand_out_own_top_role(client: AsyncClient, setup):
    s = setup
    sid, a, admin_id = s["sid"], s["a"], s["admin_role"]["id"]

    r = await client.patch(f"/servers/{sid}/roles/{admin_id}", json={"is_admin": False}, headers=a)
    assert r.status_code == 403
    r = await client.patch(f"/servers/{sid}/roles/{admin_id}", json={"name": "Pwned"}, headers=a)
    assert r.status_code == 403
    r = await client.delete(f"/servers/{sid}/roles/{admin_id}", headers=a)
    assert r.status_code == 403
    r = await client.post(f"/servers/{sid}/members/{s['ids']['member']}/roles/{admin_id}", headers=a)
    assert r.status_code == 403


async def test_admin_cannot_place_roles_at_or_above_self(client: AsyncClient, setup):
    s = setup
    sid, a = s["sid"], s["a"]
    r = await client.post(f"/servers/{sid}/roles", json={"name": "Boss", "position": 1}, headers=a)
    assert r.status_code == 403
    r = await client.patch(f"/servers/{sid}/roles/{s['mod_role']['id']}", json={"position": 5}, headers=a)
    assert r.status_code == 403


async def test_admin_can_manage_lower_members_and_roles(client: AsyncClient, setup):
    s = setup
    sid, a, m_id, mod_id = s["sid"], s["a"], s["ids"]["member"], s["mod_role"]["id"]

    r = await client.post(f"/servers/{sid}/members/{m_id}/roles/{mod_id}", headers=a)
    assert r.status_code == 204, r.text
    r = await client.patch(f"/servers/{sid}/roles/{mod_id}", json={"color": "#112233"}, headers=a)
    assert r.status_code == 200, r.text
    r = await client.patch(
        f"/servers/{sid}/roles/{s['everyone']['id']}", json={"color": "#445566"}, headers=a
    )
    assert r.status_code == 200, r.text
    r = await client.patch(f"/servers/{sid}/members/{m_id}/nick", json={"nickname": "newbie"}, headers=a)
    assert r.status_code == 200, r.text
    r = await client.post(f"/servers/{sid}/roles", json={"name": "Helper"}, headers=a)
    assert r.status_code == 201, r.text
    r = await client.delete(f"/servers/{sid}/members/{m_id}/roles/{mod_id}", headers=a)
    assert r.status_code == 204, r.text
    r = await client.delete(f"/servers/{sid}/members/{m_id}", headers=a)
    assert r.status_code == 204, r.text


async def test_admin_cannot_manage_owner(client: AsyncClient, setup):
    s = setup
    members = (await client.get(f"/servers/{s['sid']}/members", headers=s["owner"])).json()
    owner_id = next(mem["user_id"] for mem in members if mem["user"]["username"] == "owner")
    r = await client.patch(
        f"/servers/{s['sid']}/members/{owner_id}/nick", json={"nickname": "x"}, headers=s["a"]
    )
    assert r.status_code == 403


async def test_owner_outranks_admins(client: AsyncClient, setup):
    s = setup
    sid, owner, b_id, admin_id = s["sid"], s["owner"], s["ids"]["adminb"], s["admin_role"]["id"]
    r = await client.patch(f"/servers/{sid}/roles/{admin_id}", json={"name": "Staff"}, headers=owner)
    assert r.status_code == 200
    r = await client.delete(f"/servers/{sid}/members/{b_id}/roles/{admin_id}", headers=owner)
    assert r.status_code == 204
    r = await client.post(f"/servers/{sid}/bans/{b_id}", headers=owner)
    assert r.status_code == 204


async def test_higher_admin_role_outranks_lower_admin(client: AsyncClient, setup):
    """The owner can build a ladder: a Senior admin role above Admin."""
    s = setup
    sid, owner = s["sid"], s["owner"]
    r = await client.post(
        f"/servers/{sid}/roles", json={"name": "Senior", "is_admin": True, "position": 2}, headers=owner
    )
    senior_id = r.json()["id"]
    r = await client.post(f"/servers/{sid}/members/{s['ids']['admina']}/roles/{senior_id}", headers=owner)
    assert r.status_code == 204

    # B (Admin) can no longer touch A (Senior + Admin)...
    r = await client.delete(f"/servers/{sid}/members/{s['ids']['admina']}", headers=s["b"])
    assert r.status_code == 403
    # ...while A can now demote B.
    r = await client.delete(
        f"/servers/{sid}/members/{s['ids']['adminb']}/roles/{s['admin_role']['id']}", headers=s["a"]
    )
    assert r.status_code == 204
