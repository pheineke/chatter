"""QR login hardening (security_pass S18)."""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from models.e2ee import QRSession
from models.refresh_token import RefreshToken

APPROVE_BODY = {
    "encrypted_private_key": "Y2lwaGVydGV4dA==",
    "encryption_nonce": "bm9uY2U=",
    "approver_e2ee_public_key": "YXBwcm92ZXJwaw==",
}
NEW_DEVICE_UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) NewDevice/1.0"}


async def challenge(client):
    r = await client.post("/auth/qr/challenge", json={"device_ephemeral_pk": "ZXBo"}, headers=NEW_DEVICE_UA)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["poll_secret"]
    return body


def poll(client, ch, secret=None):
    return client.get(
        f"/auth/qr/{ch['session_id']}/status",
        headers={"X-QR-Poll-Secret": ch["poll_secret"] if secret is None else secret},
    )


async def test_full_flow_hands_tokens_out_once_and_wipes_them(client, alice_headers, db):
    ch = await challenge(client)
    assert (await poll(client, ch)).json()["status"] == "pending"

    info = await client.get(f"/auth/qr/{ch['session_id']}", headers=alice_headers)
    assert info.status_code == 200, info.text
    assert "NewDevice" in info.json()["requester_user_agent"]
    assert info.json()["same_network"] is True  # both from the test client
    assert (await poll(client, ch)).json()["status"] == "scanned"

    r = await client.post(f"/auth/qr/{ch['session_id']}/approve", json=APPROVE_BODY, headers=alice_headers)
    assert r.status_code == 200, r.text

    first = (await poll(client, ch)).json()
    assert first["status"] == "approved"
    assert first["access_token"] and first["refresh_token"]
    assert first["encrypted_private_key"] == APPROVE_BODY["encrypted_private_key"]

    second = (await poll(client, ch)).json()
    assert second["status"] == "used"
    assert second["access_token"] is None and second["refresh_token"] is None

    row = (await db.execute(select(QRSession).where(QRSession.id == uuid.UUID(ch["session_id"])))).scalar_one()
    await db.refresh(row)
    assert row.access_token is None and row.refresh_token is None
    assert row.encrypted_private_key is None and row.encryption_nonce is None

    # The new session works and is labelled with the new device's browser.
    me = await client.get("/users/me", headers={"Authorization": f"Bearer {first['access_token']}"})
    assert me.status_code == 200
    sessions = (await db.execute(select(RefreshToken).where(RefreshToken.user_agent.like("%NewDevice%")))).scalars().all()
    assert len(sessions) == 1


async def test_status_needs_the_poll_secret(client, alice_headers):
    ch = await challenge(client)
    await client.post(f"/auth/qr/{ch['session_id']}/approve", json=APPROVE_BODY, headers=alice_headers)
    # Someone who only saw the QR (session id) can't collect the tokens.
    r = await client.get(f"/auth/qr/{ch['session_id']}/status")
    assert r.status_code == 404
    assert (await poll(client, ch, secret="wrong")).status_code == 404
    # The real device still can.
    assert (await poll(client, ch)).json()["access_token"]


async def test_cannot_approve_twice(client, alice_headers, bob_headers):
    ch = await challenge(client)
    r = await client.post(f"/auth/qr/{ch['session_id']}/approve", json=APPROVE_BODY, headers=alice_headers)
    assert r.status_code == 200
    r = await client.post(f"/auth/qr/{ch['session_id']}/approve", json=APPROVE_BODY, headers=bob_headers)
    assert r.status_code == 409


async def test_expired_session_cannot_be_approved_or_inspected(client, alice_headers, db):
    ch = await challenge(client)
    await db.execute(
        update(QRSession)
        .where(QRSession.id == uuid.UUID(ch["session_id"]))
        .values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
    )
    await db.commit()
    assert (await client.get(f"/auth/qr/{ch['session_id']}", headers=alice_headers)).status_code == 404
    r = await client.post(f"/auth/qr/{ch['session_id']}/approve", json=APPROVE_BODY, headers=alice_headers)
    assert r.status_code == 410
    assert (await poll(client, ch)).json()["status"] == "expired"


async def test_old_sessions_are_purged(client, db):
    old = await challenge(client)
    await db.execute(
        update(QRSession)
        .where(QRSession.id == uuid.UUID(old["session_id"]))
        .values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=10))
    )
    await db.commit()
    await challenge(client)  # creating a challenge purges stale rows
    db.expire_all()
    rows = (await db.execute(select(QRSession.id))).scalars().all()
    assert len(rows) == 1 and str(rows[0]) != old["session_id"]


async def test_info_requires_login(client):
    ch = await challenge(client)
    assert (await client.get(f"/auth/qr/{ch['session_id']}")).status_code == 401


async def test_challenges_are_rate_limited(client):
    for _ in range(10):
        await challenge(client)
    r = await client.post("/auth/qr/challenge", json={"device_ephemeral_pk": "ZXBo"})
    assert r.status_code == 429
