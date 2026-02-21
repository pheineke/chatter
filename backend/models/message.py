import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Text, DateTime, ForeignKey, Boolean, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    reply_to_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    is_edited: Mapped[bool] = mapped_column(Boolean, default=False)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    channel: Mapped["Channel"] = relationship("Channel", back_populates="messages")
    author: Mapped["User"] = relationship("User", back_populates="messages", foreign_keys=[author_id])
    reply_to: Mapped["Message | None"] = relationship(
        "Message",
        foreign_keys="[Message.reply_to_id]",
        remote_side="[Message.id]",
        uselist=False,
    )
    attachments: Mapped[list["Attachment"]] = relationship(
        "Attachment", back_populates="message", cascade="all, delete-orphan"
    )
    reactions: Mapped[list["Reaction"]] = relationship(
        "Reaction", back_populates="message", cascade="all, delete-orphan"
    )
    mentions: Mapped[list["Mention"]] = relationship(
        "Mention", back_populates="message", cascade="all, delete-orphan"
    )


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False
    )
    file_path: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[str] = mapped_column(String(50), nullable=False)  # image, gif, audio

    message: Mapped["Message"] = relationship("Message", back_populates="attachments")


class Reaction(Base):
    __tablename__ = "reactions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    emoji: Mapped[str] = mapped_column(String(50), nullable=False)

    message: Mapped["Message"] = relationship("Message", back_populates="reactions")
    user: Mapped["User"] = relationship("User", back_populates="reactions")


class Mention(Base):
    __tablename__ = "mentions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    mentioned_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    mentioned_role_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), nullable=True, index=True
    )

    message: Mapped["Message"] = relationship("Message", back_populates="mentions")
    mentioned_user: Mapped["User | None"] = relationship("User", foreign_keys=[mentioned_user_id])
    mentioned_role: Mapped["Role | None"] = relationship("Role", foreign_keys=[mentioned_role_id])

    @property
    def mentioned_username(self) -> "str | None":
        return self.mentioned_user.username if self.mentioned_user else None

    @property
    def mentioned_role_name(self) -> "str | None":
        return self.mentioned_role.name if self.mentioned_role else None
