import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Text, DateTime, ForeignKey, Boolean, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class DirectMessage(Base):
    __tablename__ = "direct_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    sender_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    recipient_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    sender: Mapped["User"] = relationship("User", back_populates="sent_dms", foreign_keys=[sender_id])
    recipient: Mapped["User"] = relationship(
        "User", back_populates="received_dms", foreign_keys=[recipient_id]
    )
    attachments: Mapped[list["DMAttachment"]] = relationship(
        "DMAttachment", back_populates="dm", cascade="all, delete-orphan"
    )


class DMAttachment(Base):
    __tablename__ = "dm_attachments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    dm_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("direct_messages.id", ondelete="CASCADE"), nullable=False
    )
    file_path: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[str] = mapped_column(String(50), nullable=False)

    dm: Mapped["DirectMessage"] = relationship("DirectMessage", back_populates="attachments")
