import uuid
import enum
from typing import Any

from sqlalchemy import String, ForeignKey, Uuid, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class ApplicationCommandType(str, enum.Enum):
    CHAT_INPUT = "CHAT_INPUT"  # Slash commands
    USER = "USER"              # User context menu
    MESSAGE = "MESSAGE"        # Message context menu


class ApplicationCommand(Base):
    __tablename__ = "application_commands"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    server_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), nullable=True) # Null for global
    
    name: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(String(100), nullable=False)
    options: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True) # Argument structure
    default_permission: Mapped[bool] = mapped_column(Boolean, default=True)
    type: Mapped[str] = mapped_column(String(20), default=ApplicationCommandType.CHAT_INPUT.value)
    
    # Example option structure:
    # {
    #   "name": "reason", "description": "Reason for ban", "type": "STRING", "required": false,
    #   "choices": [{"name": "spam", "value": "spam"}]
    # }

    application: Mapped["User"] = relationship("User")  # Ideally "Application" model but linking to User/Bot for now


class InteractionType(int, enum.Enum):
    PING = 1
    APPLICATION_COMMAND = 2
    MESSAGE_COMPONENT = 3
    APPLICATION_COMMAND_AUTOCOMPLETE = 4
    MODAL_SUBMIT = 5


class InteractionCallbackType(int, enum.Enum):
    PONG = 1
    CHANNEL_MESSAGE_WITH_SOURCE = 4
    DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5
    DEFERRED_UPDATE_MESSAGE = 6
    UPDATE_MESSAGE = 7
    APPLICATION_COMMAND_AUTOCOMPLETE_RESULT = 8
    MODAL = 9
