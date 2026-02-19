import uuid

from pydantic import BaseModel, ConfigDict

from models.channel import ChannelType


class CategoryBase(BaseModel):
    title: str
    position: int = 0


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    title: str | None = None
    position: int | None = None


class CategoryRead(CategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    server_id: uuid.UUID


class ChannelBase(BaseModel):
    title: str
    description: str | None = None
    type: ChannelType = ChannelType.text
    position: int = 0
    category_id: uuid.UUID | None = None


class ChannelCreate(ChannelBase):
    pass


class ChannelUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    position: int | None = None
    category_id: uuid.UUID | None = None


class ChannelRead(ChannelBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    server_id: uuid.UUID


class ChannelPermissionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    channel_id: uuid.UUID
    role_id: uuid.UUID
    can_read: bool
    can_write: bool
    can_edit: bool


class ChannelPermissionSet(BaseModel):
    can_read: bool = True
    can_write: bool = True
    can_edit: bool = False
