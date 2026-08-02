"""
Tests for the MLS (RFC 9420) delivery-service endpoints (app/routers/mls.py).

These exercise the server's role as a pure, untrusted relay: it never sees
plaintext or private key material, only opaque bytes we hand it directly (no
real ts-mls objects needed here — the actual cryptographic round-trip is
validated separately, client-side, against the real ts-mls library). What
matters for these tests is the delivery-service *protocol*: epoch bookkeeping,
optimistic-concurrency conflict handling, single-use KeyPackages, and that
welcomes/events are only visible to their intended recipients.

Uses the shared `client`/`db` fixtures from conftest.py (Depends(get_db)
throughout app/routers/mls.py, no AsyncSessionLocal bypass), so — unlike some
of the older WS/message tests — these don't hit the pre-existing
fixture/AsyncSessionLocal DB-mismatch issue described in the repo's test
notes.
"""
import base64

import pytest
from httpx import AsyncClient

from tests.conftest import register_and_login, create_server, create_channel

pytestmark = pytest.mark.asyncio


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


async def _channel_for(client: AsyncClient, headers: dict) -> str:
    server = await create_server(client, headers, "MLS Test Server")
    channel = await create_channel(client, headers, server["id"], "general")
    return channel["id"]


async def test_key_package_publish_and_single_use(client: AsyncClient):
    alice = await register_and_login(client, "mls_alice", "pass1234")
    bob = await register_and_login(client, "mls_bob", "pass1234")
    bob_me = (await client.get("/users/me", headers=bob)).json()

    r = await client.post(
        "/mls/key-packages",
        json={"key_package": _b64(b"bob-kp-bytes"), "device_id": "bob-laptop"},
        headers=bob,
    )
    assert r.status_code == 201, r.text

    r = await client.get(f"/mls/key-packages/{bob_me['id']}", headers=alice)
    assert r.status_code == 200, r.text
    claimed = r.json()
    assert len(claimed) == 1
    assert base64.b64decode(claimed[0]["key_package"]) == b"bob-kp-bytes"
    assert claimed[0]["device_id"] == "bob-laptop"

    # Single-use: a second claim finds nothing left.
    r = await client.get(f"/mls/key-packages/{bob_me['id']}", headers=alice)
    assert r.status_code == 200, r.text
    assert r.json() == []


async def test_key_package_claim_returns_one_per_device(client: AsyncClient):
    """A user with several devices must yield one package per device, so a
    single Add commit can bring every device of theirs into the group."""
    alice = await register_and_login(client, "mls_alice_md", "pass1234")
    bob = await register_and_login(client, "mls_bob_md", "pass1234")
    bob_id = (await client.get("/users/me", headers=bob)).json()["id"]

    for device, blob in (("phone", b"kp-phone-1"), ("phone", b"kp-phone-2"), ("laptop", b"kp-laptop-1")):
        r = await client.post(
            "/mls/key-packages",
            json={"key_package": _b64(blob), "device_id": device},
            headers=bob,
        )
        assert r.status_code == 201, r.text

    r = await client.get(f"/mls/key-packages/{bob_id}", headers=alice)
    assert r.status_code == 200, r.text
    claimed = r.json()
    assert {kp["device_id"] for kp in claimed} == {"phone", "laptop"}
    # Oldest-first within a device, and exactly one taken per device.
    by_device = {kp["device_id"]: base64.b64decode(kp["key_package"]) for kp in claimed}
    assert by_device["phone"] == b"kp-phone-1"
    assert by_device["laptop"] == b"kp-laptop-1"

    # The phone's second package survives for the next Add; the laptop is dry.
    r = await client.get(f"/mls/key-packages/{bob_id}", headers=alice)
    claimed = r.json()
    assert [kp["device_id"] for kp in claimed] == ["phone"]
    assert base64.b64decode(claimed[0]["key_package"]) == b"kp-phone-2"


async def test_purge_is_scoped_to_one_device(client: AsyncClient):
    """Wiping a dead device's packages must leave a sibling device's alone —
    otherwise linking a new device would strip the old one's ability to be
    Added to any new group."""
    bob = await register_and_login(client, "mls_bob_purge", "pass1234")
    bob_id = (await client.get("/users/me", headers=bob)).json()["id"]
    alice = await register_and_login(client, "mls_alice_purge", "pass1234")

    for device, blob in (("old", b"kp-old"), ("new", b"kp-new")):
        await client.post(
            "/mls/key-packages",
            json={"key_package": _b64(blob), "device_id": device},
            headers=bob,
        )

    r = await client.delete("/mls/key-packages", params={"device_id": "old"}, headers=bob)
    assert r.status_code == 204, r.text

    claimed = (await client.get(f"/mls/key-packages/{bob_id}", headers=alice)).json()
    assert [kp["device_id"] for kp in claimed] == ["new"]


async def test_key_package_missing_returns_empty_list(client: AsyncClient):
    alice = await register_and_login(client, "mls_alice2", "pass1234")
    bob = await register_and_login(client, "mls_bob2", "pass1234")
    bob_id = (await client.get("/users/me", headers=bob)).json()["id"]

    r = await client.get(f"/mls/key-packages/{bob_id}", headers=alice)
    assert r.status_code == 200
    assert r.json() == []


async def test_group_init_is_idempotent(client: AsyncClient):
    alice = await register_and_login(client, "mls_alice3", "pass1234")
    channel_id = await _channel_for(client, alice)

    r1 = await client.post(f"/mls/groups/{channel_id}", json={"ciphersuite": "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"}, headers=alice)
    assert r1.status_code == 200
    assert r1.json()["current_epoch"] == 0  # matches ts-mls createGroup()'s initial epoch

    r2 = await client.post(f"/mls/groups/{channel_id}", json={"ciphersuite": "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"}, headers=alice)
    assert r2.status_code == 200
    assert r2.json() == r1.json()  # second call returns the same row, doesn't create a new one


async def test_get_group_404_before_init(client: AsyncClient):
    alice = await register_and_login(client, "mls_alice4", "pass1234")
    channel_id = await _channel_for(client, alice)
    r = await client.get(f"/mls/groups/{channel_id}", headers=alice)
    assert r.status_code == 404


async def test_commit_advances_epoch_and_delivers_scoped_welcome(client: AsyncClient):
    alice = await register_and_login(client, "mls_alice5", "pass1234")
    server = await create_server(client, alice, "MLS Test Server")
    channel = await create_channel(client, alice, server["id"], "general")
    channel_id = channel["id"]

    bob = await register_and_login(client, "mls_bob5", "pass1234")
    bob_id = (await client.get("/users/me", headers=bob)).json()["id"]
    # Bob has to actually be in the server: he's both the Welcome recipient
    # (commit_group only accepts welcomes addressed to channel members) and
    # expected below to read the channel's event feed, which
    # _require_channel_access gates on membership. This mirrors the real
    # flow, where a user joins the server and is then Added to each text
    # channel's MLS group.
    await client.post(f"/servers/{server['id']}/join", headers=bob)

    # Carol never joins — she's the negative case for event visibility.
    carol = await register_and_login(client, "mls_carol5", "pass1234")

    await client.post(f"/mls/groups/{channel_id}", json={"ciphersuite": "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"}, headers=alice)

    r = await client.post(
        f"/mls/groups/{channel_id}/commit",
        json={
            "parent_epoch": 0,
            "commit": _b64(b"commit-bytes"),
            "welcomes": [{"recipient_user_id": bob_id, "welcome": _b64(b"welcome-for-bob")}],
        },
        headers=alice,
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"epoch": 1, "seq": 1}

    group = (await client.get(f"/mls/groups/{channel_id}", headers=alice)).json()
    assert group["current_epoch"] == 1

    # Bob (the Welcome recipient) sees both the commit and his welcome.
    events = (await client.get(f"/mls/groups/{channel_id}/events?since_seq=0", headers=bob)).json()
    assert [e["event_type"] for e in events] == ["commit", "welcome"]
    assert events[1]["recipient_user_id"] == bob_id
    assert base64.b64decode(events[1]["payload"]) == b"welcome-for-bob"

    # Carol has no server/channel access at all -> 403, not just an empty/filtered list.
    r = await client.get(f"/mls/groups/{channel_id}/events?since_seq=0", headers=carol)
    assert r.status_code == 403


async def test_welcome_to_non_member_rejected(client: AsyncClient):
    """A commit may not carry a Welcome addressed to someone outside the
    channel. Otherwise any member could use the commit endpoint to push
    arbitrary bytes at any user on the instance via the mls.welcome
    WebSocket fan-out, and leave a row addressed to them in this channel's
    event log."""
    alice = await register_and_login(client, "mls_alice_nm", "pass1234")
    channel_id = await _channel_for(client, alice)
    outsider = await register_and_login(client, "mls_outsider_nm", "pass1234")
    outsider_id = (await client.get("/users/me", headers=outsider)).json()["id"]

    await client.post(
        f"/mls/groups/{channel_id}",
        json={"ciphersuite": "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"},
        headers=alice,
    )

    r = await client.post(
        f"/mls/groups/{channel_id}/commit",
        json={
            "parent_epoch": 0,
            "commit": _b64(b"commit-bytes"),
            "welcomes": [{"recipient_user_id": outsider_id, "welcome": _b64(b"not-for-you")}],
        },
        headers=alice,
    )
    assert r.status_code == 403, r.text

    # And the rejected commit must not have advanced the epoch.
    group = (await client.get(f"/mls/groups/{channel_id}", headers=alice)).json()
    assert group["current_epoch"] == 0


async def test_oversized_payloads_rejected(client: AsyncClient):
    """Opaque blobs are length-capped: the server can't parse them, so size
    is the only abuse vector it can police (see app/schemas/mls.py)."""
    alice = await register_and_login(client, "mls_alice_big", "pass1234")

    r = await client.post(
        "/mls/key-packages",
        json={"key_package": _b64(b"x" * 32_768), "device_id": "dev"},
        headers=alice,
    )
    assert r.status_code == 422, r.text


async def test_stale_commit_rejected_with_current_epoch(client: AsyncClient):
    alice = await register_and_login(client, "mls_alice6", "pass1234")
    channel_id = await _channel_for(client, alice)
    await client.post(f"/mls/groups/{channel_id}", json={"ciphersuite": "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"}, headers=alice)

    ok = await client.post(
        f"/mls/groups/{channel_id}/commit",
        json={"parent_epoch": 0, "commit": _b64(b"first"), "welcomes": []},
        headers=alice,
    )
    assert ok.status_code == 200
    assert ok.json()["epoch"] == 1

    # Retrying against the now-stale epoch 0 must fail with the CURRENT epoch
    # reported back, not the stale one the client sent.
    stale = await client.post(
        f"/mls/groups/{channel_id}/commit",
        json={"parent_epoch": 0, "commit": _b64(b"second"), "welcomes": []},
        headers=alice,
    )
    assert stale.status_code == 409
    assert "epoch is 1" in stale.json()["detail"]


async def test_commit_requires_existing_group(client: AsyncClient):
    alice = await register_and_login(client, "mls_alice7", "pass1234")
    channel_id = await _channel_for(client, alice)
    r = await client.post(
        f"/mls/groups/{channel_id}/commit",
        json={"parent_epoch": 0, "commit": _b64(b"x"), "welcomes": []},
        headers=alice,
    )
    assert r.status_code == 404


async def test_application_message_carries_mls_epoch(client: AsyncClient):
    alice = await register_and_login(client, "mls_alice8", "pass1234")
    channel_id = await _channel_for(client, alice)
    r = await client.post(
        f"/channels/{channel_id}/messages",
        json={"content": _b64(b"ciphertext"), "is_encrypted": True, "mls_epoch": 3},
        headers=alice,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["is_encrypted"] is True
    assert body["mls_epoch"] == 3
