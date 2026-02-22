import uuid
import enum

from sqlalchemy import String, Text, ForeignKey, BigInteger, Integer, Enum, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class ChannelPerm:
    """Bitfield constants for ChannelPermission.allow_bits / deny_bits.

    Matches Discord's channel permission overwrites structure.
    Set a bit in allow_bits to explicitly ALLOW that permission for the role.
    Set a bit in deny_bits  to explicitly DENY  that permission for the role.
    If the same bit is in both, deny takes precedence.
    """
    VIEW_CHANNEL        = 1 << 0   #   1 — can see the channel
    SEND_MESSAGES       = 1 << 1   #   2 — can post messages
    MANAGE_MESSAGES     = 1 << 2   #   4 — can delete/pin others' messages
    ATTACH_FILES        = 1 << 3   #   8 — can upload files
    EMBED_LINKS         = 1 << 4   #  16 — links auto-embed
    ADD_REACTIONS       = 1 << 5   #  32 — can add new emoji reactions
    MENTION_EVERYONE    = 1 << 6   #  64 — can use @everyone / @here
    USE_EXTERNAL_EMOJIS = 1 << 7   # 128 — can use emojis from other servers
    MANAGE_ROLES        = 1 << 8   # 256 — can manage per-channel role overrides


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
    slowmode_delay: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    nsfw: Mapped[bool] = mapped_column(default=False, nullable=False)
    user_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)   # voice: max concurrent users (None = unlimited)
    bitrate: Mapped[int | None] = mapped_column(Integer, nullable=True)      # voice: audio bitrate in bps (None = server default)

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
    """Per-role channel permission override.

    Discord-style bitfield: set bits in allow_bits to grant, deny_bits to revoke.
    When both are 0 the role falls back to its server-level permissions.
    """
    __tablename__ = "channel_permissions"

    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    allow_bits: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    deny_bits: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

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
