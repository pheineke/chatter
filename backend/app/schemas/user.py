import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from models.user import UserStatus, DMPermission
from app.utils.sanitize import strip_html


class UserBase(BaseModel):
    username: str
    description: str | None = None
    pronouns: str | None = None
    status: UserStatus = UserStatus.offline


class UserCreate(BaseModel):
    username: str
    password: str

    @field_validator('username')
    @classmethod
    def sanitize_username(cls, v: str) -> str:
        cleaned = (strip_html(v) or '').strip()
        if not cleaned:
            raise ValueError('Username cannot be empty')
        if len(cleaned) > 50:
            raise ValueError('Username cannot exceed 50 characters')
        return cleaned

    @field_validator('password')
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters')
        return v


class UserUpdate(BaseModel):
    description: str | None = None
    pronouns: str | None = None
    status: UserStatus | None = None
    banner: str | None = None
    dm_permission: DMPermission | None = None
    hide_status: bool | None = None
    avatar_decoration: str | None = None

    @field_validator('description', 'pronouns', mode='before')
    @classmethod
    def sanitize_text_fields(cls, v):
        return strip_html(v)

    @field_validator('description')
    @classmethod
    def validate_description_length(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 2000:
            raise ValueError('About Me cannot exceed 2000 characters')
        return v


class UserPublicRead(UserBase):
    """Public profile view — excludes private preference fields."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    avatar: str | None
    banner: str | None
    avatar_decoration: str | None = None
    dm_permission: DMPermission = DMPermission.everyone
    created_at: datetime


class UserListRead(BaseModel):
    """Lightweight user payload for high-volume list views (friends, requests)."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    avatar: str | None
    avatar_decoration: str | None = None
    status: UserStatus = UserStatus.offline


class UserRead(UserPublicRead):
    """Full profile view — only returned for the authenticated user themselves."""
    preferred_status: UserStatus = UserStatus.online
    hide_status: bool = False


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    user_id: uuid.UUID
