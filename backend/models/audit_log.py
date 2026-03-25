import uuid
import enum
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import String, DateTime, ForeignKey, Uuid, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base

class AuditLogAction(str, enum.Enum):
    SERVER_UPDATE = "SERVER_UPDATE"
    CHANNEL_CREATE = "CHANNEL_CREATE"
    CHANNEL_UPDATE = "CHANNEL_UPDATE"
    CHANNEL_DELETE = "CHANNEL_DELETE"
    MEMBER_KICK = "MEMBER_KICK"
    MEMBER_BAN = "MEMBER_BAN"
    MEMBER_UNBAN = "MEMBER_UNBAN"
    MEMBER_ROLE_UPDATE = "MEMBER_ROLE_UPDATE"
    ROLE_CREATE = "ROLE_CREATE"
    ROLE_UPDATE = "ROLE_UPDATE"
    ROLE_DELETE = "ROLE_DELETE"
    INVITE_CREATE = "INVITE_CREATE"
    INVITE_DELETE = "INVITE_DELETE"
    WEBHOOK_CREATE = "WEBHOOK_CREATE"
    WEBHOOK_UPDATE = "WEBHOOK_UPDATE"
    WEBHOOK_DELETE = "WEBHOOK_DELETE"
    EMOJI_CREATE = "EMOJI_CREATE"
    EMOJI_UPDATE = "EMOJI_UPDATE"
    EMOJI_DELETE = "EMOJI_DELETE"
    MESSAGE_DELETE = "MESSAGE_DELETE"
    MESSAGE_BULK_DELETE = "MESSAGE_BULK_DELETE"
    MESSAGE_PIN = "MESSAGE_PIN"
    MESSAGE_UNPIN = "MESSAGE_UNPIN"
    INTEGRATION_CREATE = "INTEGRATION_CREATE"
    INTEGRATION_UPDATE = "INTEGRATION_UPDATE"
    INTEGRATION_DELETE = "INTEGRATION_DELETE"

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action_type: Mapped[str] = mapped_column(String(50), nullable=False) # Storing content of AuditLogAction
    target_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    changes: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    server: Mapped["Server"] = relationship("Server", back_populates="audit_logs")
    user: Mapped["User"] = relationship("User") 
