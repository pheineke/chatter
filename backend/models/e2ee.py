"""Models for E2EE key management and QR-code-based device login."""
import uuid
import enum
from datetime import datetime, timezone

from sqlalchemy import String, Text, DateTime, ForeignKey, Enum, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class QRSessionStatus(str, enum.Enum):
    pending = "pending"    # waiting for trusted device to scan
    scanned = "scanned"    # trusted device scanned, waiting for user confirmation
    approved = "approved"  # user confirmed — new device may log in + extract key
    expired = "expired"    # TTL exceeded before approval
    used = "used"          # new device already consumed the session


class QRSession(Base):
    """Represents a pending QR-code login session.

    Flow:
      1. New device POST /auth/qr/challenge  → creates a QRSession (status=pending)
         and includes the device's ephemeral ECDH public key.
      2. QR code displayed on new device encodes {session_id, device_ephemeral_pk}.
      3. Trusted device (phone) POST /auth/qr/{id}/approve:
         - authenticates via its own access token
         - encrypts the user's E2EE private key under the new device's ephemeral key
         - server mints a fresh access+refresh token pair for the new session
         - session status → approved; tokens + encrypted key stored on session row
      4. New device polls GET /auth/qr/{id}/status until approved, then:
         - reads encrypted_private_key + phone_e2ee_public_key from response
         - derives shared ECDH secret, decrypts private key
         - uses access_token + refresh_token to authenticate
    """

    __tablename__ = "qr_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    status: Mapped[QRSessionStatus] = mapped_column(
        String(20),
        default=QRSessionStatus.pending,
        nullable=False,
    )

    # The ECDH public key of the new device (ephemeral, base64-encoded DER/SPKI)
    device_ephemeral_pk: Mapped[str] = mapped_column(Text, nullable=False)

    # Filled in by the approving (trusted) device
    approver_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    # AES-GCM encrypted E2EE private key (base64 SPKI/PKCS8)
    encrypted_private_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    # AES-GCM nonce for the encrypted private key (base64)
    encryption_nonce: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # The approver's E2EE ECDH public key (needed by new device to derive shared secret)
    approver_e2ee_public_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Token pair minted for the new session on approval
    access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    approver: Mapped["User | None"] = relationship("User", foreign_keys=[approver_user_id])


class UserE2EEKey(Base):
    """Stores a user's E2EE ECDH public key, published so other users can encrypt messages for them."""

    __tablename__ = "user_e2ee_keys"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # Base64-encoded SPKI public key bytes (ECDH P-256)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    # Human-readable fingerprint (first 16 hex chars of SHA-256 of the raw key bytes)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
