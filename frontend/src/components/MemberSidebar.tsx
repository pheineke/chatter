import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMembers, getRoles, getServer, kickMember, banMember } from '../api/servers'
import { getDMChannel } from '../api/dms'
import { getBlocks, blockUser, unblockUser } from '../api/blocks'
import { AvatarWithStatus } from './AvatarWithStatus'
import { ProfileCard } from './ProfileCard'
import { ContextMenu } from './ContextMenu'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { Member, Role, Server } from '../api/types'

interface Props {
  serverId: string
}

export function MemberSidebar({ serverId }: Props) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', serverId],
    queryFn: () => getMembers(serverId),
  })

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ['roles', serverId],
    queryFn: () => getRoles(serverId),
  })

  // We need server info to check ownership for permissions
  const { data: server } = useQuery<Server>({
    queryKey: ['server', serverId],
    queryFn: () => getServer(serverId),
    enabled: !!serverId
  })

  const { data: blocks = [] } = useQuery({
    queryKey: ['blocks'],
    queryFn: getBlocks,
  })

  const [activeProfile, setActiveProfile] = useState<{ userId: string; position: { x: number; y: number } } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, member: Member } | null>(null)

  function handleClick(member: Member, e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setActiveProfile({ userId: member.user.id, position: { x: rect.left - 328, y: rect.top } })
  }

  function handleContextMenu(member: Member, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.pageX, y: e.pageY, member })
  }

  // Split online / offline
  const online  = members.filter(m => m.user.status !== 'offline')
  const offline = members.filter(m => m.user.status === 'offline')

  // Build hoisted-role groups for online members
  const hoistedRoles = [...roles]
    .filter(r => r.hoist)
    .sort((a, b) => b.position - a.position)

  const roleMap = Object.fromEntries(roles.map(r => [r.id, r]))

  function topHoistedRole(m: Member): Role | null {
    if (!m.roles.length) return null
    const hoisted = m.roles
      .map(r => roleMap[r.id])
      .filter((r): r is Role => !!r && r.hoist)
    if (!hoisted.length) return null
    return hoisted.reduce((best, r) => r.position > best.position ? r : best)
  }

  // Group online members by their top hoisted role
  const grouped: { role: Role | null; members: Member[] }[] = []
  const seenInGroup = new Set<string>()

  for (const role of hoistedRoles) {
    const group = online
      .filter(m => {
        const top = topHoistedRole(m)
        return top?.id === role.id
      })
      .sort((a, b) => a.user.username.localeCompare(b.user.username))
    if (group.length) {
      grouped.push({ role, members: group })
      group.forEach(m => seenInGroup.add(m.user.id))
    }
  }

  // Remaining online members with no hoisted role
  const ungroupedOnline = online
    .filter(m => !seenInGroup.has(m.user.id))
    .sort((a, b) => a.user.username.localeCompare(b.user.username))
  if (ungroupedOnline.length) {
    grouped.push({ role: null, members: ungroupedOnline })
  }

  const offlineSorted = [...offline].sort((a, b) => a.user.username.localeCompare(b.user.username))

  // Permissions check logic
  const myMember = members.find(m => m.user.id === user?.id)
  const isOwner = server?.owner_id === user?.id
  const isAdmin = myMember?.roles.some(r => r.is_admin) || isOwner
  
  // Helper to determine if we can manage a target member
  function canManage(target: Member) {
    if (!isAdmin) return false
    if (target.user.id === server?.owner_id) return false // Can't manage owner
    if (target.user.id === user?.id) return false // Can't kick/ban self via this menu
    
    // Server owner can manage anyone (except self)
    if (isOwner) return true

    // Compare role hierarchy
    // Find my highest role position
    const myHighestRole = myMember?.roles.reduce((max, r) => Math.max(max, r.position), -1) ?? -1
    // Find target highest role position
    const targetHighestRole = target.roles.reduce((max, r) => Math.max(max, r.position), -1) ?? -1
    
    return myHighestRole > targetHighestRole
  }

  return (
    <div className="hidden md:flex flex-col w-60 shrink-0 bg-sp-bg h-full overflow-y-auto border-l border-sp-divider/50">
      <div className="px-3 flex items-center h-12 shrink-0 border-b border-sp-divider/50 shadow-sm">
        <span className="text-xs font-bold uppercase text-sp-muted tracking-wider">
          Members — {members.length}
        </span>
      </div>

      {grouped.map(({ role, members: grpMembers }) => (
        <Section
          key={role?.id ?? '__online__'}
          label={role?.name ?? 'Online'}
          color={role?.color ?? undefined}
          members={grpMembers}
          onClickMember={handleClick}
          onContextMenu={handleContextMenu}
        />
      ))}

      {offlineSorted.length > 0 && (
        <Section
          label="Offline"
          members={offlineSorted}
          onClickMember={handleClick}
          onContextMenu={handleContextMenu}
        />
      )}

      {activeProfile && (
        <ProfileCard
          userId={activeProfile.userId}
          position={activeProfile.position}
          onClose={() => setActiveProfile(null)}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'Profile',
              icon: 'user',
              onClick: () => {
                setActiveProfile({
                  userId: contextMenu.member.user.id,
                  position: { x: contextMenu.x - 330, y: contextMenu.y }
                })
              }
            },
            {
              label: 'Message',
              icon: 'message-circle',
              onClick: async () => {
                try {
                  const dm = await getDMChannel(contextMenu.member.user.id)
                  navigate(`/channels/@me/${dm.channel_id}`)
                } catch (err) {
                  console.error('Failed to get DM channel', err)
                }
              }
            },
            { separator: true },
            {
              label: 'Copy ID',
              icon: 'copy',
              onClick: () => navigator.clipboard.writeText(contextMenu.member.user.id)
            },
            { separator: true },
            // Block / Unblock Not server specific, always available
            (contextMenu.member.user.id !== user?.id) ? {
              label: blocks.some(b => b.id === contextMenu.member.user.id) ? 'Unblock' : 'Block',
              icon: 'slash',
              danger: true,
              onClick: async () => {
                 const isBlocked = blocks.some(b => b.id === contextMenu.member.user.id)
                 if (isBlocked) await unblockUser(contextMenu.member.user.id)
                 else await blockUser(contextMenu.member.user.id)
                 queryClient.invalidateQueries({ queryKey: ['blocks'] })
              }
            } : null,
            // Kick / Ban
            (canManage(contextMenu.member)) ? { separator: true } : null,
            (canManage(contextMenu.member)) ? {
              label: 'Kick Member',
              icon: 'user-minus',
              danger: true,
              onClick: async () => {
                if (window.confirm(`Are you sure you want to kick ${contextMenu.member.user.username}?`)) {
                  await kickMember(serverId, contextMenu.member.user.id)
                  queryClient.invalidateQueries({ queryKey: ['members', serverId] })
                }
              }
            } : null,
            (canManage(contextMenu.member)) ? {
              label: 'Ban Member',
              icon: 'x-circle',
              danger: true,
              onClick: async () => {
                if (window.confirm(`Are you sure you want to ban ${contextMenu.member.user.username}?`)) {
                  await banMember(serverId, contextMenu.member.user.id)
                  queryClient.invalidateQueries({ queryKey: ['members', serverId] })
                   // Also bans list invalidation
                  queryClient.invalidateQueries({ queryKey: ['bans', serverId] })
                }
              }
            } : null,
          ].filter(Boolean) as any} // Cast to any to handle conditional nulls easily
        />
      )}
    </div>
  )
}

function Section({ label, color, members, onClickMember, onContextMenu }: {
  label: string
  color?: string
  members: Member[]
  onClickMember: (m: Member, e: React.MouseEvent) => void
  onContextMenu: (m: Member, e: React.MouseEvent) => void
}) {
  return (
    <div className="mb-2">
      <div className="px-3 py-1 flex items-center gap-1.5 text-[11px] font-bold uppercase text-sp-muted tracking-wider">
        {color && (
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        )}
        {label} — {members.length}
      </div>
      {members.map(m => (
        <MemberRow
          key={m.user.id}
          member={m}
          onClick={e => onClickMember(m, e)}
          onContextMenu={e => onContextMenu(m, e)}
        />
      ))}
    </div>
  )
}

function MemberRow({ member, onClick, onContextMenu }: { member: Member; onClick: (e: React.MouseEvent) => void; onContextMenu: (e: React.MouseEvent) => void }) {
  // Pick the highest-position role with a color to render as the name's color
  const nameColor = member.roles.reduce<string | null>((best, r) => {
    if (!r.color) return best
    if (best === null) return r.color
    return r.position > (member.roles.find(x => x.color === best)?.position ?? -1) ? r.color : best
  }, null)

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      data-avatar-ring
      className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded mx-1 hover:bg-sp-input/60 transition-colors text-left group select-none"
      style={{ width: 'calc(100% - 8px)', '--avatar-ring': '#1a1a1e', '--avatar-ring-hover': '#2c2d32' } as React.CSSProperties}
    >
      <AvatarWithStatus user={member.user} size={32} />
      <span
        className={`text-sm font-medium truncate transition-colors ${
          member.user.status === 'offline' ? 'text-sp-muted' : 'text-sp-text'
        } group-hover:text-sp-text`}
        style={nameColor && member.user.status !== 'offline' ? { color: nameColor } : undefined}
      >
        {member.nickname ?? member.user.username}
      </span>
    </button>
  )
}
