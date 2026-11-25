import uuid
from typing import List

from fastapi import APIRouter, HTTPException, Depends

from app.authz import require_channel_perms
from app.dependencies import CurrentUser, DB
from app.rate_limiter import rate_limit_messages
from app.routers.messages import (
    _apply_word_filters,
    _get_channel_or_404,
    _message_load_options,
    enrich_message_read,
)
from app.ws_manager import manager
from models.channel import ChannelPerm
from models.message import Message
from app.schemas.interaction import (
    ApplicationCommandCreate,
    ApplicationCommandRead,
    InteractionCreate,
    InteractionResponse,
    InteractionResponseData,
    InteractionCallbackType,
)
from models.interaction import ApplicationCommand
from models.user import User
from sqlalchemy import select

router = APIRouter(tags=["interactions"])


# ---- Command Registration ---------------------------------------------------

@router.post("/applications/{application_id}/commands", response_model=ApplicationCommandRead)
async def create_global_command(
    application_id: uuid.UUID,
    body: ApplicationCommandCreate,
    current_user: CurrentUser,
    db: DB,
):
    """Register a new global slash command for an application (bot).

    Only the bot account itself (authenticated with its own API token) may
    register commands under its ID. Otherwise anyone could attach commands to
    another user's ID and make messages appear authored by them.
    """
    if application_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only register commands for your own application")
    if not current_user.is_bot:
        raise HTTPException(status_code=403, detail="Only bot accounts can register application commands")
    app = current_user

    cmd = ApplicationCommand(
        application_id=app.id,
        name=body.name,
        description=body.description,
        options=[opt.model_dump() for opt in body.options] if body.options else None,
        type=body.type,
        default_permission=body.default_permission,
    )
    db.add(cmd)
    await db.commit()
    await db.refresh(cmd)
    return cmd

@router.get("/applications/{application_id}/commands", response_model=List[ApplicationCommandRead])
async def get_application_commands(
    application_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    result = await db.execute(
        select(ApplicationCommand).where(ApplicationCommand.application_id == application_id)
    )
    return result.scalars().all()

# ---- Command Discovery ------------------------------------------------------

@router.get("/commands", response_model=List[ApplicationCommandRead])
async def list_commands(
    current_user: CurrentUser,
    db: DB,
    server_id: uuid.UUID | None = None,
):
    """
    Fetch all applicable commands for a context.
    - Global commands
    - Server-specific commands (if server_id provided)
    """
    stmt = select(ApplicationCommand).where(ApplicationCommand.server_id == None)
    if server_id:
        stmt = select(ApplicationCommand).where(
            (ApplicationCommand.server_id == None) | (ApplicationCommand.server_id == server_id)
        )
    
    result = await db.execute(stmt)
    return result.scalars().all()

# ---- Interaction Execution --------------------------------------------------

@router.post("/interactions", response_model=InteractionResponse)
async def create_interaction(
    interaction: InteractionCreate,
    current_user: CurrentUser,
    db: DB,
    _rl: None = Depends(rate_limit_messages),
):
    """
    Handle slash command execution (Interaction).
    Returns an initial response (e.g. channel message or deferred).
    """
    # 1. Validate data & Fetch Command
    cmd = None
    if interaction.data and interaction.data.id:
        cmd = await db.get(ApplicationCommand, interaction.data.id)

    if not cmd:
         # Fallback for unregistered commands (e.g. testing)
         if interaction.data and interaction.data.name == "ping":
             return InteractionResponse(
                type=InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE,
                data=InteractionResponseData(content="Pong! 🏓", flags=64),
            )
         raise HTTPException(status_code=404, detail="Command not found")

    # 2. Dispatch Logic
    response_content = None
    is_ephemeral = False

    if cmd.name == "ping":
        response_content = "Pong! 🏓"
        is_ephemeral = True
    elif cmd.name == "echo":
        msg = "No message provided"
        if interaction.data.options:
            for opt in interaction.data.options:
                if opt.name == "message":
                    msg = str(opt.value)
                elif opt.name == "ephemeral":
                    if isinstance(opt.value, bool):
                        is_ephemeral = opt.value
                    elif isinstance(opt.value, str):
                        is_ephemeral = opt.value.lower() == 'true'
        response_content = msg
    else:
        response_content = f"Command `/{cmd.name}` received."

    # 3. Execute: Create Message + Broadcast
    if response_content and interaction.channel_id and not is_ephemeral:
        # The invoking user must be allowed to post in the target channel; the
        # message then appears there authored by the (bot) application.
        channel = await _get_channel_or_404(interaction.channel_id, db)
        await require_channel_perms(channel, current_user.id, db, ChannelPerm.SEND_MESSAGES)
        if cmd.server_id is not None and cmd.server_id != channel.server_id:
            raise HTTPException(status_code=404, detail="Command not found")
        app_user = await db.get(User, cmd.application_id)
        if app_user is None or not app_user.is_bot:
            # Never let a command post as a regular (human) account.
            raise HTTPException(status_code=403, detail="Command application is not a bot")
        if channel.server_id:
            await _apply_word_filters(response_content, channel.server_id, current_user.id, db)
        if len(response_content) > 2000:
            raise HTTPException(status_code=400, detail="Message content cannot exceed 2000 characters")

        bot_msg = Message(
            channel_id=channel.id,
            author_id=app_user.id,
            content=response_content,
        )
        db.add(bot_msg)
        await db.commit()
        bot_msg = (
            await db.execute(
                select(Message).options(*_message_load_options()).where(Message.id == bot_msg.id)
            )
        ).scalar_one()

        # Broadcast via WebSocket so clients see it immediately
        msg_read = await enrich_message_read(bot_msg, channel.server_id, db)
        await manager.broadcast_channel(channel.id, {
            "type": "message.created",
            "data": msg_read.model_dump(mode='json')
        })

    return InteractionResponse(
        type=InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE,
        data=InteractionResponseData(
            content=response_content,
            flags=64 if is_ephemeral else None
        ),
    )
