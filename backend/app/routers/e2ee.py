"""E2EE key management and QR-code device-login endpoints.

QR Login flow (see models/e2ee.py for narrative):
  POST /auth/qr/challenge            → new device creates session
  GET  /auth/qr/{session_id}/status  → new device polls (long-poll friendly)
  POST /auth/qr/{session_id}/approve → trusted device approves + sends encrypted key

E2EE key management:
  GET  /users/{user_id}/e2ee-public-key → fetch any user's public key (for encrypting)
  PUT  /me/e2ee-public-key              → upload / rotate own key pair's public half
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select, delete

from app.auth import create_access_token, generate_refresh_token
from app.dependencies import CurrentUser, DB
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
    device_ephemeral_pk: str


class QRChallengeResponse(BaseModel):
    session_id: uuid.UUID
    # Echo the PK back so the new device can embed it in the QR payload
    device_ephemeral_pk: str
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
    access = create_access_token(user_id)
    raw_rt, rt_hash = generate_refresh_token()
    expires = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    db.add(RefreshToken(
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

@router.post("/auth/qr/challenge", response_model=QRChallengeResponse, status_code=201)
async def qr_challenge(body: QRChallengeRequest, db: DB):
    """Create a new QR login session.

    Called by the *new* (untrusted) device.  No authentication required —
    the session is not associated with any user until a trusted device approves it.
    """
    expires = datetime.now(timezone.utc) + timedelta(seconds=_QR_TTL_SECONDS)
    session = QRSession(
        device_ephemeral_pk=body.device_ephemeral_pk,
        expires_at=expires,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return QRChallengeResponse(
        session_id=session.id,
        device_ephemeral_pk=session.device_ephemeral_pk,
        expires_at=session.expires_at,
    )


@router.get("/auth/qr/{session_id}/status", response_model=QRStatusResponse)
async def qr_status(session_id: uuid.UUID, db: DB):
    """Poll the status of a QR session.

    Called by the *new* device every ~2 s.  Sensitive token fields are only
    returned once the session is 'approved'; the session is then moved to
    'used' so the tokens cannot be fetched a second time.
    """
    result = await db.execute(select(QRSession).where(QRSession.id == session_id))
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="QR session not found")

    # Mark expired sessions
    now = datetime.now(timezone.utc)
    exp = session.expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < now and session.status == QRSessionStatus.pending:
        session.status = QRSessionStatus.expired
        await db.commit()

    if session.status == QRSessionStatus.approved:
        # Return tokens exactly once, then mark as used
        resp = QRStatusResponse(
            session_id=session.id,
            status=QRSessionStatus.approved,
            access_token=session.access_token,
            refresh_token=session.refresh_token,
            encrypted_private_key=session.encrypted_private_key,
            encryption_nonce=session.encryption_nonce,
            approver_e2ee_public_key=session.approver_e2ee_public_key,
        )
        session.status = QRSessionStatus.used
        await db.commit()
        return resp

    return QRStatusResponse(session_id=session.id, status=session.status)


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

    now = datetime.now(timezone.utc)
    exp = session.expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)

    if session.status != QRSessionStatus.pending:
        raise HTTPException(status_code=409, detail=f"QR session is already '{session.status}'")
    if exp < now:
        session.status = QRSessionStatus.expired
        await db.commit()
        raise HTTPException(status_code=410, detail="QR session has expired")

    # Mint a fresh token pair for the new device session
    access, raw_rt = await _issue_token_pair_for_user(current_user.id, db, ua=_get_ua(request))

    session.status = QRSessionStatus.approved
    session.approver_user_id = current_user.id
    session.encrypted_private_key = body.encrypted_private_key
    session.encryption_nonce = body.encryption_nonce
    session.approver_e2ee_public_key = body.approver_e2ee_public_key
    session.access_token = access
    session.refresh_token = raw_rt

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
    result = await db.execute(
        select(UserE2EEKey).where(UserE2EEKey.user_id == current_user.id)
    )
    key_row = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if key_row is None:
        key_row = UserE2EEKey(
            user_id=current_user.id,
            public_key=body.public_key,
            fingerprint=body.fingerprint,
            created_at=now,
            updated_at=now,
        )
        db.add(key_row)
    else:
        key_row.public_key = body.public_key
        key_row.fingerprint = body.fingerprint
        key_row.updated_at = now

    await db.commit()
    await db.refresh(key_row)
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
