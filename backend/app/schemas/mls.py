"""Pydantic schemas for the MLS (RFC 9420) delivery-service endpoints.

All protocol payloads (KeyPackages, Commits, Welcomes, GroupInfo) are opaque
to the server and travel as base64-encoded strings over JSON, matching the
convention already used for the legacy E2EE endpoints (app/schemas — see
E2EEPublicKeyRead/Write in app/routers/e2ee.py).
"""
import uuid
from datetime import datetime

from pydantic import BaseModel, Field

# Upper bounds on the opaque base64 blobs clients hand us. The server can't
# parse these (that's the point of an untrusted delivery service), so length
# is the only property it can meaningfully police — and without a cap, "store
# this opaque blob for me" is an open-ended storage-exhaustion primitive:
# nginx accepts 50MB bodies, and the publish/commit rate limits alone would
# still permit gigabytes per user per hour.
#
# Sizes are generous multiples of what the MLS_128_DHKEMX25519_AES128GCM
# ciphersuite actually produces (KeyPackages ~350B, commits/welcomes low
# single-digit KB, growing with group size), chosen to leave large groups
# and future ciphersuites plenty of headroom while still bounding abuse.
MAX_KEY_PACKAGE_B64 = 16_384
MAX_COMMIT_B64 = 1_048_576
MAX_WELCOME_B64 = 1_048_576
MAX_GROUP_INFO_B64 = 1_048_576
MAX_CIPHERSUITE_NAME = 128
# One Welcome per member being Added in a single commit. Real clients Add one
# at a time, or batch a channel's members at creation; this bounds the row
# and WebSocket fan-out a single request can trigger.
MAX_WELCOMES_PER_COMMIT = 256


MAX_DEVICE_ID = 64


class KeyPackagePublish(BaseModel):
    key_package: str = Field(max_length=MAX_KEY_PACKAGE_B64)  # base64 encoded MLS KeyPackage message
    # Which of the caller's devices generated this; only that device holds the
    # matching private half. Client-generated UUID (see ensureIdentity in
    # frontend/src/mls/session.ts).
    device_id: str = Field(min_length=1, max_length=MAX_DEVICE_ID)


class KeyPackageRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    device_id: str
    key_package: str
    created_at: datetime


class GroupInit(BaseModel):
    ciphersuite: str = Field(max_length=MAX_CIPHERSUITE_NAME)
    # base64, optional public GroupInfo snapshot
    group_info: str | None = Field(default=None, max_length=MAX_GROUP_INFO_B64)


class GroupRead(BaseModel):
    channel_id: uuid.UUID
    ciphersuite: str
    current_epoch: int
    group_info: str | None = None
    created_at: datetime
    updated_at: datetime


# ---- Link-time history transfer -------------------------------------------
# Sizes are larger than the protocol payloads above because a bundle carries
# actual message plaintext. Capped anyway: the server can't read it, so length
# is the only thing it can police, and an uncapped "store this blob" endpoint
# is a storage-exhaustion primitive.
MAX_TRANSFER_PUBLIC_KEY_B64 = 1_024
MAX_HISTORY_BUNDLE_B64 = 8_388_608  # ~8 MiB of ciphertext
MAX_NONCE_B64 = 64


class HistoryRequestCreate(BaseModel):
    """A newly-linked device asking this user's other devices for history."""
    device_id: str = Field(min_length=1, max_length=MAX_DEVICE_ID)
    # Base64 SPKI ECDH P-256 public key, ephemeral and used for this transfer
    # only. Deliberately not an MLS init key: those are single-use and consumed
    # by Adds, so borrowing one would interfere with joining groups.
    public_key: str = Field(min_length=1, max_length=MAX_TRANSFER_PUBLIC_KEY_B64)


class HistoryRequestRead(BaseModel):
    id: uuid.UUID
    device_id: str
    public_key: str
    created_at: datetime


class HistoryBundleCreate(BaseModel):
    """History encrypted by one of the user's devices for another."""
    target_device_id: str = Field(min_length=1, max_length=MAX_DEVICE_ID)
    sender_device_id: str = Field(min_length=1, max_length=MAX_DEVICE_ID)
    ciphertext: str = Field(min_length=1, max_length=MAX_HISTORY_BUNDLE_B64)
    nonce: str = Field(min_length=1, max_length=MAX_NONCE_B64)


class HistoryBundleRead(BaseModel):
    id: uuid.UUID
    sender_device_id: str
    ciphertext: str
    nonce: str
    created_at: datetime


class WelcomeRecipient(BaseModel):
    recipient_user_id: uuid.UUID
    # base64, individually HPKE-encrypted to the recipient's init key
    welcome: str = Field(max_length=MAX_WELCOME_B64)


class CommitSubmit(BaseModel):
    # Epoch the client built this commit against. Non-negative: epochs start
    # at 0 and only increase, and commit_group derives new_epoch from this,
    # so a negative value is always a malformed/hostile request.
    parent_epoch: int = Field(ge=0)
    # base64 encoded MLS commit message (public or private wireformat)
    commit: str = Field(max_length=MAX_COMMIT_B64)
    welcomes: list[WelcomeRecipient] = Field(default=[], max_length=MAX_WELCOMES_PER_COMMIT)
    # updated GroupInfo, if the committer refreshed external-join info
    group_info: str | None = Field(default=None, max_length=MAX_GROUP_INFO_B64)


class GroupEventRead(BaseModel):
    id: uuid.UUID
    channel_id: uuid.UUID
    seq: int
    epoch: int
    event_type: str
    sender_user_id: uuid.UUID
    recipient_user_id: uuid.UUID | None = None
    payload: str  # base64
    created_at: datetime


class CommitResult(BaseModel):
    epoch: int
    seq: int
