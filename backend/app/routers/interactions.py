import uuid
from typing import List

from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy import select, delete

from app.dependencies import CurrentUser, DB
from app.routers.messages import enrich_message_read
from app.ws_manager import manager
from models.message import Message
from app.schemas.interaction import (
    ApplicationCommandCreate,
    ApplicationCommandRead,
    InteractionCreate,
    InteractionData,
    InteractionDataOption,
    InteractionResponse,
    InteractionResponseData,
    InteractionCallbackType,
)
from models.interaction import ApplicationCommand, ApplicationCommandType
from models.server import Server, ServerMember
from models.user import User

router = APIRouter(tags=["interactions"])


# ---- Command Registration ---------------------------------------------------

@router.post("/applications/{application_id}/commands", response_model=ApplicationCommandRead)
async def create_global_command(
    application_id: uuid.UUID,
    body: ApplicationCommandCreate,
    current_user: CurrentUser,
    db: DB,
):
    """Register a new global slash command for an application (bot)."""
    # Verify ownership of the application (bot user)
    app = await db.get(User, application_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    # For now, allow regular users to own commands too for testing/demos
    # if not app.is_bot:
    #     raise HTTPException(status_code=400, detail="User is not a bot")
    
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
    db: DB,
):
    result = await db.execute(
        select(ApplicationCommand).where(ApplicationCommand.application_id == application_id)
    )
    return result.scalars().all()

# ---- Command Discovery ------------------------------------------------------

@router.get("/commands", response_model=List[ApplicationCommandRead])
async def list_commands(
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
        bot_msg = Message(
            channel_id=interaction.channel_id,
            author_id=cmd.application_id,
            content=response_content,
        )
        db.add(bot_msg)
        await db.commit()
        await db.refresh(bot_msg)
        
        # Broadcast via WebSocket so clients see it immediately
        msg_read = await enrich_message_read(bot_msg, interaction.server_id, db)
        await manager.broadcast_channel(interaction.channel_id, {
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
