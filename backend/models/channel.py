import uuid
import enum

from sqlalchemy import String, Text, ForeignKey, Boolean, Integer, Enum, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class ChannelType(str, enum.Enum):
    text = "text"
    voice = "voice"
    dm = "dm"


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0)

    server: Mapped["Server"] = relationship("Server", back_populates="categories")
    channels: Mapped[list["Channel"]] = relationship("Channel", back_populates="category")


class Channel(Base):
    __tablename__ = "channels"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), nullable=True
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    type: Mapped[ChannelType] = mapped_column(Enum(ChannelType, name="channel_type"), default=ChannelType.text)
    position: Mapped[int] = mapped_column(Integer, default=0)

    server: Mapped["Server"] = relationship("Server", back_populates="channels")
    category: Mapped["Category | None"] = relationship("Category", back_populates="channels")
    permissions: Mapped[list["ChannelPermission"]] = relationship(
        "ChannelPermission", back_populates="channel", cascade="all, delete-orphan"
    )
    muted_by: Mapped[list["MutedChannel"]] = relationship(
        "MutedChannel", back_populates="channel", cascade="all, delete-orphan"
    )
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="channel", cascade="all, delete-orphan"
    )


class ChannelPermission(Base):
    __tablename__ = "channel_permissions"

    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    can_read: Mapped[bool] = mapped_column(Boolean, default=True)
    can_write: Mapped[bool] = mapped_column(Boolean, default=True)
    can_edit: Mapped[bool] = mapped_column(Boolean, default=False)

    channel: Mapped["Channel"] = relationship("Channel", back_populates="permissions")
    role: Mapped["Role"] = relationship("Role", back_populates="channel_permissions")


class MutedChannel(Base):
    __tablename__ = "muted_channels"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True
    )

    user: Mapped["User"] = relationship("User", back_populates="muted_channels")
    channel: Mapped["Channel"] = relationship("Channel", back_populates="muted_by")
