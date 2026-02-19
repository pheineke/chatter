import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.user import UserRead
from models.friend import FriendRequestStatus


class FriendRequestCreate(BaseModel):
    recipient_id: uuid.UUID


class FriendRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sender: UserRead
    recipient: UserRead
    status: FriendRequestStatus
    created_at: datetime


class FriendRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user: UserRead
