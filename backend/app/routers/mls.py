"""MLS (RFC 9420) delivery-service endpoints.

The server here is a pure, untrusted Delivery Service (DS) in MLS terms: it
stores and relays opaque, already-encrypted/authenticated protocol bytes and
never sees plaintext or private key material. All cryptography happens
client-side (frontend/src/mls/).

One MLS group maps 1:1 to a `channels.id` — this covers both server text
channels (N-person groups) and DM channels (2-person groups, via DMChannel),
so the same endpoints serve both.

Concurrency: commits are accepted with an optimistic-lock check against
`MLSGroup.current_epoch` (a conditional UPDATE — see `commit_group`). Two
clients racing to commit against the same epoch will have exactly one
succeed; the loser gets a 409 with the current epoch so it can fetch the
winning commit, reprocess, and retry against the new epoch. This mirrors the
non-normative DS guidance in RFC 9420 §16.1.
"""
import base64
import binascii
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update, func, or_
from sqlalchemy.exc import IntegrityError

from app.dependencies import CurrentUser, DB
from app.rate_limiter import (
    rate_limit_mls_key_package_publish,
    rate_limit_mls_key_package_claim,
    rate_limit_mls_key_package_purge,
    rate_limit_mls_history_transfer,
    rate_limit_mls_commit,
)
from app.routers.messages import _get_channel_or_404, _require_channel_access
from app.routers.servers import _require_member
from app.schemas.mls import (
    KeyPackagePublish, KeyPackageRead, GroupInit, GroupRead,
    CommitSubmit, GroupEventRead, CommitResult,
    HistoryRequestCreate, HistoryRequestRead,
    HistoryBundleCreate, HistoryBundleRead,
)
from app.ws_manager import manager
from models.channel import ChannelType
from models.dm_channel import DMChannel
from models.mls import (
    MLSKeyPackage, MLSGroup, MLSGroupEvent, MLSEventType,
    MLSHistoryRequest, MLSHistoryBundle,
)
from models.server import ServerMember

router = APIRouter(prefix="/mls", tags=["mls"])

_MAX_EVENTS_PAGE = 500


def _b64_to_bytes(s: str, field: str) -> bytes:
    try:
        return base64.b64decode(s, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=422, detail=f"Invalid base64 in '{field}'")


def _bytes_to_b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


async def _channel_member_ids(channel, db) -> list[uuid.UUID]:
    """All users who should receive real-time MLS group events for this
    channel — server members (matches the fan-out already used for
    message.created/channel.message notifications) or the two DM participants.
    """
    if channel.type == ChannelType.dm:
        result = await db.execute(select(DMChannel).where(DMChannel.channel_id == channel.id))
        dmc = result.scalar_one_or_none()
        return [dmc.user_a_id, dmc.user_b_id] if dmc else []
    if channel.server_id:
        result = await db.execute(
            select(ServerMember.user_id).where(ServerMember.server_id == channel.server_id)
        )
        return list(result.scalars().all())
    return []


# ─── KeyPackages ────────────────────────────────────────────────────────────

@router.post("/key-packages", response_model=KeyPackageRead, status_code=status.HTTP_201_CREATED)
async def publish_key_package(
    body: KeyPackagePublish,
    current_user: CurrentUser,
    db: DB,
    _rl: None = Depends(rate_limit_mls_key_package_publish),
):
    kp = MLSKeyPackage(
        user_id=current_user.id,
        device_id=body.device_id,
        key_package=_b64_to_bytes(body.key_package, "key_package"),
    )
    db.add(kp)
    await db.commit()
    await db.refresh(kp)
    return KeyPackageRead(
        id=kp.id, user_id=kp.user_id, device_id=kp.device_id,
        key_package=_bytes_to_b64(kp.key_package),
        created_at=kp.created_at,
    )


@router.delete("/key-packages", status_code=status.HTTP_204_NO_CONTENT)
async def purge_my_key_packages(
    current_user: CurrentUser,
    db: DB,
    device_id: str = Query(min_length=1, max_length=64),
    _rl: None = Depends(rate_limit_mls_key_package_purge),
):
    """Drop unclaimed KeyPackages belonging to one of the caller's devices.

    A KeyPackage can only ever be redeemed by the exact device that generated
    it (the private half never leaves that browser's IndexedDB), so packages
    from a device that no longer exists are dead weight: claiming one yields
    a Welcome nobody can decrypt, silently locking its recipient out of that
    group.

    Scoped to a single device deliberately. An earlier version deleted every
    unclaimed package the user had, which was fine while everyone had one
    device and actively harmful once they didn't — linking a phone would
    strip the laptop's ability to be Added to any new group. Callers pass
    their own device id (see ensureIdentity in frontend/src/mls/session.ts).

    Already-consumed rows are left alone: they're an audit trail of Adds that
    really happened, and are never handed out again anyway.
    """
    await db.execute(
        MLSKeyPackage.__table__.delete().where(
            MLSKeyPackage.user_id == current_user.id,
            MLSKeyPackage.device_id == device_id,
            MLSKeyPackage.consumed_at.is_(None),
        )
    )
    await db.commit()


@router.get("/key-packages/{user_id}", response_model=list[KeyPackageRead])
async def fetch_key_packages(
    user_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    _rl: None = Depends(rate_limit_mls_key_package_claim),
):
    """Claim one unused KeyPackage for **each** of `user_id`'s devices, so the
    caller can Add every device to a group in a single commit.

    A user is not one MLS member but one per device: each holds its own
    private keys and its own leaf in the ratchet tree. Adding only one device
    would leave their other devices unable to decrypt anything in the
    channel. Each returned package is marked consumed — KeyPackages are
    single-use in MLS (reusing one would let two different Adds derive the
    same init secret).

    Returns an empty list rather than 404 when the user has no usable key
    material: with several devices in play "none available" is a normal
    transient state (every pool drained, or a device that has never been
    online), and the caller is better placed to decide whether that's fatal.

    Deliberately not gated on a relationship between caller and target: the
    caller may be Adding them to a channel they aren't in yet, so there's no
    shared context to check against. The rate limit above is what keeps the
    consume-on-read behaviour from being a pool-draining DoS.
    """
    device_rows = await db.execute(
        select(MLSKeyPackage.device_id)
        .where(MLSKeyPackage.user_id == user_id, MLSKeyPackage.consumed_at.is_(None))
        .distinct()
    )
    device_ids = list(device_rows.scalars().all())

    claimed: list[MLSKeyPackage] = []
    for device_id in device_ids:
        # Oldest-first per device, locked individually so two concurrent
        # claimers take different rows instead of colliding on one.
        result = await db.execute(
            select(MLSKeyPackage)
            .where(
                MLSKeyPackage.user_id == user_id,
                MLSKeyPackage.device_id == device_id,
                MLSKeyPackage.consumed_at.is_(None),
            )
            .order_by(MLSKeyPackage.created_at.asc())
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        kp = result.scalar_one_or_none()
        if kp is None:
            # Raced with another claimer for this device's last package.
            # Skipping is right: the group just won't include that device
            # until it publishes more and someone re-Adds it.
            continue
        kp.consumed_at = datetime.now(timezone.utc)
        claimed.append(kp)

    await db.commit()
    return [
        KeyPackageRead(
            id=kp.id, user_id=kp.user_id, device_id=kp.device_id,
            key_package=_bytes_to_b64(kp.key_package),
            created_at=kp.created_at,
        )
        for kp in claimed
    ]


# ─── Link-time history transfer ─────────────────────────────────────────────
#
# MLS is forward-secret: a device Added at epoch N cannot derive keys for
# anything sent before it joined, so history can't come from the protocol. It
# has to be handed over by a device that already holds the plaintext,
# encrypted to the new one. Same shape as linking a WhatsApp companion device.
#
# Every endpoint here is scoped to the caller's own user id — this is one of
# your devices talking to another of your devices, and the server only ever
# sees ciphertext it has no key for. Bundles are deleted on collection, so
# what accumulates server-side is nothing: this is a relay, not an archive,
# which is what keeps forward secrecy intact for everything except the one
# transfer the user explicitly asked for.


@router.post("/history-requests", response_model=HistoryRequestRead, status_code=status.HTTP_201_CREATED)
async def create_history_request(
    body: HistoryRequestCreate,
    current_user: CurrentUser,
    db: DB,
    _rl: None = Depends(rate_limit_mls_history_transfer),
):
    """Announce that one of my devices is new and wants history.

    Upserts: re-requesting from the same device replaces the previous key
    rather than accumulating rows, so a device that gives up waiting and
    retries doesn't leave stale public keys other devices might encrypt to.
    """
    existing = await db.execute(
        select(MLSHistoryRequest).where(
            MLSHistoryRequest.user_id == current_user.id,
            MLSHistoryRequest.device_id == body.device_id,
        )
    )
    req = existing.scalar_one_or_none()
    if req is None:
        req = MLSHistoryRequest(
            user_id=current_user.id,
            device_id=body.device_id,
            public_key=body.public_key,
        )
        db.add(req)
    else:
        req.public_key = body.public_key
        req.created_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(req)
    return HistoryRequestRead(
        id=req.id, device_id=req.device_id,
        public_key=req.public_key, created_at=req.created_at,
    )


@router.get("/history-requests", response_model=list[HistoryRequestRead])
async def list_history_requests(current_user: CurrentUser, db: DB):
    """My own devices that are waiting for history.

    Polled by a device that already holds plaintext so it can serve them. Only
    ever returns the caller's own devices — one user's device list is not
    another's business.
    """
    result = await db.execute(
        select(MLSHistoryRequest)
        .where(MLSHistoryRequest.user_id == current_user.id)
        .order_by(MLSHistoryRequest.created_at.asc())
    )
    return [
        HistoryRequestRead(
            id=r.id, device_id=r.device_id,
            public_key=r.public_key, created_at=r.created_at,
        )
        for r in result.scalars().all()
    ]


@router.post("/history-bundles", status_code=status.HTTP_204_NO_CONTENT)
async def upload_history_bundle(
    body: HistoryBundleCreate,
    current_user: CurrentUser,
    db: DB,
    _rl: None = Depends(rate_limit_mls_history_transfer),
):
    """Hand encrypted history to another of my devices.

    Requires a matching outstanding request, which pins the recipient to a
    device that actually asked and whose ephemeral public key the sender
    encrypted to. Without that check this would be an open "store arbitrary
    bytes under any device id" endpoint.
    """
    req = await db.execute(
        select(MLSHistoryRequest).where(
            MLSHistoryRequest.user_id == current_user.id,
            MLSHistoryRequest.device_id == body.target_device_id,
        )
    )
    if req.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=404,
            detail="No outstanding history request for that device.",
        )

    db.add(MLSHistoryBundle(
        user_id=current_user.id,
        target_device_id=body.target_device_id,
        sender_device_id=body.sender_device_id,
        ciphertext=_b64_to_bytes(body.ciphertext, "ciphertext"),
        nonce=_b64_to_bytes(body.nonce, "nonce"),
    ))
    await db.commit()


@router.get("/history-bundles", response_model=list[HistoryBundleRead])
async def list_history_bundles(
    current_user: CurrentUser,
    db: DB,
    device_id: str = Query(min_length=1, max_length=64),
):
    """Bundles waiting for one of my devices."""
    result = await db.execute(
        select(MLSHistoryBundle)
        .where(
            MLSHistoryBundle.user_id == current_user.id,
            MLSHistoryBundle.target_device_id == device_id,
        )
        .order_by(MLSHistoryBundle.created_at.asc())
    )
    return [
        HistoryBundleRead(
            id=b.id, sender_device_id=b.sender_device_id,
            ciphertext=_bytes_to_b64(b.ciphertext),
            nonce=_bytes_to_b64(b.nonce),
            created_at=b.created_at,
        )
        for b in result.scalars().all()
    ]


@router.delete("/history-bundles/{bundle_id}", status_code=status.HTTP_204_NO_CONTENT)
async def consume_history_bundle(
    bundle_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    """Delete a bundle once it's been decrypted and imported.

    Called by the recipient after a successful import. Deleting on collection
    is what makes this a relay rather than an archive — the window in which
    the server holds any of the user's history at all is the seconds between
    upload and import. Also clears that device's request, since it's served.
    """
    result = await db.execute(
        select(MLSHistoryBundle).where(
            MLSHistoryBundle.id == bundle_id,
            MLSHistoryBundle.user_id == current_user.id,
        )
    )
    bundle = result.scalar_one_or_none()
    if bundle is None:
        # Already consumed, or never the caller's — same response either way,
        # so this doesn't confirm whether some other user's bundle id exists.
        raise HTTPException(status_code=404, detail="Bundle not found")

    target_device_id = bundle.target_device_id
    await db.delete(bundle)
    await db.execute(
        MLSHistoryRequest.__table__.delete().where(
            MLSHistoryRequest.user_id == current_user.id,
            MLSHistoryRequest.device_id == target_device_id,
        )
    )
    await db.commit()


# ─── Groups ─────────────────────────────────────────────────────────────────

@router.post("/groups/{channel_id}", response_model=GroupRead, status_code=status.HTTP_200_OK)
async def init_group(channel_id: uuid.UUID, body: GroupInit, current_user: CurrentUser, db: DB):
    """Bootstrap the MLS group for a channel. Idempotent: if another client
    already initialized it (e.g. both DM participants race to be first),
    the existing record is returned rather than erroring."""
    channel = await _get_channel_or_404(channel_id, db)
    await _require_channel_access(channel, current_user.id, db)

    existing = await db.execute(select(MLSGroup).where(MLSGroup.channel_id == channel_id))
    group = existing.scalar_one_or_none()
    if group is not None:
        return GroupRead(
            channel_id=group.channel_id, ciphersuite=group.ciphersuite,
            current_epoch=group.current_epoch,
            group_info=_bytes_to_b64(group.group_info) if group.group_info else None,
            created_at=group.created_at, updated_at=group.updated_at,
        )

    group = MLSGroup(
        channel_id=channel_id,
        ciphersuite=body.ciphersuite,
        # ts-mls createGroup() starts at epoch 0; the first real Commit (e.g.
        # founder Adding the second member) advances it to 1.
        current_epoch=0,
        group_info=_b64_to_bytes(body.group_info, "group_info") if body.group_info else None,
    )
    db.add(group)
    try:
        await db.commit()
    except IntegrityError:
        # Lost the founder race between the SELECT above and this INSERT
        # (channel_id is MLSGroup's primary key) — the other DM participant's
        # concurrent init_group call won. Roll back our failed insert and
        # return the row that actually landed, keeping this endpoint
        # genuinely idempotent under a race rather than just in the
        # read-then-write happy path (this used to surface as an unhandled
        # 500, which left the loser's frontend with no group to sync against
        # until an unrelated later retry).
        await db.rollback()
        existing = await db.execute(select(MLSGroup).where(MLSGroup.channel_id == channel_id))
        group = existing.scalar_one()
        return GroupRead(
            channel_id=group.channel_id, ciphersuite=group.ciphersuite,
            current_epoch=group.current_epoch,
            group_info=_bytes_to_b64(group.group_info) if group.group_info else None,
            created_at=group.created_at, updated_at=group.updated_at,
        )
    await db.refresh(group)
    return GroupRead(
        channel_id=group.channel_id, ciphersuite=group.ciphersuite,
        current_epoch=group.current_epoch,
        group_info=_bytes_to_b64(group.group_info) if group.group_info else None,
        created_at=group.created_at, updated_at=group.updated_at,
    )


@router.get("/groups/{channel_id}", response_model=GroupRead)
async def get_group(channel_id: uuid.UUID, current_user: CurrentUser, db: DB):
    channel = await _get_channel_or_404(channel_id, db)
    await _require_channel_access(channel, current_user.id, db)

    result = await db.execute(select(MLSGroup).where(MLSGroup.channel_id == channel_id))
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="No MLS group provisioned for this channel yet")
    return GroupRead(
        channel_id=group.channel_id, ciphersuite=group.ciphersuite,
        current_epoch=group.current_epoch,
        group_info=_bytes_to_b64(group.group_info) if group.group_info else None,
        created_at=group.created_at, updated_at=group.updated_at,
    )


@router.post("/groups/{channel_id}/commit", response_model=CommitResult)
async def commit_group(
    channel_id: uuid.UUID,
    body: CommitSubmit,
    current_user: CurrentUser,
    db: DB,
    _rl: None = Depends(rate_limit_mls_commit),
):
    channel = await _get_channel_or_404(channel_id, db)
    await _require_channel_access(channel, current_user.id, db)

    group_result = await db.execute(select(MLSGroup).where(MLSGroup.channel_id == channel_id))
    group = group_result.scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="No MLS group provisioned for this channel yet")

    new_epoch = body.parent_epoch + 1
    new_group_info = (
        _b64_to_bytes(body.group_info, "group_info") if body.group_info is not None else None
    )

    # Welcomes may only be addressed to people who belong in this channel.
    # The payload itself is opaque and individually encrypted, so a Welcome
    # aimed elsewhere is useless to its recipient — but without this check,
    # `POST /commit` would let any channel member push arbitrary bytes to any
    # user on the instance via the mls.welcome WebSocket fan-out below, and
    # park a row addressed to them in this channel's event log. Neither is
    # something a well-behaved client ever needs.
    if body.welcomes:
        allowed_recipients = set(await _channel_member_ids(channel, db))
        invalid = [
            str(w.recipient_user_id)
            for w in body.welcomes
            if w.recipient_user_id not in allowed_recipients
        ]
        if invalid:
            raise HTTPException(
                status_code=403,
                detail=f"Welcome recipients are not members of this channel: {', '.join(invalid)}",
            )

    # Optimistic-concurrency commit: only succeeds if the group is still at
    # the epoch this commit was built against. A conditional UPDATE makes the
    # check-and-bump atomic even under concurrent requests (no read-then-write
    # race window), so exactly one of two racing commits wins.
    values = {"current_epoch": new_epoch, "updated_at": datetime.now(timezone.utc)}
    if new_group_info is not None:
        values["group_info"] = new_group_info
    upd = await db.execute(
        update(MLSGroup)
        .where(MLSGroup.channel_id == channel_id, MLSGroup.current_epoch == body.parent_epoch)
        .values(**values)
    )
    if upd.rowcount == 0:
        # Read the real current epoch via a fresh query rather than touching
        # the (now stale/expired-on-rollback) `group` ORM object directly —
        # accessing an expired attribute would trigger an implicit lazy-load,
        # which isn't safe to do outside the greenlet context after rollback.
        current = await db.execute(
            select(MLSGroup.current_epoch).where(MLSGroup.channel_id == channel_id)
        )
        current_epoch = current.scalar_one()
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Commit targets a stale epoch. Current epoch is {current_epoch}; "
                   f"fetch and process newer events, then retry.",
        )

    # Assign the next seq for this channel (max+1, guarded by the unique
    # constraint on (channel_id, seq) if two requests somehow race past here —
    # in practice they can't, since the epoch UPDATE above already serialized
    # them: only the epoch-winner reaches this point).
    seq_result = await db.execute(
        select(func.coalesce(func.max(MLSGroupEvent.seq), 0)).where(MLSGroupEvent.channel_id == channel_id)
    )
    next_seq = seq_result.scalar_one() + 1

    commit_event = MLSGroupEvent(
        channel_id=channel_id,
        seq=next_seq,
        epoch=new_epoch,
        event_type=MLSEventType.commit,
        sender_user_id=current_user.id,
        recipient_user_id=None,
        payload=_b64_to_bytes(body.commit, "commit"),
    )
    db.add(commit_event)

    welcome_events: list[MLSGroupEvent] = []
    for i, w in enumerate(body.welcomes):
        we = MLSGroupEvent(
            channel_id=channel_id,
            seq=next_seq + 1 + i,
            epoch=new_epoch,
            event_type=MLSEventType.welcome,
            sender_user_id=current_user.id,
            recipient_user_id=w.recipient_user_id,
            payload=_b64_to_bytes(w.welcome, "welcome"),
        )
        db.add(we)
        welcome_events.append(we)

    await db.commit()

    member_ids = await _channel_member_ids(channel, db)
    commit_broadcast = {
        "type": "mls.commit",
        "data": {
            "channel_id": str(channel_id),
            "epoch": new_epoch,
            "seq": commit_event.seq,
            "sender_user_id": str(current_user.id),
            "commit": body.commit,
        },
    }
    await manager.broadcast_channel(channel_id, commit_broadcast)
    if member_ids:
        await manager.broadcast_to_users(member_ids, commit_broadcast)

    for we, w in zip(welcome_events, body.welcomes):
        welcome_broadcast = {
            "type": "mls.welcome",
            "data": {
                "channel_id": str(channel_id),
                "epoch": new_epoch,
                "seq": we.seq,
                "sender_user_id": str(current_user.id),
                "welcome": w.welcome,
            },
        }
        await manager.broadcast_to_users([w.recipient_user_id], welcome_broadcast)

    return CommitResult(epoch=new_epoch, seq=commit_event.seq)


@router.get("/groups/{channel_id}/events", response_model=list[GroupEventRead])
async def list_group_events(
    channel_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    since_seq: int = Query(0, ge=0),
):
    """Catch-up feed for reconnecting/joining clients: every commit (visible
    to all members) plus welcomes addressed specifically to the caller,
    strictly ordered by seq so they can be replayed in order."""
    channel = await _get_channel_or_404(channel_id, db)
    await _require_channel_access(channel, current_user.id, db)

    result = await db.execute(
        select(MLSGroupEvent)
        .where(
            MLSGroupEvent.channel_id == channel_id,
            MLSGroupEvent.seq > since_seq,
            or_(
                MLSGroupEvent.event_type == MLSEventType.commit,
                MLSGroupEvent.recipient_user_id == current_user.id,
            ),
        )
        .order_by(MLSGroupEvent.seq.asc())
        .limit(_MAX_EVENTS_PAGE)
    )
    events = result.scalars().all()
    return [
        GroupEventRead(
            id=e.id, channel_id=e.channel_id, seq=e.seq, epoch=e.epoch,
            event_type=e.event_type.value, sender_user_id=e.sender_user_id,
            recipient_user_id=e.recipient_user_id,
            payload=_bytes_to_b64(e.payload), created_at=e.created_at,
        )
        for e in events
    ]
