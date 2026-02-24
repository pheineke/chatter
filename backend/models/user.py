import uuid
import enum
from datetime import datetime, timezone

from sqlalchemy import String, Enum, Text, DateTime, Uuid, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class UserStatus(str, enum.Enum):
    online = "online"
    away = "away"
    dnd = "dnd"
    offline = "offline"


class DMPermission(str, enum.Enum):
    everyone = "everyone"
    friends_only = "friends_only"
    server_members_only = "server_members_only"


class DMPermission(str, enum.Enum):
    everyone = "everyone"
    friends_only = "friends_only"
    server_members_only = "server_members_only"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar: Mapped[str | None] = mapped_column(String(255), nullable=True)
    banner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pronouns: Mapped[str | None] = mapped_column(String(50), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[UserStatus] = mapped_column(Enum(UserStatus, name="user_status"), default=UserStatus.offline)
    # The user's chosen non-transient status: restored when they reconnect.
    # Defaults to 'online'; setting status to 'offline' acts as invisible mode.
    preferred_status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus, name="user_status"), default=UserStatus.online, server_default="online"
    )
    dm_permission: Mapped[DMPermission] = mapped_column(
        String(20), default=DMPermission.everyone, server_default="everyone"
    )
    hide_status: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    avatar_decoration: Mapped[str | None] = mapped_column(String(50), nullable=True)
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
    sent_friend_requests: Mapped[list["FriendRequest"]] = relationship(
        "FriendRequest", back_populates="sender", foreign_keys="FriendRequest.sender_id"
    )
    received_friend_requests: Mapped[list["FriendRequest"]] = relationship(
        "FriendRequest", back_populates="recipient", foreign_keys="FriendRequest.recipient_id"
    )
    muted_channels: Mapped[list["MutedChannel"]] = relationship("MutedChannel", back_populates="user")
