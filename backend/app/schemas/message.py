import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.user import UserRead


class AttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    file_path: str
    file_type: str


class ReactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    emoji: str
    user_id: uuid.UUID


class MentionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    mentioned_user_id: uuid.UUID | None = None
    mentioned_role_id: uuid.UUID | None = None
    mentioned_username: str | None = None
    mentioned_role_name: str | None = None


class MessageBase(BaseModel):
    content: str
    reply_to_id: uuid.UUID | None = None


class MessageCreate(MessageBase):
    pass


class MessageUpdate(BaseModel):
    content: str


class MessageRead(MessageBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    channel_id: uuid.UUID
    author: UserRead
    is_deleted: bool
    created_at: datetime
    attachments: list[AttachmentRead] = []
    reactions: list[ReactionRead] = []
    mentions: list[MentionRead] = []


class DMBase(BaseModel):
    content: str


class DMCreate(DMBase):
    pass


class DMAttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    file_path: str
    file_type: str


class DMRead(DMBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sender: UserRead
    recipient: UserRead
    is_deleted: bool
    created_at: datetime
    attachments: list[DMAttachmentRead] = []
