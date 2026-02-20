import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from models.user import UserStatus


class UserBase(BaseModel):
    username: str
    description: str | None = None
    pronouns: str | None = None
    status: UserStatus = UserStatus.offline


class UserCreate(BaseModel):
    username: str
    password: str


class UserUpdate(BaseModel):
    description: str | None = None
    pronouns: str | None = None
    status: UserStatus | None = None
    banner: str | None = None


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    avatar: str | None
    banner: str | None
    created_at: datetime


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    user_id: uuid.UUID
