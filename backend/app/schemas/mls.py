"""Pydantic schemas for the MLS (RFC 9420) delivery-service endpoints.

All protocol payloads (KeyPackages, Commits, Welcomes, GroupInfo) are opaque
to the server and travel as base64-encoded strings over JSON, matching the
convention already used for the legacy E2EE endpoints (app/schemas — see
E2EEPublicKeyRead/Write in app/routers/e2ee.py).
"""
import uuid
from datetime import datetime

from pydantic import BaseModel


class KeyPackagePublish(BaseModel):
    key_package: str  # base64 encoded MLS KeyPackage message


class KeyPackageRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    key_package: str
    created_at: datetime


class GroupInit(BaseModel):
    ciphersuite: str
    group_info: str | None = None  # base64, optional public GroupInfo snapshot


class GroupRead(BaseModel):
    channel_id: uuid.UUID
    ciphersuite: str
    current_epoch: int
    group_info: str | None = None
    created_at: datetime
    updated_at: datetime


class WelcomeRecipient(BaseModel):
    recipient_user_id: uuid.UUID
    welcome: str  # base64, individually HPKE-encrypted to the recipient's init key


class CommitSubmit(BaseModel):
    parent_epoch: int  # epoch the client built this commit against
    commit: str  # base64 encoded MLS commit message (public or private wireformat)
    welcomes: list[WelcomeRecipient] = []
    group_info: str | None = None  # updated GroupInfo, if the committer refreshed external-join info


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
