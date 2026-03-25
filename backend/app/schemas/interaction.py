import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from models.interaction import ApplicationCommandType, InteractionCallbackType

class ApplicationCommandOptionChoice(BaseModel):
    name: str
    value: str | int | float

class ApplicationCommandOption(BaseModel):
    type: int # 1=SUB_COMMAND, 2=SUB_COMMAND_GROUP, 3=STRING, 4=INTEGER, 5=BOOLEAN, 6=USER, 7=CHANNEL, 8=ROLE ...
    name: str
    description: str
    required: bool = False
    choices: list[ApplicationCommandOptionChoice] | None = None
    min_value: int | float | None = None
    max_value: int | float | None = None
    autocomplete: bool | None = None

class ApplicationCommandCreate(BaseModel):
    name: str
    description: str
    type: ApplicationCommandType = ApplicationCommandType.CHAT_INPUT
    options: list[ApplicationCommandOption] | None = None
    default_permission: bool = True

class ApplicationCommandRead(BaseModel):
    id: uuid.UUID
    application_id: uuid.UUID
    server_id: uuid.UUID | None
    name: str
    description: str
    type: ApplicationCommandType
    options: list[ApplicationCommandOption] | None
    default_permission: bool

    model_config = ConfigDict(from_attributes=True)

class InteractionDataOption(BaseModel):
    name: str
    type: int
    value: Any | None = None
    options: list["InteractionDataOption"] | None = None
    focused: bool | None = None # For autocomplete

class InteractionData(BaseModel):
    id: uuid.UUID
    name: str
    type: int
    options: list[InteractionDataOption] | None = None
    resolved: dict[str, Any] | None = None
    target_id: uuid.UUID | None = None # User/Message ID for context menu

class InteractionCreate(BaseModel):
    type: int = 2 # APPLICATION_COMMAND
    data: InteractionData | None = None
    server_id: uuid.UUID | None = None
    channel_id: uuid.UUID | None = None

class InteractionResponseData(BaseModel):
    tts: bool | None = None
    content: str | None = None
    embeds: list[dict] | None = None
    allowed_mentions: dict | None = None
    flags: int | None = None # 64 = Ephemeral
    components: list[dict] | None = None

class InteractionResponse(BaseModel):
    type: int # 4=CHANNEL_MESSAGE_WITH_SOURCE
    data: InteractionResponseData | None = None
