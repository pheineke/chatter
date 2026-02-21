import uuid

from sqlalchemy import Text, Uuid, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base


class UserNote(Base):
    """A personal note one user writes about another (visible only to the author)."""

    __tablename__ = "user_notes"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
