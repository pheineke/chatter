import { useQuery } from '@tanstack/react-query'
import { getMembers } from '../api/servers'
import { UserAvatar } from './UserAvatar'
import { StatusIndicator } from './StatusIndicator'
import { ProfileCard } from './ProfileCard'
import { useState } from 'react'
import type { Member } from '../api/types'

interface Props {
  serverId: string
}

export function MemberSidebar({ serverId }: Props) {
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', serverId],
    queryFn: () => getMembers(serverId),
    refetchInterval: 30_000,
  })

  const [activeProfile, setActiveProfile] = useState<{ userId: string; position: { x: number; y: number } } | null>(null)

  const online  = members.filter(m => m.user.status !== 'offline')
  const offline = members.filter(m => m.user.status === 'offline')

  function handleClick(member: Member, e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // Position card to the left of the sidebar
    setActiveProfile({ userId: member.user.id, position: { x: rect.left - 328, y: rect.top } })
  }

  return (
    <div
      className="w-60 shrink-0 bg-discord-sidebar flex flex-col h-full overflow-y-auto border-l border-black/20"
    >
      <div className="px-3 flex items-center h-12 shrink-0 border-b border-black/20 shadow-sm">
        <span className="text-xs font-bold uppercase text-discord-muted tracking-wider">
          Members — {members.length}
        </span>
      </div>

      {online.length > 0 && (
        <Section label="Online" members={online} onClickMember={handleClick} />
      )}

      {offline.length > 0 && (
        <Section label="Offline" members={offline} onClickMember={handleClick} />
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

function Section({ label, members, onClickMember }: { label: string; members: Member[]; onClickMember: (m: Member, e: React.MouseEvent) => void }) {
  return (
    <div className="mb-2">
      <div className="px-3 py-1 text-[11px] font-bold uppercase text-discord-muted tracking-wider">
        {label} — {members.length}
      </div>
      {members.map(m => (
        <MemberRow key={m.user.id} member={m} onClick={e => onClickMember(m, e)} />
      ))}
    </div>
  )
}

function MemberRow({ member, onClick }: { member: Member; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded mx-1 hover:bg-discord-input/60 transition-colors text-left group"
      style={{ width: 'calc(100% - 8px)' }}
    >
      <div className="relative shrink-0">
        <UserAvatar user={member.user} size={32} />
        <span className="absolute -bottom-0.5 -right-0.5">
          <StatusIndicator status={member.user.status} size={11} />
        </span>
      </div>
      <span className={`text-sm font-medium truncate ${
        member.user.status === 'offline' ? 'text-discord-muted' : 'text-discord-text'
      } group-hover:text-white transition-colors`}>
        {member.user.username}
      </span>
    </button>
  )
}
