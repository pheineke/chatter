import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.user import UserRead


class AttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    file_path: str
    file_type: str
    filename: str | None = None
    file_size: int | None = None
    width: int | None = None
    height: int | None = None


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
    content: str | None = None
    reply_to_id: uuid.UUID | None = None

    @field_validator('content', mode='before')
    @classmethod
    def sanitize_content(cls, v) -> str | None:
        if v is None:
            return None
        val = str(v)
        if len(val) > 2000:
            raise ValueError('Message content cannot exceed 2000 characters')
        return val or None


class MessageCreate(MessageBase):
    pass


class MessageUpdate(BaseModel):
    content: str

    @field_validator('content')
    @classmethod
    def sanitize_content(cls, v: str) -> str:
        if not v.strip():
            raise ValueError('Message content cannot be empty')
        if len(v) > 2000:
            raise ValueError('Message content cannot exceed 2000 characters')
        return v


class MessageRead(MessageBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    channel_id: uuid.UUID
    author: UserRead
    author_nickname: str | None = None  # per-server display name; null for DMs
    is_deleted: bool
    is_edited: bool
    edited_at: datetime | None
    created_at: datetime
    attachments: list[AttachmentRead] = []
    reactions: list[ReactionRead] = []
    mentions: list[MentionRead] = []
    reply_to: 'MessageReplyRead | None' = None


class MessageReplyRead(BaseModel):
    """Lightweight message snapshot embedded inside a reply."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    content: str | None
    is_deleted: bool
    author: UserRead


# Keep the forward-reference resolved
MessageRead.model_rebuild()


class PinnedMessageRead(BaseModel):
    """A pinned message, including who pinned it and when."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    pinned_at: datetime
    pinned_by: UserRead
    message: MessageRead


class DMConversationRead(BaseModel):
    channel_id: uuid.UUID
    other_user: UserRead
    last_message_at: datetime | None = None
