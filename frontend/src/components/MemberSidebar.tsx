import { useQuery } from '@tanstack/react-query'
import { getMembers, getRoles } from '../api/servers'
import { AvatarWithStatus } from './AvatarWithStatus'
import { ProfileCard } from './ProfileCard'
import { useState } from 'react'
import type { Member, Role } from '../api/types'

interface Props {
  serverId: string
}

export function MemberSidebar({ serverId }: Props) {
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', serverId],
    queryFn: () => getMembers(serverId),
  })

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ['roles', serverId],
    queryFn: () => getRoles(serverId),
  })

  const [activeProfile, setActiveProfile] = useState<{ userId: string; position: { x: number; y: number } } | null>(null)

  function handleClick(member: Member, e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setActiveProfile({ userId: member.user.id, position: { x: rect.left - 328, y: rect.top } })
  }

  // Split online / offline
  const online  = members.filter(m => m.user.status !== 'offline')
  const offline = members.filter(m => m.user.status === 'offline')

  // Build hoisted-role groups for online members.
  // A role is hoisted when role.hoist === true (the dedicated flag, set by admins in Role settings).
  // Sort roles by position descending (highest position = most prominent)
  const hoistedRoles = [...roles]
    .filter(r => r.hoist)
    .sort((a, b) => b.position - a.position)

  // Map role id → role
  const roleMap = Object.fromEntries(roles.map(r => [r.id, r]))

  // For each online member, find their highest-position hoisted role (if any)
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

  return (
    <div className="hidden md:flex flex-col w-60 shrink-0 bg-discord-bg h-full overflow-y-auto border-l-2 border-white/[0.03]">
      <div className="px-3 flex items-center h-12 shrink-0 border-b border-white/[0.07] shadow-sm">
        <span className="text-xs font-bold uppercase text-discord-muted tracking-wider">
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
        />
      ))}

      {offlineSorted.length > 0 && (
        <Section
          label="Offline"
          members={offlineSorted}
          onClickMember={handleClick}
        />
      )}

      {activeProfile && (
        <ProfileCard
          userId={activeProfile.userId}
          position={activeProfile.position}
          onClose={() => setActiveProfile(null)}
        />
      )}
    </div>
  )
}

function Section({ label, color, members, onClickMember }: {
  label: string
  color?: string
  members: Member[]
  onClickMember: (m: Member, e: React.MouseEvent) => void
}) {
  return (
    <div className="mb-2">
      <div className="px-3 py-1 flex items-center gap-1.5 text-[11px] font-bold uppercase text-discord-muted tracking-wider">
        {color && (
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        )}
        {label} — {members.length}
      </div>
      {members.map(m => (
        <MemberRow key={m.user.id} member={m} onClick={e => onClickMember(m, e)} />
      ))}
    </div>
  )
}

function MemberRow({ member, onClick }: { member: Member; onClick: (e: React.MouseEvent) => void }) {
  // Pick the highest-position role with a color to render as the name's color
  const nameColor = member.roles.reduce<string | null>((best, r) => {
    if (!r.color) return best
    if (best === null) return r.color
    return r.position > (member.roles.find(x => x.color === best)?.position ?? -1) ? r.color : best
  }, null)

  return (
    <button
      onClick={onClick}
      data-avatar-ring
      className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded mx-1 hover:bg-discord-input/60 transition-colors text-left group"
      style={{ width: 'calc(100% - 8px)', '--avatar-ring': '#1a1a1e', '--avatar-ring-hover': '#2c2d32' } as React.CSSProperties}
    >
      <AvatarWithStatus user={member.user} size={32} />
      <span
        className={`text-sm font-medium truncate transition-colors ${
          member.user.status === 'offline' ? 'text-discord-muted' : 'text-discord-text'
        } group-hover:text-white`}
        style={nameColor && member.user.status !== 'offline' ? { color: nameColor } : undefined}
      >
        {member.nickname ?? member.user.username}
      </span>
    </button>
  )
}
