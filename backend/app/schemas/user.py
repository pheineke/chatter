import re
import unicodedata
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from models.user import UserStatus, DMPermission
from app.utils.sanitize import strip_html


class UserBase(BaseModel):
    username: str
    description: str | None = None
    pronouns: str | None = None
    custom_status: str | None = None
    status: UserStatus = UserStatus.offline


# Matches the @mention syntax (\w), restricted to ASCII so names can't be
# spoofed with homoglyphs or invisible characters.
USERNAME_RE = re.compile(r'[A-Za-z0-9_]{2,32}')


# bcrypt only looks at the first 72 bytes and bcrypt>=5 raises on longer
# input (security_pass S21), so that is the hard ceiling. 72 bytes is still
# 72 ASCII characters, or 18-36 for non-Latin scripts and emoji.
PASSWORD_MIN_CHARS = 8
PASSWORD_MAX_BYTES = 72


def check_new_password(v: str) -> str:
    if len(v) < PASSWORD_MIN_CHARS:
        raise ValueError(f'Password must be at least {PASSWORD_MIN_CHARS} characters')
    if len(v.encode('utf-8')) > PASSWORD_MAX_BYTES:
        raise ValueError(
            f'Password is too long (max {PASSWORD_MAX_BYTES} bytes; '
            'that is 72 plain letters, fewer with accents or emoji)'
        )
    return v


class UserCreate(BaseModel):
    username: str
    password: str
    # Required when REGISTRATION_MODE=invite (see auth.register).
    invite_code: str | None = Field(default=None, max_length=64)

    @field_validator('username')
    @classmethod
    def sanitize_username(cls, v: str) -> str:
        # NFKC folds look-alike forms (full-width letters etc.) before the
        # charset check; uniqueness is case-insensitive (see auth.register and
        # the lower(username) unique index), so "Alice" and "alice" can't coexist.
        cleaned = unicodedata.normalize('NFKC', strip_html(v) or '').strip()
        if not cleaned:
            raise ValueError('Username cannot be empty')
        if not USERNAME_RE.fullmatch(cleaned):
            raise ValueError(
                'Username must be 2–32 characters: letters, numbers and underscores only'
            )
        return cleaned

    @field_validator('password')
    @classmethod
    def validate_password(cls, v: str) -> str:
        return check_new_password(v)


class UserUpdate(BaseModel):
    description: str | None = None
    pronouns: str | None = None
    custom_status: str | None = None
    status: UserStatus | None = None
    banner: str | None = None
    dm_permission: DMPermission | None = None
    allow_server_fonts: bool | None = None
    hide_status: bool | None = None
    avatar_decoration: str | None = None
    theme_preset: str | None = None
    theme_colors: str | None = None
    backup_downloaded: bool | None = None

    @field_validator('description', 'pronouns', 'custom_status', mode='before')
    @classmethod
    def sanitize_text_fields(cls, v):
        return strip_html(v)

    @field_validator('description')
    @classmethod
    def validate_description_length(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 2000:
            raise ValueError('About Me cannot exceed 2000 characters')
        return v

    @field_validator('custom_status')
    @classmethod
    def validate_custom_status_length(cls, v: str | None) -> str | None:
        if v is None:
            return None
        trimmed = v.strip()
        if not trimmed:
            return None
        if len(trimmed) > 120:
            raise ValueError('Custom status cannot exceed 120 characters')
        return trimmed


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
    allow_server_fonts: bool = True
    hide_status: bool = False
    theme_preset: str | None = None
    theme_colors: str | None = None
    backup_downloaded: bool = False


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    user_id: uuid.UUID
