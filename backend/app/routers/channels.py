import uuid
from typing import List

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.dependencies import CurrentUser, DB
from app.routers.servers import _get_server_or_404, _require_member, _require_admin
from app.ws_manager import manager
from app.schemas.channel import (
    CategoryCreate,
    CategoryUpdate,
    CategoryRead,
    CategoryReorderItem,
    ChannelCreate,
    ChannelUpdate,
    ChannelRead,
    ChannelReorderItem,
    ChannelPermissionRead,
    ChannelPermissionSet,
)
from models.channel import Category, Channel, ChannelPermission, MutedChannel
from models.server import Role

router = APIRouter(prefix="/servers/{server_id}", tags=["channels"])


# ---- Categories -------------------------------------------------------------

@router.get("/categories", response_model=List[CategoryRead])
async def list_categories(server_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await _require_member(server_id, current_user.id, db)
    result = await db.execute(
        select(Category).where(Category.server_id == server_id).order_by(Category.position)
    )
    return result.scalars().all()


@router.post("/categories", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
async def create_category(
    server_id: uuid.UUID, body: CategoryCreate, current_user: CurrentUser, db: DB
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    category = Category(server_id=server_id, title=body.title, position=body.position)
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


@router.put("/categories/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_categories(
    server_id: uuid.UUID,
    body: List[CategoryReorderItem],
    current_user: CurrentUser,
    db: DB,
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    for item in body:
        result = await db.execute(
            select(Category).where(Category.id == item.id, Category.server_id == server_id)
        )
        cat = result.scalar_one_or_none()
        if cat:
            cat.position = item.position
    await db.commit()
    result = await db.execute(
        select(Category).where(Category.server_id == server_id).order_by(Category.position)
    )
    updated_cats = result.scalars().all()
    await manager.broadcast_server(
        server_id,
        {"type": "categories.reordered", "data": [CategoryRead.model_validate(c).model_dump(mode="json") for c in updated_cats]},
    )


@router.patch("/categories/{category_id}", response_model=CategoryRead)
async def update_category(
    server_id: uuid.UUID,
    category_id: uuid.UUID,
    body: CategoryUpdate,
    current_user: CurrentUser,
    db: DB,
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    result = await db.execute(
        select(Category).where(Category.id == category_id, Category.server_id == server_id)
    )
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if body.title is not None:
        cat.title = body.title
    if body.position is not None:
        cat.position = body.position
    await db.commit()
    await db.refresh(cat)
    return cat


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    server_id: uuid.UUID, category_id: uuid.UUID, current_user: CurrentUser, db: DB
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    result = await db.execute(
        select(Category).where(Category.id == category_id, Category.server_id == server_id)
    )
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    await db.delete(cat)
    await db.commit()


# ---- Channels ---------------------------------------------------------------

@router.get("/channels", response_model=List[ChannelRead])
async def list_channels(server_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await _require_member(server_id, current_user.id, db)
    result = await db.execute(
        select(Channel).where(Channel.server_id == server_id).order_by(Channel.position)
    )
    return result.scalars().all()


@router.post("/channels", response_model=ChannelRead, status_code=status.HTTP_201_CREATED)
async def create_channel(
    server_id: uuid.UUID, body: ChannelCreate, current_user: CurrentUser, db: DB
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    channel = Channel(
        server_id=server_id,
        title=body.title,
        description=body.description,
        type=body.type,
        position=body.position,
        category_id=body.category_id,
    )
    db.add(channel)
    await db.commit()
    await db.refresh(channel)
    await manager.broadcast_server(
        server_id,
        {"type": "channel.created", "data": ChannelRead.model_validate(channel).model_dump(mode="json")},
    )
    return channel


@router.put("/channels/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_channels(
    server_id: uuid.UUID,
    body: List[ChannelReorderItem],
    current_user: CurrentUser,
    db: DB,
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    for item in body:
        result = await db.execute(
            select(Channel).where(Channel.id == item.id, Channel.server_id == server_id)
        )
        ch = result.scalar_one_or_none()
        if ch:
            ch.position = item.position
            ch.category_id = item.category_id
    await db.commit()
    result = await db.execute(
        select(Channel).where(Channel.server_id == server_id).order_by(Channel.position)
    )
    updated_channels = result.scalars().all()
    await manager.broadcast_server(
        server_id,
        {"type": "channels.reordered", "data": [ChannelRead.model_validate(c).model_dump(mode="json") for c in updated_channels]},
    )


@router.patch("/channels/{channel_id}", response_model=ChannelRead)
async def update_channel(
    server_id: uuid.UUID,
    channel_id: uuid.UUID,
    body: ChannelUpdate,
    current_user: CurrentUser,
    db: DB,
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    result = await db.execute(
        select(Channel).where(Channel.id == channel_id, Channel.server_id == server_id)
    )
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    if body.title is not None:
        channel.title = body.title
    if body.description is not None:
        channel.description = body.description
    if body.position is not None:
        channel.position = body.position
    if body.category_id is not None:
        channel.category_id = body.category_id
    if body.slowmode_delay is not None:
        channel.slowmode_delay = max(0, body.slowmode_delay)
    await db.commit()
    await db.refresh(channel)
    return channel


@router.delete("/channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(
    server_id: uuid.UUID, channel_id: uuid.UUID, current_user: CurrentUser, db: DB
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)
    result = await db.execute(
        select(Channel).where(Channel.id == channel_id, Channel.server_id == server_id)
    )
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    await db.delete(channel)
    await db.commit()


# ---- Channel Permissions ----------------------------------------------------

@router.get("/channels/{channel_id}/permissions", response_model=List[ChannelPermissionRead])
async def list_permissions(
    server_id: uuid.UUID, channel_id: uuid.UUID, current_user: CurrentUser, db: DB
):
    await _require_member(server_id, current_user.id, db)
    result = await db.execute(
        select(ChannelPermission).where(ChannelPermission.channel_id == channel_id)
    )
    return result.scalars().all()


@router.put("/channels/{channel_id}/permissions/{role_id}", response_model=ChannelPermissionRead)
async def set_permission(
    server_id: uuid.UUID,
    channel_id: uuid.UUID,
    role_id: uuid.UUID,
    body: ChannelPermissionSet,
    current_user: CurrentUser,
    db: DB,
):
    server = await _get_server_or_404(server_id, db)
    await _require_admin(server, current_user.id, db)

    result = await db.execute(select(Role).where(Role.id == role_id, Role.server_id == server_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Role not found")

    result = await db.execute(
        select(ChannelPermission).where(
            ChannelPermission.channel_id == channel_id, ChannelPermission.role_id == role_id
        )
    )
    perm = result.scalar_one_or_none()
    if perm:
        perm.can_read = body.can_read
        perm.can_write = body.can_write
        perm.can_edit = body.can_edit
    else:
        perm = ChannelPermission(
            channel_id=channel_id,
            role_id=role_id,
            can_read=body.can_read,
            can_write=body.can_write,
            can_edit=body.can_edit,
        )
        db.add(perm)
    await db.commit()
    await db.refresh(perm)
    return perm


# ---- Mute / Unmute ----------------------------------------------------------

@router.post("/channels/{channel_id}/mute", status_code=status.HTTP_204_NO_CONTENT)
async def mute_channel(
    server_id: uuid.UUID, channel_id: uuid.UUID, current_user: CurrentUser, db: DB
):
    await _require_member(server_id, current_user.id, db)
    existing = await db.execute(
        select(MutedChannel).where(
            MutedChannel.user_id == current_user.id, MutedChannel.channel_id == channel_id
        )
    )
    if not existing.scalar_one_or_none():
        db.add(MutedChannel(user_id=current_user.id, channel_id=channel_id))
        await db.commit()


@router.delete("/channels/{channel_id}/mute", status_code=status.HTTP_204_NO_CONTENT)
async def unmute_channel(
    server_id: uuid.UUID, channel_id: uuid.UUID, current_user: CurrentUser, db: DB
):
    result = await db.execute(
        select(MutedChannel).where(
            MutedChannel.user_id == current_user.id, MutedChannel.channel_id == channel_id
        )
    )
    muted = result.scalar_one_or_none()
    if muted:
        await db.delete(muted)
        await db.commit()
