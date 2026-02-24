import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class DecorationCode(Base):
    """A redeemable code that unlocks an avatar decoration frame for one user."""

    __tablename__ = "decoration_codes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    frame_id: Mapped[str] = mapped_column(String(50), nullable=False)
    redeemed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    redeemer: Mapped["User | None"] = relationship("User", foreign_keys=[redeemed_by])
