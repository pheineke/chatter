import { useNavigate, useParams, useMatch } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useRef, useCallback } from 'react'
import { getChannels, getCategories, createChannel, updateChannel, deleteChannel, getServerVoicePresence } from '../api/channels'
import { getMembers, getServer } from '../api/servers'
import { useAuth } from '../contexts/AuthContext'
import { StatusIndicator } from './StatusIndicator'
import { UserAvatar } from './UserAvatar'
import { Icon } from './Icon'
import { useServerWS } from '../hooks/useServerWS'
import { updateMe } from '../api/users'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuItem } from './ContextMenu'
import { createInvite } from '../api/invites'
import type { Channel, VoiceParticipant, Member, User } from '../api/types'
import type { VoiceSession } from '../pages/AppShell'
import { ProfileCard } from './ProfileCard'

interface Props {
  voiceSession: VoiceSession | null
  onJoinVoice: (session: VoiceSession) => void
  onLeaveVoice: () => void
}

export function ChannelSidebar({ voiceSession, onJoinVoice, onLeaveVoice }: Props) {
  const { serverId } = useParams<{ serverId: string }>()
  const channelMatch = useMatch('/channels/:serverId/:channelId')
  const channelId = channelMatch?.params.channelId
  const navigate = useNavigate()
  const { user, logout, refreshUser } = useAuth()
  const qc = useQueryClient()

  useServerWS(serverId ?? null)

  const { data: server } = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer(serverId!),
    enabled: !!serverId,
  })

  const { data: channels = [] } = useQuery({
    queryKey: ['channels', serverId],
    queryFn: () => getChannels(serverId!),
    enabled: !!serverId,
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', serverId],
    queryFn: () => getCategories(serverId!),
    enabled: !!serverId,
  })

  const { data: members = [] } = useQuery({
    queryKey: ['members', serverId],
    queryFn: () => getMembers(serverId!),
    enabled: !!serverId,
  })

  const { data: voicePresence = {} } = useQuery({
    queryKey: ['voicePresence', serverId],
    queryFn: () => getServerVoicePresence(serverId!),
    enabled: !!serverId,
    staleTime: 10_000,
    refetchInterval: 10_000,  // Fallback: poll every 10s in case WS events are missed
  })

  const [showAddChannel, setShowAddChannel] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>('text')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [editChannel, setEditChannel] = useState<Channel | null>(null)
  const [editChannelName, setEditChannelName] = useState('')

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Create Channel', icon: 'hash', onClick: () => setShowAddChannel(true) },
        { label: 'Invite to Server', icon: 'person-add', onClick: handleCreateInvite },
      ],
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleHeaderClick(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setContextMenu({
      x: rect.left,
      y: rect.bottom + 4,
      items: [
        { label: 'Server Settings', icon: 'settings', onClick: () => navigate(`/channels/${serverId}/settings`) },
        { label: 'Invite to Server', icon: 'person-add', onClick: handleCreateInvite },
      ],
    })
  }

  async function handleCreateInvite() {
    if (!serverId) return
    const invite = await createInvite(serverId, { expires_hours: 24 })
    setInviteLink(`${window.location.origin}/invite/${invite.code}`)
  }

  function copyInviteLink() {
    if (!inviteLink) return
    navigator.clipboard.writeText(inviteLink)
    setInviteCopied(true)
    setTimeout(() => setInviteCopied(false), 2000)
  }

  async function handleCreateChannel() {
    if (!serverId || !newChannelName.trim()) return
    await createChannel(serverId, { title: newChannelName, type: newChannelType })
    qc.invalidateQueries({ queryKey: ['channels', serverId] })
    setShowAddChannel(false)
    setNewChannelName('')
  }

  function openChannelContextMenu(e: React.MouseEvent, ch: Channel) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Edit Channel',
          icon: 'edit-2',
          onClick: () => { setEditChannel(ch); setEditChannelName(ch.title) },
        },
        {
          label: 'Delete Channel',
          icon: 'trash-2',
          danger: true,
          onClick: async () => {
            if (!serverId) return
            await deleteChannel(serverId, ch.id)
            qc.invalidateQueries({ queryKey: ['channels', serverId] })
          },
        },
      ],
    })
  }

  async function handleSaveEditChannel() {
    if (!serverId || !editChannel || !editChannelName.trim()) return
    await updateChannel(serverId, editChannel.id, { title: editChannelName.trim() })
    qc.invalidateQueries({ queryKey: ['channels', serverId] })
    setEditChannel(null)
  }

  // Group channels by category (null = no category)
  const grouped = new Map<string | null, Channel[]>()
  grouped.set(null, [])
  categories.forEach((c) => grouped.set(c.id, []))
  channels.forEach((ch) => {
    const key = ch.category_id ?? null
    grouped.set(key, [...(grouped.get(key) ?? []), ch])
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Server name header */}
      <div
        className="px-4 font-bold border-b border-black/20 shadow-sm flex items-center justify-between cursor-pointer hover:bg-discord-input/30 transition-colors select-none h-12 shrink-0"
        onClick={handleHeaderClick}
      >
        <span className="truncate">{server?.title ?? 'Server'}</span>
        <Icon name="chevron-down" size={16} className="text-discord-muted shrink-0" />
      </div>

      {/* Channel list */}
      <div
        className="flex-1 overflow-y-auto py-2 space-y-1 scrollbar-none"
        onContextMenu={handleContextMenu}
      >
        {Array.from(grouped.entries()).map(([catId, chs]) => {
          const cat = categories.find((c) => c.id === catId)
          return (
            <div key={catId ?? 'no-cat'}>
              {cat && (
                <div className="px-2 pt-3 pb-1 text-xs font-semibold uppercase text-discord-muted tracking-wider">
                  {cat.title}
                </div>
              )}
              {chs.map((ch) => (
                <ChannelRow
                  key={ch.id}
                  channel={ch}
                  active={ch.id === channelId}
                  serverId={serverId!}
                  voiceSession={voiceSession}
                  channelPresence={voicePresence[ch.id] ?? []}
                  members={members}
                  localUser={user ?? undefined}
                  onJoinVoice={onJoinVoice}
                  onLeaveVoice={onLeaveVoice}
                  navigate={navigate}
                  onContextMenu={(e) => openChannelContextMenu(e, ch)}
                />
              ))}
            </div>
          )
        })}
      </div>

      {/* User panel */}
      <div className="px-3 py-2 h-14 bg-discord-bg border-t border-black/20 flex items-center gap-2 shrink-0">
        <div 
          className="flex items-center gap-2 flex-1 min-w-0 hover:bg-discord-input/40 p-1 rounded cursor-pointer transition-colors"
          onClick={(e) => {
            if (!user) return
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const statuses: { label: string; value: string; icon: string }[] = [
              { label: 'Online',  value: 'online',  icon: 'ellipse' },
              { label: 'Away',    value: 'away',    icon: 'time' },
              { label: 'Do Not Disturb', value: 'busy', icon: 'remove-circle' },
              { label: 'Offline', value: 'offline', icon: 'ellipse' },
            ]
            setContextMenu({
              x: rect.left,
              y: rect.top - 4,
              items: statuses.map(s => ({
                label: s.label,
                icon: s.icon,
                active: user.status === s.value,
                onClick: async () => {
                  await updateMe({ status: s.value as any })
                  await refreshUser()
                },
              })),
            })
          }}
        >
          <div className="relative">
            <UserAvatar user={user} size={32} />
            {user && (
              <span className="absolute -bottom-0.5 -right-0.5">
                <StatusIndicator status={user.status} size={10} />
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{user?.username}</div>
            <div className="text-xs text-discord-muted truncate capitalize">{user?.status}</div>
          </div>
        </div>
        <button
          title="User Settings"
          onClick={() => navigate('/channels/settings')}
          className="text-discord-muted hover:text-discord-text leading-none p-2 rounded hover:bg-discord-input/40 transition-colors"
        >
          <Icon name="settings" size={18} />
        </button>
      </div>

      {/* Add channel modal */}
      {showAddChannel && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowAddChannel(false)}>
          <div className="bg-discord-sidebar rounded-lg p-6 w-80" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Add Channel</h2>
            <div className="flex gap-2 mb-3">
              {(['text', 'voice'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setNewChannelType(t)}
                  className={`flex-1 py-1 rounded text-sm flex items-center justify-center gap-1 ${newChannelType === t ? 'bg-discord-mention text-white' : 'bg-discord-input text-discord-text'}`}
                >
                  {t === 'text'
                    ? <><Icon name="hash" size={14} /> Text</>
                    : <><Icon name="headphones" size={14} /> Voice</>}
                </button>
              ))}
            </div>
            <input
              className="input w-full mb-3"
              placeholder="channel-name"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
            />
            <button className="btn w-full" onClick={handleCreateChannel} disabled={!newChannelName.trim()}>
              Create Channel
            </button>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Invite link modal */}
      {inviteLink && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => { setInviteLink(null); setInviteCopied(false) }}>
          <div className="bg-discord-sidebar rounded-lg p-6 w-96" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-1">Invite People</h2>
            <p className="text-sm text-discord-muted mb-4">Share this link — it expires in 24 hours.</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={inviteLink}
                className="input flex-1 text-sm font-mono"
                onFocus={(e) => e.target.select()}
              />
              <button className="btn shrink-0 flex items-center gap-1.5" onClick={copyInviteLink}>
                <Icon name={inviteCopied ? 'checkmark-circle' : 'copy'} size={16} />
                {inviteCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Edit channel modal */}
      {editChannel && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setEditChannel(null)}>
          <div className="bg-discord-sidebar rounded-lg p-6 w-80" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Edit Channel</h2>
            <input
              className="input w-full mb-3"
              value={editChannelName}
              onChange={(e) => setEditChannelName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEditChannel() }}
              autoFocus
            />
            <div className="flex gap-2">
              <button className="btn flex-1" onClick={handleSaveEditChannel} disabled={!editChannelName.trim()}>
                Save
              </button>
              <button className="btn flex-1 bg-discord-input hover:bg-discord-input/70" onClick={() => setEditChannel(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface RowProps {
  channel: Channel
  active: boolean
  serverId: string
  voiceSession: VoiceSession | null
  channelPresence: VoiceParticipant[]
  members: Member[]
  localUser?: User
  onJoinVoice: (s: VoiceSession) => void
  onLeaveVoice: () => void
  navigate: ReturnType<typeof useNavigate>
  onContextMenu: (e: React.MouseEvent) => void
}

function ChannelRow({ channel, active, serverId, voiceSession, channelPresence, members, localUser, onJoinVoice, onLeaveVoice, navigate, onContextMenu }: RowProps) {
  const isVoice = channel.type === 'voice'
  const inThisVoice = voiceSession?.channelId === channel.id
  const [activeProfile, setActiveProfile] = useState<{ id: string; pos: { x: number; y: number } } | null>(null)

  function handleClick() {
    if (isVoice) {
      if (inThisVoice && active) {
        // Already connected AND viewing this channel → disconnect, stay on page
        // (MessagePane will flip to "Join Voice" view)
        onLeaveVoice()
      } else if (inThisVoice && !active) {
        // Connected but viewing another channel → navigate to the voice grid
        navigate(`/channels/${serverId}/${channel.id}`)
      } else {
        // Not connected → join and navigate to the voice grid
        onJoinVoice({ channelId: channel.id, channelName: channel.title, serverId })
        navigate(`/channels/${serverId}/${channel.id}`)
      }
    } else {
      navigate(`/channels/${serverId}/${channel.id}`)
    }
  }

  function handleUserClick(e: React.MouseEvent, userId: string) {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setActiveProfile({ id: userId, pos: { x: rect.right + 12, y: rect.top } })
  }

  // Resolve participant user info from the per-channel presence list.
  // All clients (including non-voice ones) get this from useServerWS + voicePresence query.
  const participantUsers: { user: User; isSelf: boolean }[] = isVoice
    ? channelPresence.map((p) => {
        const isSelf = p.user_id === localUser?.id
        const m = members.find((m) => m.user_id === p.user_id)
        let user: User | null = isSelf ? localUser! : (m?.user ?? null)
        
        // Fallback if not found: mock minimal user object so they still appear
        if (!user) {
          user = {
            id: p.user_id,
            username: p.username ?? `User ${p.user_id.slice(0, 4)}`,
            avatar: p.avatar ?? null,
            description: null,
            status: 'offline',
            created_at: '',
            banner: null,
            pronouns: null,
          }
        }
        return { user, isSelf }
      })
    : []

  return (
    <>
    <div>
      <button
        onClick={handleClick}
        onContextMenu={onContextMenu}
        className={`w-full flex items-center gap-1.5 px-2 py-1 mx-1 rounded text-sm transition-colors
          ${active
            ? 'bg-white/10 text-discord-text font-medium'
            : 'text-discord-muted hover:bg-white/5 hover:text-discord-text'}`}
      >
        <Icon name={isVoice ? 'headphones' : 'hash'} size={16} className="opacity-60 shrink-0" />
        <span className="truncate">{channel.title}</span>
        {inThisVoice && active && (
          <span className="ml-auto text-red-400 text-xs flex items-center gap-0.5">
            <Icon name="phone-off" size={11} /> Leave
          </span>
        )}
        {inThisVoice && !active && (
          <span className="ml-auto text-discord-online text-xs">● Live</span>
        )}
      </button>

      {/* Voice participants */}
      {participantUsers.length > 0 && (
        <div className="ml-4 mb-1 space-y-0.5">
          {participantUsers.map(({ user: u, isSelf }) => (
            <div 
              key={u.id} 
              className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs text-discord-muted hover:bg-discord-input/40 cursor-pointer"
              onClick={(e) => handleUserClick(e, u.id)}
            >
              <div className="relative shrink-0">
                <UserAvatar user={u} size={20} />
                <span className="absolute -bottom-0.5 -right-0.5">
                  <StatusIndicator status={u.status} size={7} />
                </span>
              </div>
              <span className="truncate">{u.username}{isSelf ? ' (you)' : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
    {activeProfile && (
       <ProfileCard 
          userId={activeProfile.id} 
          onClose={() => setActiveProfile(null)} 
          position={activeProfile.pos} 
       />
    )}
    </>
  )
}
