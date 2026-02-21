import os
import re
import uuid
from datetime import datetime, timezone
from typing import List

import aiofiles
from fastapi import APIRouter, HTTPException, UploadFile, File, Query, status
from sqlalchemy import select, delete, or_
from sqlalchemy.orm import selectinload

from app.config import settings
from app.dependencies import CurrentUser, DB
from app.routers.servers import _require_member
from app.schemas.message import MessageCreate, MessageUpdate, MessageRead
from app.ws_manager import manager
from models.channel import Channel, ChannelType
from models.dm_channel import DMChannel
from models.message import Message, Attachment, Reaction, Mention
from models.server import Role, ServerMember
from models.user import User

router = APIRouter(prefix="/channels/{channel_id}", tags=["messages"])

_MENTION_RE = re.compile(r"@(\w+)")


async def _parse_and_save_mentions(
    content: str, message_id: uuid.UUID, server_id: uuid.UUID, db
) -> None:
    """Parse @username and @rolename patterns and insert Mention rows."""
    names = set(_MENTION_RE.findall(content))
    if not names:
        return
    for name in names:
        # Try user mention first (must be a server member)
        user_result = await db.execute(
            select(User)
            .join(ServerMember, ServerMember.user_id == User.id)
            .where(ServerMember.server_id == server_id, User.username == name)
        )
        user = user_result.scalar_one_or_none()
        if user:
            db.add(Mention(message_id=message_id, mentioned_user_id=user.id))
            continue
        # Try role mention
        role_result = await db.execute(
            select(Role).where(Role.server_id == server_id, Role.name == name)
        )
        role = role_result.scalar_one_or_none()
        if role:
            db.add(Mention(message_id=message_id, mentioned_role_id=role.id))


ALLOWED_ATTACHMENT_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "audio/mpeg", "audio/ogg", "audio/wav",
}


async def _get_channel_or_404(channel_id: uuid.UUID, db) -> Channel:
    result = await db.execute(select(Channel).where(Channel.id == channel_id))
    ch = result.scalar_one_or_none()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    return ch


async def _require_channel_access(channel: Channel, user_id: uuid.UUID, db) -> None:
    """Verify user can access the channel (server member or DM participant)."""
    if channel.type == ChannelType.dm:
        result = await db.execute(
            select(DMChannel).where(
                DMChannel.channel_id == channel.id,
                or_(DMChannel.user_a_id == user_id, DMChannel.user_b_id == user_id),
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Not a participant of this DM")
    else:
        await _require_member(channel.server_id, user_id, db)


async def _get_dm_participants(channel_id: uuid.UUID, db) -> tuple[uuid.UUID, uuid.UUID]:
    result = await db.execute(select(DMChannel).where(DMChannel.channel_id == channel_id))
    dmc = result.scalar_one_or_none()
    if not dmc:
        return ()
    return (dmc.user_a_id, dmc.user_b_id)


async def _get_message_or_404(message_id: uuid.UUID, db) -> Message:
    result = await db.execute(
        select(Message)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.reactions),
            selectinload(Message.mentions).selectinload(Mention.mentioned_user),
            selectinload(Message.mentions).selectinload(Mention.mentioned_role),
        )
        .where(Message.id == message_id)
    )
    msg = result.scalar_one_or_none()
    if not msg or msg.is_deleted:
        raise HTTPException(status_code=404, detail="Message not found")
    return msg


# ---- Messages ---------------------------------------------------------------

@router.get("/messages", response_model=List[MessageRead])
async def list_messages(
    channel_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    before: uuid.UUID | None = Query(None, description="Cursor: return messages before this ID"),
    limit: int = Query(50, ge=1, le=100),
):
    channel = await _get_channel_or_404(channel_id, db)
    await _require_channel_access(channel, current_user.id, db)

    query = (
        select(Message)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.reactions),
            selectinload(Message.mentions).selectinload(Mention.mentioned_user),
            selectinload(Message.mentions).selectinload(Mention.mentioned_role),
        )
        .where(Message.channel_id == channel_id, Message.is_deleted == False)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    if before:
        before_msg = await db.execute(select(Message).where(Message.id == before))
        bm = before_msg.scalar_one_or_none()
        if bm:
            query = query.where(Message.created_at < bm.created_at)

    result = await db.execute(query)
    return list(reversed(result.scalars().all()))


@router.post("/messages", response_model=MessageRead, status_code=status.HTTP_201_CREATED)
async def send_message(
    channel_id: uuid.UUID, body: MessageCreate, current_user: CurrentUser, db: DB
):
    channel = await _get_channel_or_404(channel_id, db)
    await _require_channel_access(channel, current_user.id, db)

    msg = Message(
        channel_id=channel_id,
        author_id=current_user.id,
        content=body.content,
        reply_to_id=body.reply_to_id,
    )
    db.add(msg)
    await db.flush()

    if channel.server_id:
        await _parse_and_save_mentions(body.content, msg.id, channel.server_id, db)

    result = await db.execute(
        select(Message)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.reactions),
            selectinload(Message.mentions).selectinload(Mention.mentioned_user),
            selectinload(Message.mentions).selectinload(Mention.mentioned_role),
        )
        .where(Message.id == msg.id)
    )
    await db.commit()
    sent = result.scalar_one()
    event = {"type": "message.created", "data": MessageRead.model_validate(sent).model_dump(mode="json")}
    await manager.broadcast_channel(channel_id, event)
    # For DM channels also push to each participant's personal room
    if channel.type == ChannelType.dm:
        participants = await _get_dm_participants(channel_id, db)
        for uid in participants:
            await manager.broadcast_user(uid, event)
    return sent


@router.patch("/messages/{message_id}", response_model=MessageRead)
async def edit_message(
    channel_id: uuid.UUID, message_id: uuid.UUID, body: MessageUpdate, current_user: CurrentUser, db: DB
):
    msg = await _get_message_or_404(message_id, db)
    if msg.channel_id != channel_id:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot edit another user's message")
    msg.content = body.content
    msg.is_edited = True
    msg.edited_at = datetime.now(timezone.utc)
    # Re-parse mentions: delete old ones then insert new ones
    await db.execute(delete(Mention).where(Mention.message_id == message_id))
    channel = await _get_channel_or_404(channel_id, db)
    if channel.server_id:
        await _parse_and_save_mentions(body.content, message_id, channel.server_id, db)
    await db.commit()
    db.expire_all()
    updated = await _get_message_or_404(message_id, db)
    await manager.broadcast_channel(
        channel_id,
        {"type": "message.updated", "data": MessageRead.model_validate(updated).model_dump(mode="json")},
    )
    return updated


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    channel_id: uuid.UUID, message_id: uuid.UUID, current_user: CurrentUser, db: DB
):
    msg = await _get_message_or_404(message_id, db)
    if msg.channel_id != channel_id:
        raise HTTPException(status_code=404, detail="Message not found")

    channel = await _get_channel_or_404(channel_id, db)

    # Author can delete their own; for server channels admin can delete any
    if msg.author_id != current_user.id:
        if channel.type == ChannelType.dm:
            raise HTTPException(status_code=403, detail="Cannot delete another user's message")
        from app.routers.servers import _require_admin, _get_server_or_404
        server = await _get_server_or_404(channel.server_id, db)
        await _require_admin(server, current_user.id, db)

    msg.is_deleted = True
    msg.content = "[deleted]"
    await db.commit()
    await manager.broadcast_channel(
        channel_id,
        {"type": "message.deleted", "data": {"id": str(message_id), "channel_id": str(channel_id)}},
    )


# ---- Attachments ------------------------------------------------------------

@router.post("/messages/{message_id}/attachments", response_model=MessageRead)
async def upload_attachment(
    channel_id: uuid.UUID,
    message_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    file: UploadFile = File(...),
):
    msg = await _get_message_or_404(message_id, db)
    if msg.channel_id != channel_id or msg.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if file.content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "bin"
    filename = f"attachments/{message_id}/{uuid.uuid4()}.{ext}"
    dest = os.path.join(settings.static_dir, filename)
    os.makedirs(os.path.dirname(dest), exist_ok=True)

    async with aiofiles.open(dest, "wb") as f:
        await f.write(await file.read())

    file_type = file.content_type.split("/")[0]  # "image" or "audio"
    db.add(Attachment(message_id=message_id, file_path=filename, file_type=file_type))
    await db.commit()
    db.expire_all()

    updated = await _get_message_or_404(message_id, db)
    await manager.broadcast_channel(
        channel_id,
        {"type": "message.updated", "data": MessageRead.model_validate(updated).model_dump(mode="json")},
    )
    return updated


# ---- Reactions --------------------------------------------------------------

@router.post("/messages/{message_id}/reactions/{emoji}", status_code=status.HTTP_204_NO_CONTENT)
async def add_reaction(
    channel_id: uuid.UUID, message_id: uuid.UUID, emoji: str, current_user: CurrentUser, db: DB
):
    msg = await _get_message_or_404(message_id, db)
    if msg.channel_id != channel_id:
        raise HTTPException(status_code=404, detail="Message not found")

    existing = await db.execute(
        select(Reaction).where(
            Reaction.message_id == message_id,
            Reaction.user_id == current_user.id,
            Reaction.emoji == emoji,
        )
    )
    if not existing.scalar_one_or_none():
        db.add(Reaction(message_id=message_id, user_id=current_user.id, emoji=emoji))
        await db.commit()
        await manager.broadcast_channel(
            channel_id,
            {"type": "reaction.added", "data": {"message_id": str(message_id), "user_id": str(current_user.id), "emoji": emoji}},
        )


@router.delete("/messages/{message_id}/reactions/{emoji}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_reaction(
    channel_id: uuid.UUID, message_id: uuid.UUID, emoji: str, current_user: CurrentUser, db: DB
):
    result = await db.execute(
        select(Reaction).where(
            Reaction.message_id == message_id,
            Reaction.user_id == current_user.id,
            Reaction.emoji == emoji,
        )
    )
    reaction = result.scalar_one_or_none()
    if reaction:
        await db.delete(reaction)
        await db.commit()
        await manager.broadcast_channel(
            channel_id,
            {"type": "reaction.removed", "data": {"message_id": str(message_id), "user_id": str(current_user.id), "emoji": emoji}},
        )
