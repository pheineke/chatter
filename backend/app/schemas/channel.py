import uuid

from pydantic import BaseModel, ConfigDict, field_validator

from models.channel import ChannelType
from app.utils.sanitize import strip_html


class CategoryBase(BaseModel):
    title: str
    position: int = 0

    @field_validator('title', mode='before')
    @classmethod
    def sanitize_title(cls, v):
        return strip_html(v)


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    title: str | None = None
    position: int | None = None

    @field_validator('title', mode='before')
    @classmethod
    def sanitize_title(cls, v):
        return strip_html(v)


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
    slowmode_delay: int = 0  # seconds between messages per user; 0 = disabled

    @field_validator('title', 'description', mode='before')
    @classmethod
    def sanitize_fields(cls, v):
        return strip_html(v)


class ChannelCreate(ChannelBase):
    pass


class ChannelUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    position: int | None = None
    category_id: uuid.UUID | None = None
    slowmode_delay: int | None = None  # 0 = disable slowmode


class ChannelReorderItem(BaseModel):
    id: uuid.UUID
    position: int
    category_id: uuid.UUID | None = None


class CategoryReorderItem(BaseModel):
    id: uuid.UUID
    position: int


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
