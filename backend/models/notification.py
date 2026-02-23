import uuid
import enum

from sqlalchemy import String, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base


class NotificationLevel(str, enum.Enum):
    all = "all"
    mentions = "mentions"
    mute = "mute"


class UserChannelNotificationSettings(Base):
    """Per-user, per-channel notification preference."""

    __tablename__ = "user_channel_notification_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True
    )
    level: Mapped[str] = mapped_column(
        String(10), default=NotificationLevel.all.value, nullable=False
    )


class UserServerNotificationSettings(Base):
    """Per-user, per-server notification preference."""

    __tablename__ = "user_server_notification_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    server_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True
    )
    level: Mapped[str] = mapped_column(
        String(10), default=NotificationLevel.all.value, nullable=False
    )
