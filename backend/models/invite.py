import uuid
import secrets
from datetime import datetime, timezone, timedelta

from sqlalchemy import String, DateTime, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


def _default_code() -> str:
    return secrets.token_urlsafe(8)


class ServerInvite(Base):
    __tablename__ = "server_invites"

    code: Mapped[str] = mapped_column(String(32), primary_key=True, default=_default_code)
    server_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    uses: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    server: Mapped["Server"] = relationship("Server")  # type: ignore[name-defined]
    creator: Mapped["User"] = relationship("User")  # type: ignore[name-defined]
