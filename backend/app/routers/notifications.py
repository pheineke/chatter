import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.dependencies import CurrentUser, DB
from models.notification import (
    UserChannelNotificationSettings,
    UserServerNotificationSettings,
    NotificationLevel,
)

router = APIRouter(prefix="/me/notification-settings", tags=["notifications"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class NotificationSettingsResponse(BaseModel):
    channels: dict[str, str]
    servers: dict[str, str]


class SetLevelBody(BaseModel):
    level: NotificationLevel


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("", response_model=NotificationSettingsResponse)
async def get_notification_settings(current_user: CurrentUser, db: DB):
    """Return all non-default notification settings for the current user."""
    ch_rows = await db.execute(
        select(UserChannelNotificationSettings).where(
            UserChannelNotificationSettings.user_id == current_user.id
        )
    )
    sv_rows = await db.execute(
        select(UserServerNotificationSettings).where(
            UserServerNotificationSettings.user_id == current_user.id
        )
    )
    channels = {str(r.channel_id): r.level for r in ch_rows.scalars()}
    servers = {str(r.server_id): r.level for r in sv_rows.scalars()}
    return NotificationSettingsResponse(channels=channels, servers=servers)


@router.put("/channels/{channel_id}", status_code=204)
async def set_channel_notification(
    channel_id: uuid.UUID,
    body: SetLevelBody,
    current_user: CurrentUser,
    db: DB,
):
    result = await db.execute(
        select(UserChannelNotificationSettings).where(
            UserChannelNotificationSettings.user_id == current_user.id,
            UserChannelNotificationSettings.channel_id == channel_id,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        row.level = body.level.value
    else:
        db.add(UserChannelNotificationSettings(
            user_id=current_user.id,
            channel_id=channel_id,
            level=body.level.value,
        ))
    await db.commit()


@router.put("/servers/{server_id}", status_code=204)
async def set_server_notification(
    server_id: uuid.UUID,
    body: SetLevelBody,
    current_user: CurrentUser,
    db: DB,
):
    result = await db.execute(
        select(UserServerNotificationSettings).where(
            UserServerNotificationSettings.user_id == current_user.id,
            UserServerNotificationSettings.server_id == server_id,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        row.level = body.level.value
    else:
        db.add(UserServerNotificationSettings(
            user_id=current_user.id,
            server_id=server_id,
            level=body.level.value,
        ))
    await db.commit()
