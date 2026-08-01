"""Models for MLS (Messaging Layer Security, RFC 9420) group-encrypted channels.

The server acts purely as an untrusted "Delivery Service" (DS) in MLS terms:
it stores and relays opaque, already-encrypted/authenticated protocol bytes
(KeyPackages, Commits, Welcomes, application-message ciphertext) without ever
holding plaintext or any private key material. All cryptographic operations
happen client-side (see frontend/src/mls/).

One MLS group maps 1:1 to one `channels.id` row — this covers both server
text channels (N-person groups) and DM channels (2-person groups) uniformly,
since DMChannel already wraps a Channel row.
"""
import uuid
import enum
from datetime import datetime, timezone

from sqlalchemy import String, Text, DateTime, ForeignKey, BigInteger, Enum, Uuid, UniqueConstraint, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class MLSEventType(str, enum.Enum):
    commit = "commit"          # a Commit message (may carry proposals inline)
    welcome = "welcome"        # a Welcome, addressed to specific new member(s) only
    proposal = "proposal"      # a standalone by-reference proposal (rare in v1 usage)


class MLSKeyPackage(Base):
    """A published, single-use KeyPackage a user makes available so other
    members can Add them to a group. Public data only — the matching
    PrivateKeyPackage (init/hpke/signature private keys) never leaves the
    client that generated it.
    """

    __tablename__ = "mls_key_packages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Encoded KeyPackage bytes (ts-mls encodeMlsMessage / mls_key_package wireformat)
    key_package: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    user: Mapped["User"] = relationship("User")


class MLSGroup(Base):
    """One row per channel that has an MLS group provisioned.

    `current_epoch` is the server's bookkeeping value used purely for
    optimistic-concurrency control on commits (reject a commit that doesn't
    target the current epoch, so two competing commits can't both "win").
    It does not grant the server any cryptographic capability. Starts at 0
    to match ts-mls's `createGroup()`, whose initial GroupContext.epoch is 0
    (the first Commit — e.g. the founder Adding a second member — advances
    it to 1, same as any other commit).

    `group_info` is an optional, non-secret snapshot (ts-mls
    createGroupInfoWithExternalPub output) that lets a client join a large/
    open channel without needing another member online to commit an Add for
    them (external join). It contains no private key material.
    """

    __tablename__ = "mls_groups"

    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True
    )
    ciphersuite: Mapped[str] = mapped_column(String(80), nullable=False)
    current_epoch: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    group_info: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    channel: Mapped["Channel"] = relationship("Channel")


class MLSGroupEvent(Base):
    """An opaque, ordered protocol event (commit or welcome) for a group.

    `seq` gives every reconnecting/catching-up client a strict total order to
    replay. Application messages (regular chat content) are NOT stored here —
    they continue to flow through the existing `messages` table with
    `is_encrypted=True`, `content` holding the base64 MLS ciphertext, and the
    new `mls_epoch` column recording which epoch they were sent in.

    Welcome events are only ever fetched by their intended new member(s)
    (see recipient_user_id) — they're already individually HPKE-encrypted to
    that member's init key, but scoping delivery avoids leaking group-size/
    membership-churn metadata to everyone.
    """

    __tablename__ = "mls_group_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("mls_groups.channel_id", ondelete="CASCADE"), nullable=False, index=True
    )
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False)
    epoch: Mapped[int] = mapped_column(BigInteger, nullable=False)
    event_type: Mapped[MLSEventType] = mapped_column(Enum(MLSEventType, name="mls_event_type"), nullable=False)
    sender_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # For welcome events only: the specific new member this Welcome is for.
    # NULL for commit events (broadcast to all current + resulting members).
    recipient_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    payload: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        UniqueConstraint("channel_id", "seq", name="uq_mls_group_event_channel_seq"),
    )

    group: Mapped["MLSGroup"] = relationship("MLSGroup")
    sender: Mapped["User"] = relationship("User", foreign_keys=[sender_user_id])
    recipient: Mapped["User | None"] = relationship("User", foreign_keys=[recipient_user_id])
