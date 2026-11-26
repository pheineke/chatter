"""E2EE key management and QR-code device-login endpoints.

QR Login flow (see models/e2ee.py for narrative):
  POST /auth/qr/challenge            → new device creates session
  GET  /auth/qr/{session_id}/status  → new device polls (long-poll friendly)
  POST /auth/qr/{session_id}/approve → trusted device approves + sends encrypted key

E2EE key management:
  GET  /users/{user_id}/e2ee-public-key → fetch any user's public key (for encrypting)
  PUT  /me/e2ee-public-key              → upload / rotate own key pair's public half
"""
import hashlib
import hmac
import ipaddress
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.auth import create_access_token, generate_refresh_token
from app.dependencies import CurrentUser, DB
from app.rate_limiter import rate_limit_qr_challenge, rate_limit_qr_status
from models.e2ee import QRSession, QRSessionStatus, UserE2EEKey
from models.refresh_token import RefreshToken
from app.config import settings

router = APIRouter(tags=["e2ee"])

# How long a QR session stays alive before expiry (seconds)
_QR_TTL_SECONDS = 120


# ─── Pydantic schemas ──────────────────────────────────────────────────────────

class QRChallengeRequest(BaseModel):
    """Sent by the new device when it first creates a QR session."""
    # ECDH P-256 ephemeral public key of the new device, base64-encoded SPKI
    device_ephemeral_pk: str = Field(min_length=1, max_length=512)


class QRChallengeResponse(BaseModel):
    session_id: uuid.UUID
    # Echo the PK back so the new device can embed it in the QR payload
    device_ephemeral_pk: str
    expires_at: datetime
    # Keep this on the new device; never put it in the QR code. Send it as
    # the X-QR-Poll-Secret header when polling /status.
    poll_secret: str


class QRSessionInfo(BaseModel):
    """Shown on the approving device before it approves."""
    session_id: uuid.UUID
    requester_ip: str | None
    requester_user_agent: str | None
    same_network: bool
    created_at: datetime
    expires_at: datetime


class QRStatusResponse(BaseModel):
    session_id: uuid.UUID
    status: QRSessionStatus
    # These are only populated once status == "approved"
    access_token: str | None = None
    refresh_token: str | None = None
    encrypted_private_key: str | None = None
    encryption_nonce: str | None = None
    approver_e2ee_public_key: str | None = None


class QRApproveRequest(BaseModel):
    """Sent by the TRUSTED (already-logged-in) device after scanning the QR code."""
    # AES-GCM ciphertext of the user's ECDH private key, base64-encoded
    encrypted_private_key: str
    # AES-GCM IV / nonce, base64-encoded
    encryption_nonce: str
    # The trusted device's own E2EE ECDH public key (SPKI base64)
    # — the new device uses this to derive the shared ECDH secret and decrypt.
    approver_e2ee_public_key: str


class E2EEPublicKeyRead(BaseModel):
    user_id: uuid.UUID
    public_key: str
    fingerprint: str
    updated_at: datetime


class E2EEPublicKeyWrite(BaseModel):
    # ECDH P-256 public key, base64-encoded SPKI
    public_key: str
    # SHA-256 fingerprint (first 32 hex chars) for display / OOB verification
    fingerprint: str


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _issue_token_pair_for_user(user_id: uuid.UUID, db, *, ua: str | None = None) -> tuple[str, str]:
    """Mint a new access + refresh token pair, persist the refresh token, return (access, raw_refresh)."""
    session_id = uuid.uuid4()
    access = create_access_token(user_id, session_id=session_id)
    raw_rt, rt_hash = generate_refresh_token()
    expires = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    db.add(RefreshToken(
        id=session_id,
        token_hash=rt_hash,
        user_id=user_id,
        expires_at=expires,
        user_agent=ua,
        last_used_at=datetime.now(timezone.utc),
    ))
    return access, raw_rt


def _get_ua(request: Request) -> str | None:
    ua = request.headers.get("User-Agent", "")
    return ua[:512] if ua else None


# ─── QR Session endpoints ──────────────────────────────────────────────────────
#
# Hardening (security_pass S18):
# * The new device gets a poll secret that is not in the QR code; collecting
#   the tokens needs it, so a photo of the QR is not enough.
# * Tokens and the wrapped E2EE key are handed out once, by an atomic claim,
#   and wiped from the row in the same UPDATE.
# * Rows are purged a few minutes after they expire.
# * The approver sees where the request came from (browser, IP, same network
#   or not) before approving, to make QRLjacking — an attacker showing the
#   victim *their* QR — visible.

# Keep expired rows this long so a device that was approved right at the end
# of the TTL can still collect its tokens.
_QR_PURGE_GRACE = timedelta(minutes=5)
POLL_SECRET_HEADER = "X-QR-Poll-Secret"


def _hash_poll_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _client_ip(request: Request) -> str | None:
    return request.client.host[:64] if request.client else None


def _same_network(a: str | None, b: str | None) -> bool:
    """Same IPv4 address, or same IPv6 /64. Devices on one home network
    share the public IPv4 (NAT) but each gets its own IPv6 address inside
    the network's /64, so exact matching would flag every IPv6 user."""
    if not a or not b:
        return False
    try:
        ia, ib = ipaddress.ip_address(a), ipaddress.ip_address(b)
    except ValueError:
        return False
    if ia.version != ib.version:
        return False
    if ia.version == 6:
        return ipaddress.ip_network(f"{ia}/64", strict=False) == ipaddress.ip_network(f"{ib}/64", strict=False)
    return ia == ib


def _aware(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


async def _purge_old_qr_sessions(db) -> None:
    cutoff = datetime.now(timezone.utc) - _QR_PURGE_GRACE
    await db.execute(delete(QRSession).where(QRSession.expires_at < cutoff))


@router.post("/auth/qr/challenge", response_model=QRChallengeResponse, status_code=201)
async def qr_challenge(
    request: Request,
    body: QRChallengeRequest,
    db: DB,
    _rl: None = Depends(rate_limit_qr_challenge),
):
    """Create a new QR login session.

    Called by the *new* (untrusted) device.  No authentication required —
    the session is not associated with any user until a trusted device approves it.
    """
    await _purge_old_qr_sessions(db)
    poll_secret = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(seconds=_QR_TTL_SECONDS)
    session = QRSession(
        device_ephemeral_pk=body.device_ephemeral_pk,
        expires_at=expires,
        poll_secret_hash=_hash_poll_secret(poll_secret),
        requester_ip=_client_ip(request),
        requester_user_agent=_get_ua(request),
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return QRChallengeResponse(
        session_id=session.id,
        device_ephemeral_pk=session.device_ephemeral_pk,
        expires_at=session.expires_at,
        poll_secret=poll_secret,
    )


@router.get("/auth/qr/{session_id}/status", response_model=QRStatusResponse)
async def qr_status(
    session_id: uuid.UUID,
    db: DB,
    poll_secret: Annotated[str | None, Header(alias=POLL_SECRET_HEADER)] = None,
    _rl: None = Depends(rate_limit_qr_status),
):
    """Poll the status of a QR session.

    Called by the *new* device every ~2 s with the poll secret it got from
    /challenge. Once approved, the tokens and wrapped key are returned exactly
    once and erased from the database in the same statement.
    """
    result = await db.execute(select(QRSession).where(QRSession.id == session_id))
    session = result.scalar_one_or_none()
    # Unknown session and wrong secret look the same.
    if (
        session is None
        or not poll_secret
        or not session.poll_secret_hash
        or not hmac.compare_digest(session.poll_secret_hash, _hash_poll_secret(poll_secret))
    ):
        raise HTTPException(status_code=404, detail="QR session not found")

    now = datetime.now(timezone.utc)
    if _aware(session.expires_at) < now and session.status in (
        QRSessionStatus.pending, QRSessionStatus.scanned
    ):
        session.status = QRSessionStatus.expired
        await db.commit()

    if session.status == QRSessionStatus.approved:
        resp = QRStatusResponse(
            session_id=session.id,
            status=QRSessionStatus.approved,
            access_token=session.access_token,
            refresh_token=session.refresh_token,
            encrypted_private_key=session.encrypted_private_key,
            encryption_nonce=session.encryption_nonce,
            approver_e2ee_public_key=session.approver_e2ee_public_key,
        )
        # Claim and wipe in one conditional UPDATE: a second, concurrent poll
        # matches zero rows and gets no tokens.
        claimed = await db.execute(
            update(QRSession)
            .where(QRSession.id == session.id, QRSession.status == QRSessionStatus.approved)
            .values(
                status=QRSessionStatus.used,
                access_token=None,
                refresh_token=None,
                encrypted_private_key=None,
                encryption_nonce=None,
            )
            .execution_options(synchronize_session=False)
        )
        await db.commit()
        if claimed.rowcount == 1:
            return resp
        return QRStatusResponse(session_id=session.id, status=QRSessionStatus.used)

    return QRStatusResponse(session_id=session.id, status=session.status)


@router.get("/auth/qr/{session_id}", response_model=QRSessionInfo)
async def qr_session_info(
    request: Request,
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    """What the approving device shows before the user taps Approve: which
    browser and IP asked for the login, and whether it is on the approver's
    own network. Marks a pending session as scanned."""
    result = await db.execute(select(QRSession).where(QRSession.id == session_id))
    session = result.scalar_one_or_none()
    if session is None or _aware(session.expires_at) < datetime.now(timezone.utc):
        raise HTTPException(status_code=404, detail="QR session not found or expired")
    if session.status not in (QRSessionStatus.pending, QRSessionStatus.scanned):
        raise HTTPException(status_code=409, detail=f"QR session is already '{session.status}'")
    if session.status == QRSessionStatus.pending:
        session.status = QRSessionStatus.scanned
        await db.commit()
    approver_ip = _client_ip(request)
    return QRSessionInfo(
        session_id=session.id,
        requester_ip=session.requester_ip,
        requester_user_agent=session.requester_user_agent,
        same_network=_same_network(session.requester_ip, approver_ip),
        created_at=session.created_at,
        expires_at=session.expires_at,
    )


@router.post("/auth/qr/{session_id}/approve", status_code=200, response_model=QRStatusResponse)
async def qr_approve(
    request: Request,
    session_id: uuid.UUID,
    body: QRApproveRequest,
    current_user: CurrentUser,
    db: DB,
):
    """Approve a QR login session from a trusted (already authenticated) device.

    The trusted device:
    1. Has already derived a shared ECDH secret using its own E2EE private key
       and the new device's ephemeral public key (included in the QR payload).
    2. Has encrypted the user's E2EE private key with AES-GCM using that secret.
    3. Posts the encrypted key here alongside its own E2EE public key so the new
       device can re-derive the shared secret to decrypt.
    """
    result = await db.execute(select(QRSession).where(QRSession.id == session_id))
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="QR session not found")

    if session.status not in (QRSessionStatus.pending, QRSessionStatus.scanned):
        raise HTTPException(status_code=409, detail=f"QR session is already '{session.status}'")
    if _aware(session.expires_at) < datetime.now(timezone.utc):
        session.status = QRSessionStatus.expired
        await db.commit()
        raise HTTPException(status_code=410, detail="QR session has expired")

    # The new session is labelled with the *new* device's browser, not the
    # approver's.
    access, raw_rt = await _issue_token_pair_for_user(
        current_user.id, db, ua=session.requester_user_agent
    )

    # Only one approval wins, even if two trusted devices race.
    claimed = await db.execute(
        update(QRSession)
        .where(
            QRSession.id == session.id,
            QRSession.status.in_([QRSessionStatus.pending, QRSessionStatus.scanned]),
        )
        .values(
            status=QRSessionStatus.approved,
            approver_user_id=current_user.id,
            encrypted_private_key=body.encrypted_private_key,
            encryption_nonce=body.encryption_nonce,
            approver_e2ee_public_key=body.approver_e2ee_public_key,
            access_token=access,
            refresh_token=raw_rt,
        )
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        await db.rollback()  # also drops the refresh token minted above
        raise HTTPException(status_code=409, detail="QR session was already approved")
    await db.commit()

    return QRStatusResponse(session_id=session.id, status=QRSessionStatus.approved)


# ─── E2EE public key endpoints ─────────────────────────────────────────────────

@router.put("/me/e2ee-public-key", response_model=E2EEPublicKeyRead)
async def upsert_own_e2ee_key(body: E2EEPublicKeyWrite, current_user: CurrentUser, db: DB):
    """Upload or rotate your E2EE ECDH public key.

    The server stores only the *public* key.  Private key material never
    leaves the client—it lives in IndexedDB and is transferred device-to-device
    through the encrypted QR login flow.
    """
    now = datetime.now(timezone.utc)
    stmt = pg_insert(UserE2EEKey).values(
        user_id=current_user.id,
        public_key=body.public_key,
        fingerprint=body.fingerprint,
        created_at=now,
        updated_at=now,
    ).on_conflict_do_update(
        index_elements=[UserE2EEKey.user_id],
        set_={
            "public_key": body.public_key,
            "fingerprint": body.fingerprint,
            "updated_at": now,
        },
    )
    await db.execute(stmt)
    await db.commit()

    result = await db.execute(
        select(UserE2EEKey).where(UserE2EEKey.user_id == current_user.id)
    )
    key_row = result.scalar_one()
    return E2EEPublicKeyRead(
        user_id=key_row.user_id,
        public_key=key_row.public_key,
        fingerprint=key_row.fingerprint,
        updated_at=key_row.updated_at,
    )


@router.get("/users/{user_id}/e2ee-public-key", response_model=E2EEPublicKeyRead)
async def get_user_e2ee_key(user_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Retrieve another user's E2EE public key so you can encrypt a DM for them."""
    result = await db.execute(
        select(UserE2EEKey).where(UserE2EEKey.user_id == user_id)
    )
    key_row = result.scalar_one_or_none()
    if key_row is None:
        raise HTTPException(status_code=404, detail="This user has not enabled E2EE")
    return E2EEPublicKeyRead(
        user_id=key_row.user_id,
        public_key=key_row.public_key,
        fingerprint=key_row.fingerprint,
        updated_at=key_row.updated_at,
    )
