import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.user import UserRead
from app.utils.sanitize import strip_html


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
    content: str | None = None
    reply_to_id: uuid.UUID | None = None

    @field_validator('content', mode='before')
    @classmethod
    def sanitize_content(cls, v) -> str | None:
        if v is None:
            return None
        cleaned = strip_html(str(v)) or ''
        if len(cleaned) > 2000:
            raise ValueError('Message content cannot exceed 2000 characters')
        return cleaned or None


class MessageCreate(MessageBase):
    pass


class MessageUpdate(BaseModel):
    content: str

    @field_validator('content')
    @classmethod
    def sanitize_content(cls, v: str) -> str:
        cleaned = strip_html(v) or ''
        if not cleaned.strip():
            raise ValueError('Message content cannot be empty')
        if len(cleaned) > 2000:
            raise ValueError('Message content cannot exceed 2000 characters')
        return cleaned


class MessageRead(MessageBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    channel_id: uuid.UUID
    author: UserRead
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


class DMConversationRead(BaseModel):
    channel_id: uuid.UUID
    other_user: UserRead
    last_message_at: datetime | None = None
