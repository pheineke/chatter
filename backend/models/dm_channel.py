import uuid

from sqlalchemy import ForeignKey, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class DMChannel(Base):
    """Maps a (user_a, user_b) pair to a shared DM Channel row."""
    __tablename__ = "dm_channels"
    __table_args__ = (
        UniqueConstraint("user_a_id", "user_b_id", name="uq_dm_channel_pair"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    user_a_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    user_b_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    channel: Mapped["Channel"] = relationship("Channel")
    user_a: Mapped["User"] = relationship("User", foreign_keys=[user_a_id])
    user_b: Mapped["User"] = relationship("User", foreign_keys=[user_b_id])
