import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserRead


class ServerBase(BaseModel):
    title: str = Field(min_length=1, max_length=50)
    description: str | None = None


class ServerCreate(ServerBase):
    pass


class ServerUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=50)
    description: str | None = None


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
    position: int = 0


class RoleCreate(RoleBase):
    pass


class RoleUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    is_admin: bool | None = None
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
    roles: list[RoleRead] = []
