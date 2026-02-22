import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.user import UserRead
from app.utils.sanitize import strip_html

class ServerBase(BaseModel):
    title: str = Field(min_length=1, max_length=50)
    description: str | None = None

    @field_validator('title', 'description', mode='before')
    @classmethod
    def sanitize_fields(cls, v):
        return strip_html(v)


class ServerCreate(ServerBase):
    pass


class ServerUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=50)
    description: str | None = None

    @field_validator('title', 'description', mode='before')
    @classmethod
    def sanitize_fields(cls, v):
        return strip_html(v)


class ServerRead(ServerBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    image: str | None
    banner: str | None
    owner_id: uuid.UUID
    created_at: datetime


class RoleBase(BaseModel):
    name: str
    color: str | None = None
    is_admin: bool = False
    hoist: bool = False
    mentionable: bool = False
    position: int = 0


class RoleCreate(RoleBase):
    pass


class RoleUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    is_admin: bool | None = None
    hoist: bool | None = None
    mentionable: bool | None = None
    position: int | None = None


class RoleRead(RoleBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    server_id: uuid.UUID


class MemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    server_id: uuid.UUID
    user: UserRead
    joined_at: datetime
    nickname: str | None = None
    roles: list[RoleRead] = []


class MemberNickUpdate(BaseModel):
    nickname: str | None = None

    @field_validator('nickname', mode='before')
    @classmethod
    def sanitize_nickname(cls, v):
        if v is None:
            return None
        cleaned = (strip_html(str(v)) or '').strip()
        if len(cleaned) > 32:
            raise ValueError('Nickname cannot exceed 32 characters')
        return cleaned or None
