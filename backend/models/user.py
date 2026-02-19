import uuid
import enum
from datetime import datetime, timezone

from sqlalchemy import String, Enum, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class UserStatus(str, enum.Enum):
    online = "online"
    away = "away"
    busy = "busy"
    offline = "offline"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[UserStatus] = mapped_column(Enum(UserStatus, name="user_status"), default=UserStatus.offline)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    owned_servers: Mapped[list["Server"]] = relationship("Server", back_populates="owner")
    server_memberships: Mapped[list["ServerMember"]] = relationship("ServerMember", back_populates="user")
    role_memberships: Mapped[list["UserRole"]] = relationship("UserRole", back_populates="user")
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="author", foreign_keys="Message.author_id"
    )
    reactions: Mapped[list["Reaction"]] = relationship("Reaction", back_populates="user")
    sent_dms: Mapped[list["DirectMessage"]] = relationship(
        "DirectMessage", back_populates="sender", foreign_keys="DirectMessage.sender_id"
    )
    received_dms: Mapped[list["DirectMessage"]] = relationship(
        "DirectMessage", back_populates="recipient", foreign_keys="DirectMessage.recipient_id"
    )
    sent_friend_requests: Mapped[list["FriendRequest"]] = relationship(
        "FriendRequest", back_populates="sender", foreign_keys="FriendRequest.sender_id"
    )
    received_friend_requests: Mapped[list["FriendRequest"]] = relationship(
        "FriendRequest", back_populates="recipient", foreign_keys="FriendRequest.recipient_id"
    )
    muted_channels: Mapped[list["MutedChannel"]] = relationship("MutedChannel", back_populates="user")
