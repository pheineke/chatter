"""Channel permission resolution.

Effective permissions for a user in a server channel (Discord order):

  1. Not a server member              → 0 (no access at all)
  2. Server owner or any admin role   → ALL_PERMS
  3. Otherwise:
       perms = BASE_PERMS                                   (everything but privileged bits)
       perms = (perms & ~everyone.deny) | everyone.allow    (@everyone overwrite)
       perms = (perms & ~roles.deny)    | roles.allow       (OR of the member's role overwrites)

     So a role overwrite always beats the @everyone overwrite, and among the
     member's own roles an allow beats a deny. Private channel = deny
     VIEW_CHANNEL on @everyone + allow it on the roles that should see it.

Every member implicitly holds the server's @everyone role (Role.is_default);
there are no user_roles rows for it.

DM channels have no overwrites: participants get DM_PERMS, everyone else 0.

Privileged bits (MANAGE_MESSAGES, MANAGE_ROLES) are never part of the base
set. They can only come from an admin role or an explicit channel allow.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from fastapi import HTTPException
from sqlalchemy import or_, select

from models.channel import Channel, ChannelPerm, ChannelPermission, ChannelType
from models.dm_channel import DMChannel
from models.server import Role, Server, ServerMember, UserRole

ALL_PERMS = (
    ChannelPerm.VIEW_CHANNEL
    | ChannelPerm.SEND_MESSAGES
    | ChannelPerm.MANAGE_MESSAGES
    | ChannelPerm.ATTACH_FILES
    | ChannelPerm.EMBED_LINKS
    | ChannelPerm.ADD_REACTIONS
    | ChannelPerm.MENTION_EVERYONE
    | ChannelPerm.USE_EXTERNAL_EMOJIS
    | ChannelPerm.MANAGE_ROLES
)
PRIVILEGED_PERMS = ChannelPerm.MANAGE_MESSAGES | ChannelPerm.MANAGE_ROLES
BASE_PERMS = ALL_PERMS & ~PRIVILEGED_PERMS
DM_PERMS = BASE_PERMS

_PERM_NAMES = {
    ChannelPerm.VIEW_CHANNEL: "View Channel",
    ChannelPerm.SEND_MESSAGES: "Send Messages",
    ChannelPerm.MANAGE_MESSAGES: "Manage Messages",
    ChannelPerm.ATTACH_FILES: "Attach Files",
    ChannelPerm.EMBED_LINKS: "Embed Links",
    ChannelPerm.ADD_REACTIONS: "Add Reactions",
    ChannelPerm.MENTION_EVERYONE: "Mention Everyone",
    ChannelPerm.USE_EXTERNAL_EMOJIS: "Use External Emojis",
    ChannelPerm.MANAGE_ROLES: "Manage Roles",
}

Overwrite = tuple[int, int]  # (allow_bits, deny_bits)


def resolve_perms(everyone: Overwrite | None, roles: list[Overwrite]) -> int:
    """Apply the @everyone overwrite, then the member's role overwrites, to BASE_PERMS."""
    perms = BASE_PERMS
    if everyone is not None:
        allow, deny = everyone
        perms = (perms & ~(deny or 0)) | (allow or 0)
    allowed = 0
    denied = 0
    for allow, deny in roles:
        allowed |= allow or 0
        denied |= deny or 0
    return ((perms & ~denied) | allowed) & ALL_PERMS


@dataclass
class _ServerContext:
    """Per-(server, user) facts needed to resolve permissions for any channel."""

    is_member: bool
    is_privileged: bool = False
    everyone_role_id: uuid.UUID | None = None
    role_ids: list[uuid.UUID] = field(default_factory=list)  # excludes @everyone


async def _everyone_role_id(server_id: uuid.UUID, db) -> uuid.UUID | None:
    row = await db.execute(
        select(Role.id).where(Role.server_id == server_id, Role.is_default.is_(True))
    )
    return row.scalar_one_or_none()


async def _server_context(server_id: uuid.UUID, user_id: uuid.UUID, db) -> _ServerContext:
    member = await db.execute(
        select(ServerMember.user_id).where(
            ServerMember.server_id == server_id, ServerMember.user_id == user_id
        )
    )
    if member.scalar_one_or_none() is None:
        return _ServerContext(is_member=False)

    owner = await db.execute(select(Server.owner_id).where(Server.id == server_id))
    if owner.scalar_one_or_none() == user_id:
        return _ServerContext(is_member=True, is_privileged=True)

    rows = await db.execute(
        select(Role.id, Role.is_admin)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(
            Role.server_id == server_id,
            UserRole.user_id == user_id,
            Role.is_default.is_(False),
        )
    )
    roles = rows.all()
    if any(is_admin for _, is_admin in roles):
        return _ServerContext(is_member=True, is_privileged=True)
    return _ServerContext(
        is_member=True,
        everyone_role_id=await _everyone_role_id(server_id, db),
        role_ids=[rid for rid, _ in roles],
    )


async def _overwrites_by_channel(
    channel_ids: list[uuid.UUID], role_ids: list[uuid.UUID], db
) -> dict[uuid.UUID, dict[uuid.UUID, Overwrite]]:
    """{channel_id: {role_id: (allow, deny)}} for the given channels and roles."""
    if not channel_ids or not role_ids:
        return {}
    rows = await db.execute(
        select(
            ChannelPermission.channel_id,
            ChannelPermission.role_id,
            ChannelPermission.allow_bits,
            ChannelPermission.deny_bits,
        ).where(
            ChannelPermission.channel_id.in_(channel_ids),
            ChannelPermission.role_id.in_(role_ids),
        )
    )
    out: dict[uuid.UUID, dict[uuid.UUID, Overwrite]] = {}
    for cid, rid, a, d in rows.all():
        out.setdefault(cid, {})[rid] = (a, d)
    return out


def _perms_from_context(ctx: _ServerContext, overwrites: dict[uuid.UUID, Overwrite]) -> int:
    if not ctx.is_member:
        return 0
    if ctx.is_privileged:
        return ALL_PERMS
    everyone = overwrites.get(ctx.everyone_role_id) if ctx.everyone_role_id else None
    return resolve_perms(everyone, [overwrites[r] for r in ctx.role_ids if r in overwrites])


async def get_channel_permissions(channel: Channel, user_id: uuid.UUID, db) -> int:
    """Return the effective permission bitfield of *user_id* in *channel*."""
    if channel.server_id is None:
        if channel.type != ChannelType.dm:
            return 0
        row = await db.execute(
            select(DMChannel.channel_id).where(
                DMChannel.channel_id == channel.id,
                or_(DMChannel.user_a_id == user_id, DMChannel.user_b_id == user_id),
            )
        )
        return DM_PERMS if row.scalar_one_or_none() is not None else 0

    ctx = await _server_context(channel.server_id, user_id, db)
    if not ctx.is_member or ctx.is_privileged:
        return _perms_from_context(ctx, {})
    relevant = ctx.role_ids + ([ctx.everyone_role_id] if ctx.everyone_role_id else [])
    overwrites = (await _overwrites_by_channel([channel.id], relevant, db)).get(channel.id, {})
    return _perms_from_context(ctx, overwrites)


async def visible_channel_ids(
    server_id: uuid.UUID, channel_ids: list[uuid.UUID], user_id: uuid.UUID, db
) -> set[uuid.UUID]:
    """Return the subset of *channel_ids* (all in *server_id*) the user can view.

    Constant number of queries regardless of the number of channels.
    """
    ctx = await _server_context(server_id, user_id, db)
    if not ctx.is_member:
        return set()
    if ctx.is_privileged:
        return set(channel_ids)
    relevant = ctx.role_ids + ([ctx.everyone_role_id] if ctx.everyone_role_id else [])
    by_channel = await _overwrites_by_channel(channel_ids, relevant, db)
    return {
        cid
        for cid in channel_ids
        if _perms_from_context(ctx, by_channel.get(cid, {})) & ChannelPerm.VIEW_CHANNEL
    }


async def require_channel_perms(channel: Channel, user_id: uuid.UUID, db, *perms: int) -> int:
    """Raise 403 unless the user can view *channel* and holds every bit in *perms*.

    VIEW_CHANNEL is always required. Returns the effective bitfield so callers
    can make further decisions (e.g. MANAGE_MESSAGES for deleting others' posts).
    """
    effective = await get_channel_permissions(channel, user_id, db)
    if channel.server_id is None and not effective:
        raise HTTPException(status_code=403, detail="Not a participant of this DM")
    if channel.server_id is not None and not effective:
        raise HTTPException(status_code=403, detail="Not a member of this server")
    if not effective & ChannelPerm.VIEW_CHANNEL:
        raise HTTPException(status_code=403, detail="Missing permission: View Channel")
    for perm in perms:
        if not effective & perm:
            raise HTTPException(
                status_code=403,
                detail=f"Missing permission: {_PERM_NAMES.get(perm, 'Unknown')}",
            )
    return effective


async def channel_viewer_ids(channel: Channel, db) -> list[uuid.UUID]:
    """All users who can view *channel* (DM: both participants).

    Constant number of queries regardless of server size.
    """
    if channel.server_id is None:
        row = await db.execute(select(DMChannel).where(DMChannel.channel_id == channel.id))
        dmc = row.scalar_one_or_none()
        return [dmc.user_a_id, dmc.user_b_id] if dmc else []

    members = (
        await db.execute(
            select(ServerMember.user_id).where(ServerMember.server_id == channel.server_id)
        )
    ).scalars().all()
    overwrites: dict[uuid.UUID, Overwrite] = {
        rid: (a, d)
        for rid, a, d in (
            await db.execute(
                select(
                    ChannelPermission.role_id,
                    ChannelPermission.allow_bits,
                    ChannelPermission.deny_bits,
                ).where(ChannelPermission.channel_id == channel.id)
            )
        ).all()
    }
    if not overwrites:
        return list(members)

    owner_id = (
        await db.execute(select(Server.owner_id).where(Server.id == channel.server_id))
    ).scalar_one_or_none()
    everyone_id = await _everyone_role_id(channel.server_id, db)
    user_roles: dict[uuid.UUID, list[tuple[uuid.UUID, bool]]] = {}
    for uid, rid, is_admin in (
        await db.execute(
            select(UserRole.user_id, Role.id, Role.is_admin)
            .join(Role, UserRole.role_id == Role.id)
            .where(Role.server_id == channel.server_id, Role.is_default.is_(False))
        )
    ).all():
        user_roles.setdefault(uid, []).append((rid, is_admin))

    viewers = []
    for uid in members:
        roles = user_roles.get(uid, [])
        ctx = _ServerContext(
            is_member=True,
            is_privileged=uid == owner_id or any(is_admin for _, is_admin in roles),
            everyone_role_id=everyone_id,
            role_ids=[rid for rid, _ in roles],
        )
        if _perms_from_context(ctx, overwrites) & ChannelPerm.VIEW_CHANNEL:
            viewers.append(uid)
    return viewers
