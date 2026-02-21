import { useNavigate, useParams, useMatch } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useRef, useCallback, type ReactNode } from 'react'
import { getChannels, getCategories, createChannel, updateChannel, deleteChannel, getServerVoicePresence, reorderChannels, reorderCategories } from '../api/channels'
import { getMembers, getServer } from '../api/servers'
import { useAuth } from '../contexts/AuthContext'
import { StatusIndicator } from './StatusIndicator'
import { UserAvatar } from './UserAvatar'
import { Icon } from './Icon'
import { useServerWS } from '../hooks/useServerWS'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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

  // Derive admin status: owner, or member with an is_admin role
  const isAdmin =
    !!server && !!user && (
      server.owner_id === user.id ||
      members.find(m => m.user.id === user.id)?.roles.some(r => r.is_admin) === true
    )

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
  const [editChannelDesc, setEditChannelDesc] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const items: ContextMenuItem[] = []
    if (isAdmin) items.push({ label: 'Create Channel', icon: 'hash', onClick: () => setShowAddChannel(true) })
    items.push({ label: 'Invite to Server', icon: 'person-add', onClick: handleCreateInvite })
    setContextMenu({ x: e.clientX, y: e.clientY, items })
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!isAdmin) return
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Edit Channel',
          icon: 'edit-2',
          onClick: () => { setEditChannel(ch); setEditChannelName(ch.title); setEditChannelDesc(ch.description ?? '') },
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
    await updateChannel(serverId, editChannel.id, {
      title: editChannelName.trim(),
      description: editChannelDesc.trim() || null,
    })
    qc.invalidateQueries({ queryKey: ['channels', serverId] })
    setEditChannel(null)
  }

  // Build sorted flat list: [cat:A, ch:1, ch:2, cat:B, ch:3, ch:4, ...]
  const sortedCats = [...categories].sort((a, b) => a.position - b.position)
  const byCategory = new Map<string | null, Channel[]>()
  sortedCats.forEach(c => byCategory.set(c.id, []))
  byCategory.set(null, [])
  channels.forEach(ch => {
    const key = ch.category_id ?? null
    byCategory.set(key, [...(byCategory.get(key) ?? []), ch])
  })
  byCategory.forEach((v, k) => byCategory.set(k, [...v].sort((a, b) => a.position - b.position)))
  const flatIds: string[] = []
  sortedCats.forEach(cat => {
    flatIds.push(`cat:${cat.id}`)
    byCategory.get(cat.id)?.forEach(ch => flatIds.push(`ch:${ch.id}`))
  })
  byCategory.get(null)?.forEach(ch => flatIds.push(`ch:${ch.id}`))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setDragId(null)
    if (!over || active.id === over.id || !serverId) return
    const activeStr = active.id as string
    const overStr = over.id as string

    if (activeStr.startsWith('cat:') && overStr.startsWith('cat:')) {
      // Reorder categories: arrayMove on sorted cat IDs
      const catIds = sortedCats.map(c => c.id)
      const oldIdx = catIds.indexOf(activeStr.replace('cat:', ''))
      const newIdx = catIds.indexOf(overStr.replace('cat:', ''))
      if (oldIdx === -1 || newIdx === -1) return
      const newCatIds = arrayMove(catIds, oldIdx, newIdx)
      const catUpdates = newCatIds.map((id, pos) => ({ id, position: pos }))
      qc.setQueryData<typeof categories>(['categories', serverId], old =>
        old?.map(c => ({ ...c, position: catUpdates.find(u => u.id === c.id)?.position ?? c.position }))
          .sort((a, b) => a.position - b.position) ?? []
      )
      reorderCategories(serverId, catUpdates).catch(() => {
        qc.invalidateQueries({ queryKey: ['categories', serverId] })
      })
      return
    }

    if (activeStr.startsWith('ch:')) {
      // Reorder / move channel
      const oldIdx = flatIds.indexOf(activeStr)
      const newIdx = flatIds.indexOf(overStr)
      if (oldIdx === -1 || newIdx === -1) return
      const newFlatIds = arrayMove(flatIds, oldIdx, newIdx)
      // Rebuild category assignments from new position in flat list
      let currentCatId: string | null = null
      const catChannelCount = new Map<string | null, number>()
      const chanUpdates: { id: string; position: number; category_id: string | null }[] = []
      for (const id of newFlatIds) {
        if (id.startsWith('cat:')) {
          currentCatId = id.replace('cat:', '')
        } else {
          const chId = id.replace('ch:', '')
          const pos = catChannelCount.get(currentCatId) ?? 0
          catChannelCount.set(currentCatId, pos + 1)
          chanUpdates.push({ id: chId, position: pos, category_id: currentCatId })
        }
      }
      qc.setQueryData<typeof channels>(['channels', serverId], old =>
        old?.map(ch => {
          const upd = chanUpdates.find(u => u.id === ch.id)
          return upd ? { ...ch, position: upd.position, category_id: upd.category_id } : ch
        }) ?? []
      )
      reorderChannels(serverId, chanUpdates).catch(() => {
        qc.invalidateQueries({ queryKey: ['channels', serverId] })
      })
    }
  }

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
        className="flex-1 overflow-y-auto py-2 scrollbar-none"
        onContextMenu={handleContextMenu}
      >
        {isAdmin ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={e => setDragId(e.active.id as string)}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={flatIds} strategy={verticalListSortingStrategy}>
              {flatIds.map(itemId => {
                if (itemId.startsWith('cat:')) {
                  const cat = categories.find(c => c.id === itemId.replace('cat:', ''))
                  if (!cat) return null
                  return <SortableCatHeader key={itemId} id={itemId} title={cat.title} />
                }
                const ch = channels.find(c => c.id === itemId.replace('ch:', ''))
                if (!ch) return null
                return (
                  <SortableChannelItem key={itemId} id={itemId}>
                    <ChannelRow
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
                      onContextMenu={e => openChannelContextMenu(e, ch)}
                    />
                  </SortableChannelItem>
                )
              })}
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {dragId && (() => {
                if (dragId.startsWith('ch:')) {
                  const ch = channels.find(c => c.id === dragId.replace('ch:', ''))
                  if (!ch) return null
                  return (
                    <div className="bg-discord-input/90 rounded px-2 py-1 mx-1 flex items-center gap-1.5 text-sm text-discord-text shadow-xl cursor-grabbing">
                      <Icon name={ch.type === 'voice' ? 'headphones' : 'hash'} size={16} className="opacity-60 shrink-0" />
                      <span className="truncate">{ch.title}</span>
                    </div>
                  )
                }
                if (dragId.startsWith('cat:')) {
                  const cat = categories.find(c => c.id === dragId.replace('cat:', ''))
                  if (!cat) return null
                  return (
                    <div className="px-3 py-1 text-xs font-semibold uppercase text-discord-muted tracking-wider bg-discord-sidebar shadow-xl rounded cursor-grabbing">
                      {cat.title}
                    </div>
                  )
                }
                return null
              })()}
            </DragOverlay>
          </DndContext>
        ) : (
          /* Non-admin: read-only ordered list */
          <>
            {flatIds.map(itemId => {
              if (itemId.startsWith('cat:')) {
                const cat = categories.find(c => c.id === itemId.replace('cat:', ''))
                if (!cat) return null
                return (
                  <div key={itemId} className="px-2 pt-3 pb-1 text-xs font-semibold uppercase text-discord-muted tracking-wider">
                    {cat.title}
                  </div>
                )
              }
              const ch = channels.find(c => c.id === itemId.replace('ch:', ''))
              if (!ch) return null
              return (
                <ChannelRow
                  key={itemId}
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
                />
              )
            })}
          </>
        )}
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
            <label className="text-xs font-semibold uppercase text-discord-muted block mb-1">Channel Name</label>
            <input
              className="input w-full mb-3"
              value={editChannelName}
              onChange={(e) => setEditChannelName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEditChannel() }}
              autoFocus
            />
            <label className="text-xs font-semibold uppercase text-discord-muted block mb-1">Channel Topic <span className="normal-case font-normal">(optional)</span></label>
            <textarea
              className="input w-full mb-4 resize-none text-sm"
              rows={3}
              placeholder="Add a topic…"
              value={editChannelDesc}
              onChange={(e) => setEditChannelDesc(e.target.value)}
              maxLength={1024}
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
  onContextMenu?: (e: React.MouseEvent) => void
}

function ChannelRow({ channel, active, serverId, voiceSession, channelPresence, members, localUser, onJoinVoice, onLeaveVoice, navigate, onContextMenu }: RowProps) {
  const isVoice = channel.type === 'voice'
  const inThisVoice = voiceSession?.channelId === channel.id
  const [activeProfile, setActiveProfile] = useState<{ id: string; pos: { x: number; y: number } } | null>(null)

  function handleClick() {
    if (isVoice) {
      if (inThisVoice) {
        // Already connected → just navigate to the voice grid
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
  const participantUsers: { user: User; isSelf: boolean; isSpeaking: boolean }[] = isVoice
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
        return { user, isSelf, isSpeaking: p.is_speaking ?? false }
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
        {inThisVoice && (
          <span className="ml-auto text-discord-online text-xs">● Live</span>
        )}
      </button>

      {/* Voice participants */}
      {participantUsers.length > 0 && (
        <div className="ml-4 mb-1 space-y-0.5">
          {participantUsers.map(({ user: u, isSelf, isSpeaking }) => (
            <div 
              key={u.id} 
              className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs text-discord-muted hover:bg-discord-input/40 cursor-pointer"
              onClick={(e) => handleUserClick(e, u.id)}
            >
              <div className={`relative shrink-0 rounded-full transition-all ${
                isSpeaking ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-discord-sidebar' : ''
              }`}>
                <UserAvatar user={u} size={20} />
                <span className="absolute -bottom-0.5 -right-0.5">
                  <StatusIndicator status={u.status} size={7} />
                </span>
              </div>
              <span className={`truncate transition-colors ${isSpeaking ? 'text-white' : ''}`}>{u.username}{isSelf ? ' (you)' : ''}</span>
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

// ---- Drag-and-drop wrappers (used only in admin mode) ----------------------

function SortableCatHeader({ id, title }: { id: string; title: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`px-2 pt-3 pb-1 text-xs font-semibold uppercase text-discord-muted tracking-wider cursor-grab active:cursor-grabbing select-none ${isDragging ? 'opacity-0' : ''}`}
      {...listeners}
      {...attributes}
    >
      {title}
    </div>
  )
}

function SortableChannelItem({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-0' : ''}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  )
}
