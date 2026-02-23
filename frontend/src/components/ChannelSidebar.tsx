import { useNavigate, useParams, useMatch } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useRef, useCallback, type ReactNode } from 'react'
import { getChannels, getCategories, createChannel, updateChannel, deleteChannel, getServerVoicePresence, reorderChannels, reorderCategories, createCategory, updateCategory, deleteCategory } from '../api/channels'
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
import { InviteModal } from './InviteModal'
import type { Channel, VoiceParticipant, Member, User } from '../api/types'
import { useUnreadChannels } from '../contexts/UnreadChannelsContext'
import type { VoiceSession } from '../pages/AppShell'
import { ProfileCard } from './ProfileCard'
import { useNotificationSettings } from '../hooks/useNotificationSettings'

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

  useServerWS(serverId ?? null, channelId)
  const { unreadChannels } = useUnreadChannels()
  const { channelLevel, setChannelLevel } = useNotificationSettings()

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
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [editChannel, setEditChannel] = useState<Channel | null>(null)
  const [editChannelName, setEditChannelName] = useState('')
  const [editChannelDesc, setEditChannelDesc] = useState('')
  const [editSlowmode, setEditSlowmode] = useState(0)
  const [editCategory, setEditCategory] = useState<{ id: string; title: string } | null>(null)
  const [editCategoryName, setEditCategoryName] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(() => {
    const stored = serverId ? localStorage.getItem(`cats_collapsed_${serverId}`) : null
    return stored ? new Set(stored.split(',').filter(Boolean)) : new Set()
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const items: ContextMenuItem[] = []
    if (isAdmin) {
      items.push({ label: 'Create Channel', icon: 'hash', onClick: () => setShowAddChannel(true) })
      items.push({ label: 'Create Category', icon: 'folder', onClick: () => setShowAddCategory(true) })
    }
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

  function handleCreateInvite() {
    setInviteModalOpen(true)
  }

  async function handleCreateChannel() {
    if (!serverId || !newChannelName.trim()) return
    await createChannel(serverId, { title: newChannelName, type: newChannelType })
    qc.invalidateQueries({ queryKey: ['channels', serverId] })
    setShowAddChannel(false)
    setNewChannelName('')
  }

  async function handleCreateCategory() {
    if (!serverId || !newCategoryName.trim()) return
    await createCategory(serverId, newCategoryName.trim())
    qc.invalidateQueries({ queryKey: ['categories', serverId] })
    setShowAddCategory(false)
    setNewCategoryName('')
  }

  function openChannelContextMenu(e: React.MouseEvent, ch: Channel) {
    e.preventDefault()
    e.stopPropagation()
    const currentLevel = channelLevel(ch.id)
    const notifItems: ContextMenuItem[] = [
      {
        label: currentLevel === 'all' ? '✓ All Messages' : 'All Messages',
        icon: 'bell',
        onClick: () => setChannelLevel(ch.id, 'all'),
      },
      {
        label: currentLevel === 'mentions' ? '✓ Mentions Only' : 'Mentions Only',
        icon: 'at-sign',
        onClick: () => setChannelLevel(ch.id, 'mentions'),
      },
      {
        label: currentLevel === 'mute' ? '✓ Mute Channel' : 'Mute Channel',
        icon: 'bell-off',
        onClick: () => setChannelLevel(ch.id, currentLevel === 'mute' ? 'all' : 'mute'),
      },
    ]
    const adminItems: ContextMenuItem[] = isAdmin ? [
      {
        label: 'Edit Channel',
        icon: 'edit-2',
        onClick: () => { setEditChannel(ch); setEditChannelName(ch.title); setEditChannelDesc(ch.description ?? ''); setEditSlowmode(ch.slowmode_delay ?? 0) },
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
    ] : []
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [...notifItems, ...adminItems],
    })
  }

  function openCategoryContextMenu(e: React.MouseEvent, cat: { id: string; title: string }) {
    if (!isAdmin) return
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Edit Category',
          icon: 'edit-2',
          onClick: () => { setEditCategory(cat); setEditCategoryName(cat.title) },
        },
        {
          label: 'Delete Category',
          icon: 'trash-2',
          danger: true,
          onClick: async () => {
            if (!serverId) return
            await deleteCategory(serverId, cat.id)
            qc.invalidateQueries({ queryKey: ['categories', serverId] })
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
      slowmode_delay: editSlowmode,
    })
    qc.invalidateQueries({ queryKey: ['channels', serverId] })
    setEditChannel(null)
  }

  async function handleSaveEditCategory() {
    if (!serverId || !editCategory || !editCategoryName.trim()) return
    await updateCategory(serverId, editCategory.id, editCategoryName.trim())
    qc.invalidateQueries({ queryKey: ['categories', serverId] })
    setEditCategory(null)
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
  const visibleFlatIds: string[] = []
  sortedCats.forEach(cat => {
    flatIds.push(`cat:${cat.id}`)
    visibleFlatIds.push(`cat:${cat.id}`)
    byCategory.get(cat.id)?.forEach(ch => {
      flatIds.push(`ch:${ch.id}`)
      if (!collapsedCats.has(cat.id)) visibleFlatIds.push(`ch:${ch.id}`)
    })
  })
  byCategory.get(null)?.forEach(ch => {
    flatIds.push(`ch:${ch.id}`)
    visibleFlatIds.push(`ch:${ch.id}`)
  })

  function toggleCat(catId: string) {
    setCollapsedCats(prev => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      if (serverId) localStorage.setItem(`cats_collapsed_${serverId}`, [...next].join(','))
      return next
    })
  }

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
      // Reorder / move channel (use visibleFlatIds so collapsed channels stay put)
      const oldIdx = visibleFlatIds.indexOf(activeStr)
      const newIdx = visibleFlatIds.indexOf(overStr)
      if (oldIdx === -1 || newIdx === -1) return
      const newFlatIds = arrayMove(visibleFlatIds, oldIdx, newIdx)
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
            <SortableContext items={visibleFlatIds} strategy={verticalListSortingStrategy}>
              {visibleFlatIds.map(itemId => {
                if (itemId.startsWith('cat:')) {
                  const cat = categories.find(c => c.id === itemId.replace('cat:', ''))
                  if (!cat) return null
                  return <SortableCatHeader key={itemId} id={itemId} title={cat.title} collapsed={collapsedCats.has(cat.id)} onToggle={() => toggleCat(cat.id)} onContextMenu={e => openCategoryContextMenu(e, cat)} />
                }
                const ch = channels.find(c => c.id === itemId.replace('ch:', ''))
                if (!ch) return null
                return (
                  <SortableChannelItem key={itemId} id={itemId}>
                    <ChannelRow
                      channel={ch}
                      active={ch.id === channelId}
                      hasUnread={unreadChannels.has(ch.id)}
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
            {visibleFlatIds.map(itemId => {
              if (itemId.startsWith('cat:')) {
                const cat = categories.find(c => c.id === itemId.replace('cat:', ''))
                if (!cat) return null
                const collapsed = collapsedCats.has(cat.id)
                return (
                  <button
                    key={itemId}
                    onClick={() => toggleCat(cat.id)}
                    onContextMenu={e => openCategoryContextMenu(e, cat)}
                    className="w-full flex items-center gap-1 px-2 pt-3 pb-1 text-xs font-semibold uppercase text-discord-muted tracking-wider hover:text-discord-text transition-colors select-none"
                  >
                    <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} className="shrink-0" />
                    {cat.title}
                  </button>
                )
              }
              const ch = channels.find(c => c.id === itemId.replace('ch:', ''))
              if (!ch) return null
              return (
                <ChannelRow
                  key={itemId}
                  channel={ch}
                  active={ch.id === channelId}
                  hasUnread={unreadChannels.has(ch.id)}
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
              { label: 'Do Not Disturb', value: 'dnd',  icon: 'remove-circle' },
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
        {user?.status === 'dnd' && (
          <span title="Do Not Disturb — notifications silenced" className="text-discord-dnd">
            <Icon name="bell-off" size={16} />
          </span>
        )}
      </div>

      {/* Edit category modal */}
      {editCategory && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setEditCategory(null)}>
          <div className="bg-discord-sidebar rounded-lg p-6 w-80" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Edit Category</h2>
            <label className="text-xs font-semibold uppercase text-discord-muted block mb-1">Category Name</label>
            <input
              autoFocus
              className="input w-full mb-4"
              value={editCategoryName}
              onChange={(e) => setEditCategoryName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEditCategory() }}
            />
            <div className="flex gap-2">
              <button className="btn flex-1" onClick={handleSaveEditCategory} disabled={!editCategoryName.trim()}>
                Save
              </button>
              <button className="btn flex-1 bg-discord-input hover:bg-discord-input/70" onClick={() => setEditCategory(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add category modal */}
      {showAddCategory && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowAddCategory(false)}>
          <div className="bg-discord-sidebar rounded-lg p-6 w-80" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Create Category</h2>
            <input
              autoFocus
              className="input w-full mb-3"
              placeholder="Category name"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCategory() }}
            />
            <button className="btn w-full" onClick={handleCreateCategory} disabled={!newCategoryName.trim()}>
              Create Category
            </button>
          </div>
        </div>
      )}

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

      {/* Invite modal */}
      {inviteModalOpen && serverId && (
        <InviteModal
          serverId={serverId}
          serverName={server?.title ?? 'Server'}
          onClose={() => setInviteModalOpen(false)}
        />
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
            <label className="text-xs font-semibold uppercase text-discord-muted block mb-1">Slowmode</label>
            <select
              className="input w-full mb-4 text-sm"
              value={editSlowmode}
              onChange={(e) => setEditSlowmode(Number(e.target.value))}
            >
              <option value={0}>Off</option>
              <option value={5}>5 seconds</option>
              <option value={10}>10 seconds</option>
              <option value={15}>15 seconds</option>
              <option value={30}>30 seconds</option>
              <option value={60}>1 minute</option>
              <option value={120}>2 minutes</option>
              <option value={300}>5 minutes</option>
              <option value={600}>10 minutes</option>
              <option value={3600}>1 hour</option>
            </select>
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
  hasUnread?: boolean
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

function ChannelRow({ channel, active, hasUnread = false, serverId, voiceSession, channelPresence, members, localUser, onJoinVoice, onLeaveVoice, navigate, onContextMenu }: RowProps) {
  const isVoice = channel.type === 'voice'
  const inThisVoice = voiceSession?.channelId === channel.id
  const { channelLevel } = useNotificationSettings()
  const isMuted = channelLevel(channel.id) === 'mute'
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
  const participantUsers: { user: User; isSelf: boolean; isSpeaking: boolean; isMuted: boolean; isDeafened: boolean; isSharingScreen: boolean }[] = isVoice
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
            status: 'offline' as const,
            preferred_status: 'offline' as const,
            created_at: '',
            banner: null,
            pronouns: null,
          }
        }
        return { user, isSelf, isSpeaking: p.is_speaking ?? false, isMuted: p.is_muted, isDeafened: p.is_deafened, isSharingScreen: p.is_sharing_screen ?? false }
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
            : hasUnread
              ? 'text-discord-text font-semibold hover:bg-white/5'
              : 'text-discord-muted hover:bg-white/5 hover:text-discord-text'}`}
      >
        <Icon name={isVoice ? 'headphones' : 'hash'} size={16} className="opacity-60 shrink-0" />
        <span className="truncate">{channel.title}</span>
        {isMuted && (
          <span className="ml-1 text-discord-muted" title="Notifications muted">🔕</span>
        )}
        {hasUnread && !active && (
          <span className="ml-auto w-2 h-2 rounded-full bg-white shrink-0" aria-label="Unread messages" />
        )}
        {inThisVoice && (
          <span className="ml-auto text-discord-online text-xs">● Live</span>
        )}
      </button>

      {/* Voice participants */}
      {participantUsers.length > 0 && (
        <div className="ml-4 mb-1 space-y-0.5">
          {participantUsers.map(({ user: u, isSelf, isSpeaking, isMuted, isDeafened, isSharingScreen }) => (
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
              <span className={`truncate flex-1 transition-colors ${isSpeaking ? 'text-white' : ''}`}>{u.username}{isSelf ? ' (you)' : ''}</span>
              {/* Right-side status indicators */}
              <div className="flex items-center gap-0.5 ml-auto shrink-0">
                {isSharingScreen && (
                  <span className="text-[9px] font-bold leading-none px-1 py-0.5 rounded bg-red-500 text-white">LIVE</span>
                )}
                {isMuted && (
                  <Icon name="mic-off" size={11} className="text-red-400" />
                )}
                {isDeafened && (
                  <Icon name="headphones-off" size={11} className="text-red-400" />
                )}
              </div>
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

function SortableCatHeader({ id, title, collapsed, onToggle, onContextMenu }: { id: string; title: string; collapsed?: boolean; onToggle?: () => void; onContextMenu?: (e: React.MouseEvent) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group flex items-center gap-1 px-2 pt-3 pb-1 text-xs font-semibold uppercase text-discord-muted tracking-wider select-none cursor-pointer hover:text-discord-text transition-colors ${isDragging ? 'opacity-0' : ''}`}
      onClick={onToggle}
      onContextMenu={onContextMenu}
      {...attributes}
    >
      <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} className="shrink-0" />
      <span>{title}</span>
      {/* Drag handle — only this initiates reordering */}
      <span
        ref={setActivatorNodeRef}
        {...listeners}
        onClick={e => e.stopPropagation()}
        title="Drag to reorder"
        className="ml-auto opacity-0 group-hover:opacity-60 hover:!opacity-100 cursor-grab active:cursor-grabbing shrink-0 transition-opacity"
      >
        <Icon name="menu" size={11} />
      </span>
    </div>
  )
}

function SortableChannelItem({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative ${isDragging ? 'opacity-0' : ''}`}
      {...attributes}
    >
      {/* Drag handle — absolutely positioned so it doesn't shift channel content */}
      <span
        ref={setActivatorNodeRef}
        {...listeners}
        title="Drag to reorder"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10 opacity-0 group-hover:opacity-40 hover:!opacity-80 cursor-grab active:cursor-grabbing text-discord-muted transition-opacity"
      >
        <Icon name="menu" size={11} />
      </span>
      {children}
    </div>
  )
}
