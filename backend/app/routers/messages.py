import os
import re
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import List, Dict

import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from sqlalchemy import select, delete, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.config import settings
from app.dependencies import CurrentUser, DB
from app.rate_limiter import rate_limit_messages
from app.routers.servers import _require_member
from app.schemas.message import MessageCreate, MessageUpdate, MessageRead, PinnedMessageRead
from app.utils.file_validation import verify_attachment_magic
from app.ws_manager import manager
from models.channel import Channel, ChannelType
from models.dm_channel import DMChannel
from models.message import Message, Attachment, Reaction, Mention
from models.pinned_message import PinnedMessage
from models.server import Role, ServerMember
from models.user import User

router = APIRouter(prefix="/channels/{channel_id}", tags=["messages"])

_MENTION_RE = re.compile(r"@(\w+)")

# Per-channel per-user slowmode tracker: channel_id_str -> user_id_str -> last_send_time
_slowmode_last: Dict[str, Dict[str, float]] = defaultdict(dict)


async def _enrich_message_read(msg: Message, server_id: 'uuid.UUID | None', db) -> MessageRead:
    """Return a MessageRead with author_nickname populated when msg is in a server channel."""
    read = MessageRead.model_validate(msg)
    if server_id:
        result = await db.execute(
            select(ServerMember.nickname).where(
                ServerMember.server_id == server_id,
                ServerMember.user_id == msg.author_id,
                ServerMember.nickname.isnot(None),
            )
        )
        nick = result.scalar_one_or_none()
        if nick:
            read = read.model_copy(update={"author_nickname": nick})
    return read


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


def _message_load_options():
    """Standard eager-load options for a fully hydrated Message."""
    return [
        selectinload(Message.author),
        selectinload(Message.attachments),
        selectinload(Message.reactions),
        selectinload(Message.mentions).selectinload(Mention.mentioned_user),
        selectinload(Message.mentions).selectinload(Mention.mentioned_role),
        selectinload(Message.reply_to).selectinload(Message.author),
    ]


async def _get_message_or_404(message_id: uuid.UUID, db) -> Message:
    result = await db.execute(
        select(Message)
        .options(*_message_load_options())
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
        .options(*_message_load_options())
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
    messages = list(reversed(result.scalars().all()))

    # Bulk-load server nicknames for all message authors in one query
    nick_map: dict[uuid.UUID, str] = {}
    if channel.server_id and messages:
        author_ids = list({m.author_id for m in messages})
        nick_rows = await db.execute(
            select(ServerMember.user_id, ServerMember.nickname).where(
                ServerMember.server_id == channel.server_id,
                ServerMember.user_id.in_(author_ids),
                ServerMember.nickname.isnot(None),
            )
        )
        nick_map = {row[0]: row[1] for row in nick_rows.all()}

    return [
        MessageRead.model_validate(m).model_copy(update={"author_nickname": nick_map.get(m.author_id)})
        for m in messages
    ]


@router.post("/messages", response_model=MessageRead, status_code=status.HTTP_201_CREATED)
async def send_message(
    channel_id: uuid.UUID,
    body: MessageCreate,
    current_user: CurrentUser,
    db: DB,
    _rl: None = Depends(rate_limit_messages),
):
    channel = await _get_channel_or_404(channel_id, db)
    await _require_channel_access(channel, current_user.id, db)

    # Enforce per-channel slowmode (skip for voice/dm channels which have no slowmode)
    if getattr(channel, 'slowmode_delay', 0) and channel.slowmode_delay > 0:
        ch_key = str(channel_id)
        user_key = str(current_user.id)
        now = time.monotonic()
        last = _slowmode_last[ch_key].get(user_key, 0.0)
        elapsed = now - last
        if elapsed < channel.slowmode_delay:
            retry_after = max(1, int(channel.slowmode_delay - elapsed) + 1)
            raise HTTPException(
                status_code=429,
                detail=f"Slowmode is enabled. Please wait {retry_after} second(s) before sending another message.",
                headers={"Retry-After": str(retry_after)},
            )
        _slowmode_last[ch_key][user_key] = now

    msg = Message(
        channel_id=channel_id,
        author_id=current_user.id,
        content=body.content,
        reply_to_id=body.reply_to_id,
    )
    db.add(msg)
    await db.flush()

    if channel.server_id:
        await _parse_and_save_mentions(body.content or '', msg.id, channel.server_id, db)

    result = await db.execute(
        select(Message)
        .options(*_message_load_options())
        .where(Message.id == msg.id)
    )
    await db.commit()
    sent = result.scalar_one()
    msg_read = await _enrich_message_read(sent, channel.server_id, db)
    event = {"type": "message.created", "data": msg_read.model_dump(mode="json")}
    await manager.broadcast_channel(channel_id, event)
    # Notify server members about new activity in this channel (for unread indicators)
    if channel.server_id:
        notify_event = {"type": "channel.message", "data": {"channel_id": str(channel_id), "server_id": str(channel.server_id)}}
        await manager.broadcast_server(channel.server_id, notify_event)
        # Also push to each member's personal /ws/me room so they get notified
        # regardless of which server they're currently viewing.
        member_rows = await db.execute(
            select(ServerMember.user_id).where(
                ServerMember.server_id == channel.server_id,
                ServerMember.user_id != current_user.id,
            )
        )
        for uid in member_rows.scalars().all():
            await manager.broadcast_user(uid, notify_event)
    # For DM channels also push to each participant's personal room
    if channel.type == ChannelType.dm:
        participants = await _get_dm_participants(channel_id, db)
        for uid in participants:
            await manager.broadcast_user(uid, event)
    return msg_read


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
    server_id = channel.server_id  # capture before expire_all() clears it
    if server_id:
        await _parse_and_save_mentions(body.content, message_id, server_id, db)
    await db.commit()
    db.expire_all()
    updated = await _get_message_or_404(message_id, db)
    msg_read = await _enrich_message_read(updated, server_id, db)
    await manager.broadcast_channel(
        channel_id,
        {"type": "message.updated", "data": msg_read.model_dump(mode="json")},
    )
    return msg_read


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
        {"type": "message.deleted", "data": {"message_id": str(message_id), "channel_id": str(channel_id)}},
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

    channel = await _get_channel_or_404(channel_id, db)

    # Capture original filename before reading (sanitise path separators)
    original_name: str | None = None
    if file.filename:
        original_name = file.filename.replace('\\', '/').split('/')[-1] or None

    # Validate magic bytes (ignores spoofed Content-Type headers)
    content = await verify_attachment_magic(file)

    import filetype as _ft
    import io as _io
    kind = _ft.guess(content)
    file_type = kind.mime.split("/")[0] if kind else "image"  # "image" or "audio"
    file_size = len(content)

    # Extract pixel dimensions for image attachments
    img_width: int | None = None
    img_height: int | None = None
    if file_type == "image":
        try:
            from PIL import Image as _Image
            with _Image.open(_io.BytesIO(content)) as _img:
                img_width, img_height = _img.size
        except Exception:
            pass

    ext = (original_name.rsplit(".", 1)[-1] if original_name and "." in original_name else None) or (kind.extension if kind else "bin")
    storage_path = f"attachments/{message_id}/{uuid.uuid4()}.{ext}"
    dest = os.path.join(settings.static_dir, storage_path)
    os.makedirs(os.path.dirname(dest), exist_ok=True)

    async with aiofiles.open(dest, "wb") as f:
        await f.write(content)

    db.add(Attachment(
        message_id=message_id,
        file_path=storage_path,
        file_type=file_type,
        filename=original_name,
        file_size=file_size,
        width=img_width,
        height=img_height,
    ))
    server_id = channel.server_id  # capture before expire_all() clears it
    await db.commit()
    db.expire_all()

    updated = await _get_message_or_404(message_id, db)
    upload_read = await _enrich_message_read(updated, server_id, db)
    await manager.broadcast_channel(
        channel_id,
        {"type": "message.updated", "data": upload_read.model_dump(mode="json")},
    )
    return upload_read


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
        try:
            db.add(Reaction(message_id=message_id, user_id=current_user.id, emoji=emoji))
            await db.commit()
        except IntegrityError:
            # Race condition: another request inserted the same reaction between
            # our SELECT check and this INSERT. The DB constraint caught it — ignore.
            await db.rollback()
            return
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


# ---- Pinned Messages --------------------------------------------------------

@router.get("/pins", response_model=List[PinnedMessageRead])
async def list_pins(
    channel_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    channel = await _get_channel_or_404(channel_id, db)
    await _require_channel_access(channel, current_user.id, db)

    result = await db.execute(
        select(PinnedMessage)
        .options(
            selectinload(PinnedMessage.pinned_by),
            selectinload(PinnedMessage.message)
            .selectinload(Message.author),
            selectinload(PinnedMessage.message)
            .selectinload(Message.attachments),
            selectinload(PinnedMessage.message)
            .selectinload(Message.reactions),
            selectinload(PinnedMessage.message)
            .selectinload(Message.mentions),
        )
        .where(PinnedMessage.channel_id == channel_id)
        .order_by(PinnedMessage.pinned_at.desc())
    )
    return result.scalars().all()


@router.put("/messages/{message_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
async def pin_message(
    channel_id: uuid.UUID,
    message_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    channel = await _get_channel_or_404(channel_id, db)
    await _require_channel_access(channel, current_user.id, db)
    msg = await _get_message_or_404(message_id, db)
    if msg.channel_id != channel_id:
        raise HTTPException(status_code=404, detail="Message not found")

    # Check if already pinned
    existing = await db.execute(
        select(PinnedMessage).where(
            PinnedMessage.channel_id == channel_id,
            PinnedMessage.message_id == message_id,
        )
    )
    if existing.scalar_one_or_none():
        return  # Already pinned — idempotent

    db.add(PinnedMessage(
        channel_id=channel_id,
        message_id=message_id,
        pinned_by_id=current_user.id,
    ))
    await db.commit()
    await manager.broadcast_channel(
        channel_id,
        {"type": "message.pinned", "data": {"message_id": str(message_id), "channel_id": str(channel_id)}},
    )


@router.delete("/messages/{message_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
async def unpin_message(
    channel_id: uuid.UUID,
    message_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    channel = await _get_channel_or_404(channel_id, db)
    await _require_channel_access(channel, current_user.id, db)

    result = await db.execute(
        select(PinnedMessage).where(
            PinnedMessage.channel_id == channel_id,
            PinnedMessage.message_id == message_id,
        )
    )
    pin = result.scalar_one_or_none()
    if pin:
        await db.delete(pin)
        await db.commit()
        await manager.broadcast_channel(
            channel_id,
            {"type": "message.unpinned", "data": {"message_id": str(message_id), "channel_id": str(channel_id)}},
        )

