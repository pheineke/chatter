import { useNavigate, useParams, useMatch } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { getChannels, getCategories, createChannel, updateChannel, deleteChannel, getServerVoicePresence, reorderChannels, reorderCategories, createCategory, updateCategory, deleteCategory } from '../api/channels'
import { getMembers, getServer, updateMySettings } from '../api/servers'
import { useAuth } from '../contexts/AuthContext'
import { AvatarWithStatus } from './AvatarWithStatus'
import { Icon } from './Icon'
import { useServerWS } from '../hooks/useServerWS'
import { Portal } from './Portal'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { updateMe } from '../api/users'
import { Fragment } from 'react'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuItem } from './ContextMenu'
import { InviteModal } from './InviteModal'

import type { Channel, VoiceParticipant, Member, User } from '../api/types'
import { useUnreadChannels } from '../contexts/UnreadChannelsContext'
import type { VoiceSession } from '../pages/AppShell'
import { ProfileCard } from './ProfileCard'
import { useNotificationSettings } from '../hooks/useNotificationSettings'
import { setLastChannel } from '../utils/lastChannel'

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
  const { unreadChannels, markRead, markAllServerRead } = useUnreadChannels()
  const { channelLevel, setChannelLevel, serverLevel, setServerLevel } = useNotificationSettings()

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

  const me = members?.find(m => m.user.id === user?.id)

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
  })

  const [showAddChannel, setShowAddChannel] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>('text')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[]; slideDown?: boolean; width?: number } | null>(null)
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [editCategory, setEditCategory] = useState<{ id: string; title: string } | null>(null)
  const [editCategoryName, setEditCategoryName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<
    | { kind: 'channel'; id: string; name: string }
    | { kind: 'category'; id: string; name: string }
    | null
  >(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(() => {
    const stored = serverId ? localStorage.getItem(`cats_collapsed_${serverId}`) : null
    return stored ? new Set(stored.split(',').filter(Boolean)) : new Set()
  })
  const [hideMuted, setHideMuted] = useState(() => {
    return localStorage.getItem('hideMutedChannels') === 'true'
  })

  // Persist hideMuted
  useEffect(() => {
    localStorage.setItem('hideMutedChannels', String(hideMuted))
  }, [hideMuted])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const items: ContextMenuItem[] = []
    if (isAdmin) {
      items.push({ label: 'Create Channel', icon: 'hash', onClick: () => { setCreateError(null); setShowAddChannel(true) } })
      items.push({ label: 'Create Category', icon: 'folder', onClick: () => { setCreateError(null); setShowAddCategory(true) } })
    }
    items.push({ label: 'Invite to Server', icon: 'person-add', onClick: handleCreateInvite })
    setContextMenu({ x: e.clientX, y: e.clientY, items })
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleHeaderContextMenu(e: React.MouseEvent) {
    if (!server) return
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const items: ContextMenuItem[] = []

    // Mark as Read
    items.push({
      label: 'Mark As Read',
      icon: 'check-circle',
      onClick: () => markAllServerRead(server.id),
    })

    items.push({ separator: true })

    // Mute Server
    const isMuted = serverLevel(server.id) === 'mute'
    items.push({
      label: isMuted ? 'Unmute Server' : 'Mute Server',
      icon: isMuted ? 'bell' : 'bell-off',
      onClick: () => setServerLevel(server.id, isMuted ? 'all' : 'mute'),
    })

    // Hide Muted Channels
    items.push({
      label: hideMuted ? 'Show Muted Channels' : 'Hide Muted Channels',
      icon: hideMuted ? 'eye' : 'eye-off',
      onClick: () => setHideMuted(!hideMuted),
    })

    // Privacy Settings
    // Logic: allow_dms overrides global setting.
    // If not set (null), falls back to global (user.dm_permission).
    const globalAllow = user?.dm_permission !== 'friends_only'
    const isAllowed = me?.allow_dms === true || (me?.allow_dms === null && globalAllow)

    items.push({
      label: 'Allow Direct Messages',
      icon: isAllowed ? 'checkmark-square' : 'square',
      onClick: () => {
        const nextState = !isAllowed
        // If next state matches global default, set to null to inherit
        const payload = (nextState === globalAllow) ? null : nextState
        updateMySettings(server.id, payload).then(() => {
          qc.invalidateQueries({ queryKey: ['members', serverId] })
        })
      },
    })

    items.push({ separator: true })

    if (isAdmin) {
      items.push({
        label: 'Server Settings',
        icon: 'settings',
        onClick: () => navigate(`/channels/${serverId}/settings`),
      })
    }

    /* // Copy ID is added below by default? No. */
    items.push({ separator: true })
    items.push({
      label: 'Copy ID',
      icon: 'copy',
      onClick: () => navigator.clipboard.writeText(server.id).catch(console.error),
    })

    setContextMenu({ x: rect.left, y: rect.bottom, slideDown: true, width: rect.width, items })
  }

  function handleHeaderClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (contextMenu?.slideDown) {
      setContextMenu(null)
      return
    }
    // We reuse the full context menu logic for the click as well
    handleHeaderContextMenu(e)
  }

  function handleCreateInvite() {
    setInviteModalOpen(true)
  }

  async function handleCreateChannel() {
    if (!serverId || !newChannelName.trim()) return
    try {
      await createChannel(serverId, { title: newChannelName, type: newChannelType })
      qc.invalidateQueries({ queryKey: ['channels', serverId] })
      setShowAddChannel(false)
      setNewChannelName('')
      setCreateError(null)
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? err?.message ?? 'Failed to create channel.'
      setCreateError(String(detail))
    }
  }

  async function handleCreateCategory() {
    if (!serverId || !newCategoryName.trim()) return
    try {
      await createCategory(serverId, newCategoryName.trim())
      qc.invalidateQueries({ queryKey: ['categories', serverId] })
      setShowAddCategory(false)
      setNewCategoryName('')
      setCreateError(null)
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? err?.message ?? 'Failed to create category.'
      setCreateError(String(detail))
    }
  }

  function openChannelContextMenu(e: React.MouseEvent, ch: Channel) {
    e.preventDefault()
    e.stopPropagation()
    const currentLevel = channelLevel(ch.id)
    const markReadItem: ContextMenuItem[] = (ch.type === 'text' && unreadChannels.has(ch.id)) ? [
      {
        label: 'Mark as Read',
        icon: 'check-circle',
        onClick: () => markRead(ch.id),
      },
      { separator: true },
    ] : []
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
        onClick: () => navigate(`/channels/${serverId}/channels/${ch.id}/settings`),
      },
      {
        label: 'Delete Channel',
        icon: 'trash-2',
        danger: true,
        onClick: () => setConfirmDelete({ kind: 'channel', id: ch.id, name: ch.title }),
      },
    ] : []
    const copyIdItem: ContextMenuItem = {
      label: 'Copy ID',
      icon: 'copy',
      onClick: () => { navigator.clipboard.writeText(ch.id).catch(console.error) },
    }
    const editCatItems: ContextMenuItem[] = []
    if (isAdmin && ch.category_id) {
       // Optional: could add Move to Category? Or handled via drag.
       // "Edit Channel" already covers most.
    }
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [...markReadItem, ...notifItems, { separator: true }, ...adminItems, { separator: !!adminItems.length }, copyIdItem],
    })
  }

  function openCategoryContextMenu(e: React.MouseEvent, cat: { id: string; title: string }) {
    e.preventDefault()
    e.stopPropagation()
    const items: ContextMenuItem[] = []
    
    // Admin actions
    if (isAdmin) {
      items.push({
        label: 'Edit Category',
        icon: 'edit-2',
        onClick: () => { setEditCategory(cat); setEditCategoryName(cat.title) },
      })
      items.push({
        label: 'Delete Category',
        icon: 'trash-2',
        danger: true,
        onClick: () => setConfirmDelete({ kind: 'category', id: cat.id, name: cat.title }),
      })
      items.push({ separator: true })
    }

    // Common actions
    const categoryChannels = channels.filter(c => c.category_id === cat.id)
    const hasUnread = categoryChannels.some(c => unreadChannels.has(c.id))
    const areAllMuted = categoryChannels.every(c => channelLevel(c.id) === 'mute')

    if (hasUnread) {
      items.push({
        label: 'Mark as Read',
        icon: 'check-circle',
        onClick: () => {
          categoryChannels.forEach(c => {
             if (unreadChannels.has(c.id)) markRead(c.id)
          })
        },
      })
    }

    items.push({
      label: areAllMuted ? 'Unmute Category' : 'Mute Category',
      icon: areAllMuted ? 'bell' : 'bell-off',
      onClick: () => {
         const newLevel = areAllMuted ? 'all' : 'mute'
         categoryChannels.forEach(c => setChannelLevel(c.id, newLevel))
      },
    })

    items.push({ separator: true })

    items.push({
      label: 'Copy ID',
      icon: 'copy',
      onClick: () => { navigator.clipboard.writeText(cat.id).catch(console.error) },
    })

    setContextMenu({ x: e.clientX, y: e.clientY, items })
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
  byCategory.get(null)?.forEach(ch => {
    if (hideMuted && channelLevel(ch.id) === 'mute' && !unreadChannels.has(ch.id) && ch.id !== channelId) return
    flatIds.push(`ch:${ch.id}`)
    visibleFlatIds.push(`ch:${ch.id}`)
  })
  sortedCats.forEach(cat => {
    flatIds.push(`cat:${cat.id}`)
    visibleFlatIds.push(`cat:${cat.id}`)
    byCategory.get(cat.id)?.forEach(ch => {
      if (hideMuted && channelLevel(ch.id) === 'mute' && !unreadChannels.has(ch.id) && ch.id !== channelId) return
      flatIds.push(`ch:${ch.id}`)
      if (!collapsedCats.has(cat.id)) visibleFlatIds.push(`ch:${ch.id}`)
    })
    visibleFlatIds.push(`spacer:${cat.id}`) // Add spacer after each category for dropping to Root
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
    setDragOverId(null)
    if (!over || active.id === over.id || !serverId) return
    const activeStr = active.id as string
    const overStr = over.id as string

    if (activeStr.startsWith('cat:')) {
      // Reorder categories
      const activeCatId = activeStr.replace('cat:', '')
      const catIds = sortedCats.map(c => c.id)
      const oldIdx = catIds.indexOf(activeCatId)
      let newIdx = -1

      if (overStr.startsWith('cat:')) {
        newIdx = catIds.indexOf(overStr.replace('cat:', ''))
      } else if (overStr.startsWith('ch:')) {
        const targetChId = overStr.replace('ch:', '')
        const targetCh = channels.find(c => c.id === targetChId)
        if (targetCh) {
          if (targetCh.category_id) {
            newIdx = catIds.indexOf(targetCh.category_id)
          } else {
            // Treat root channels as being "before" all categories
            newIdx = 0
          }
        }
      }

      if (oldIdx !== -1 && newIdx !== -1) {
        const newCatIds = arrayMove(catIds, oldIdx, newIdx)
        const catUpdates = newCatIds.map((id, pos) => ({ id, position: pos }))
        qc.setQueryData<typeof categories>(['categories', serverId], old =>
          old?.map(c => ({ ...c, position: catUpdates.find(u => u.id === c.id)?.position ?? c.position }))
            .sort((a, b) => a.position - b.position) ?? []
        )
        reorderCategories(serverId, catUpdates).catch(() => {
          qc.invalidateQueries({ queryKey: ['categories', serverId] })
        })
      }
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
      // Re-scan layout
      for (const id of newFlatIds) {
        if (id.startsWith('cat:')) {
          currentCatId = id.replace('cat:', '')
        } else if (id.startsWith('spacer:')) {
            // Spacer forces next items to be root until new category
            currentCatId = null
        } else if (id.startsWith('ch:')) {
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
    <div className="flex flex-col h-full overflow-hidden bg-sp-channels">
      {/* Server name header */}
      <div
        className="px-4 font-bold border-b border-sp-divider/50 flex items-center justify-between cursor-pointer hover:bg-sp-hover/60 transition-colors select-none h-12 shrink-0"
        onMouseDown={e => { if (e.button === 0) handleHeaderClick(e) }}
        onContextMenu={handleHeaderContextMenu}
      >
        <span className="truncate">{server?.title ?? 'Server'}</span>
        <Icon name="chevron-down" size={16} className="text-sp-muted shrink-0" />
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
            onDragOver={e => setDragOverId(e.over?.id as string ?? null)}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={visibleFlatIds} strategy={verticalListSortingStrategy}>
              {(byCategory.get(null) ?? []).map(ch => (
                <SortableChannelItem key={`ch:${ch.id}`} id={`ch:${ch.id}`}>
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
              ))}
              {sortedCats.map(cat => {
                const catId = `cat:${cat.id}`
                const collapsed = collapsedCats.has(cat.id)
                const catChannels = byCategory.get(cat.id) ?? []
                
                // Determine if we should visually expand the category container
                let expandContainer = false
                if (dragId && dragId.startsWith('ch:') && dragOverId) {
                   const isOverThisCat = dragOverId === catId || catChannels.some(c => `ch:${c.id}` === dragOverId)
                   if (isOverThisCat) expandContainer = true
                }

                return (
                  <Fragment key={cat.id}>
                    <div className={`mx-2 mt-2 rounded-lg border border-dashed border-sp-divider/40 transition-all duration-200 ${expandContainer ? 'pb-8 border-sp-menutext/50 bg-sp-text/5' : ''}`}>
                      <SortableCatHeader
                        id={catId}
                        title={cat.title}
                        collapsed={collapsed}
                        onToggle={() => toggleCat(cat.id)}
                        onContextMenu={e => openCategoryContextMenu(e, cat)}
                      />
                      {(!collapsed || expandContainer) && catChannels.length > 0 && (
                        <div className={`transition-all duration-200 ${collapsed ? 'opacity-50' : 'pb-1'}`}>
                          {catChannels.map(ch => (
                            <SortableChannelItem key={`ch:${ch.id}`} id={`ch:${ch.id}`}>
                              {/* If collapsed but expanding for drag, hide non-targets? No, we show them so we can drop between them */}
                              <div className={collapsed && !expandContainer ? 'hidden' : ''}>
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
                              </div>
                            </SortableChannelItem>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Add spacer only if NOT expanded to avoid double gap if dragging internally? No, always needed for root drop */}
                    <SortableSpacer id={`spacer:${cat.id}`} />
                  </Fragment>
                )
              })}
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {dragId && (() => {
                if (dragId.startsWith('ch:')) {
                  const ch = channels.find(c => c.id === dragId.replace('ch:', ''))
                  if (!ch) return null
                  return (
                    <div className="bg-sp-input/90 rounded px-2 py-1 mx-1 flex items-center gap-1.5 text-sm text-sp-text shadow-xl cursor-grabbing">
                      <Icon name={ch.type === 'voice' ? 'headphones' : 'hash'} size={16} className="opacity-60 shrink-0" />
                      <span className="truncate">{ch.title}</span>
                    </div>
                  )
                }
                if (dragId.startsWith('cat:')) {
                  const cat = categories.find(c => c.id === dragId.replace('cat:', ''))
                  if (!cat) return null
                  return (
                    <div className="px-3 py-1 text-xs font-semibold uppercase text-sp-mention tracking-wider bg-sp-hover rounded-full shadow-sp-2 cursor-grabbing">
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
            {(byCategory.get(null) ?? []).map(ch => (
              <ChannelRow
                key={ch.id}
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
            ))}
            {sortedCats.map(cat => {
              const collapsed = collapsedCats.has(cat.id)
              const catChannels = byCategory.get(cat.id) ?? []
              return (
                <div key={cat.id} className="mx-2 mt-2 rounded-lg border border-dashed border-sp-divider/40">
                  <button
                    onClick={() => toggleCat(cat.id)}
                    onContextMenu={e => openCategoryContextMenu(e, cat)}
                    className="w-full flex items-center gap-1 px-3 py-2 text-xs font-semibold uppercase text-sp-muted tracking-wider hover:text-sp-text transition-colors select-none"
                  >
                    <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} className="shrink-0" />
                    {cat.title}
                  </button>
                  {!collapsed && catChannels.length > 0 && (
                    <div className="pb-1">
                      {catChannels.map(ch => (
                        <ChannelRow
                          key={ch.id}
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
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>



      {/* User panel Moved to AppShell */}
      {/* Edit category modal */}
      {editCategory && (
        <Portal>
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setEditCategory(null)}>
          <div className="bg-sp-popup border border-sp-divider/50 rounded-sp-xl p-6 w-80 shadow-sp-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Edit Category</h2>
            <label className="text-xs font-semibold uppercase text-sp-muted block mb-1">Category Name</label>
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
              <button className="btn flex-1 bg-sp-input hover:bg-sp-input/70" onClick={() => setEditCategory(null)}>
                Cancel
              </button>
            </div>
          </div>
          </div>
        </Portal>
      )}

      {/* Add category modal */}
      {showAddCategory && (
        <Portal>
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => { setShowAddCategory(false); setCreateError(null) }}>
          <div className="bg-sp-popup border border-sp-divider/50 rounded-sp-xl p-6 w-80 shadow-sp-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Create Category</h2>
            {createError && <div className="mb-2 text-sm text-red-400">{createError}</div>}
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
        </Portal>
      )}

      {/* Add channel modal */}
      {showAddChannel && (
        <Portal>
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => { setShowAddChannel(false); setCreateError(null) }}>
          <div className="bg-sp-popup border border-sp-divider/50 rounded-sp-xl p-6 w-80 shadow-sp-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Add Channel</h2>
            {createError && <div className="mb-2 text-sm text-red-400">{createError}</div>}
            <div className="flex gap-2 mb-3">
              {(['text', 'voice'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setNewChannelType(t)}
                  className={`flex-1 py-1 rounded text-sm flex items-center justify-center gap-1 ${newChannelType === t ? 'bg-sp-mention text-white' : 'bg-sp-input text-sp-text'}`}
                >
                  {t === 'text'
                    ? <><Icon name="hash" size={14} /> Text</>
                    : <><Icon name="headphones" size={14} /> Voice</>}
                </button>
              ))}
            </div>
            <input
              autoFocus
              className="input w-full mb-3"
              placeholder="channel-name"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateChannel() }}
            />
            <button className="btn w-full" onClick={handleCreateChannel} disabled={!newChannelName.trim()}>
              Create Channel
            </button>
          </div>
          </div>
        </Portal>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
          slideDown={contextMenu.slideDown}
          width={contextMenu.width}
        />
      )}

      {/* Invite modal */}
      {inviteModalOpen && serverId && (
        <Portal>
          <InviteModal
          serverId={serverId}
          serverName={server?.title ?? 'Server'}
          onClose={() => setInviteModalOpen(false)}
        />
        </Portal>
      )}
      {/* Delete confirmation modal */}
      {confirmDelete && (
        <Portal>
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setConfirmDelete(null)}>
          <div className="bg-sp-popup border border-sp-divider/50 rounded-sp-xl p-6 w-96 shadow-sp-3" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-2">
              Delete {confirmDelete.kind === 'channel' ? 'Channel' : 'Category'}
            </h2>
            <p className="text-sp-muted text-sm mb-1">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-sp-text">
                {confirmDelete.kind === 'channel' ? '# ' : ''}{confirmDelete.name}
              </span>?
            </p>
            {confirmDelete.kind === 'category' && (
              <p className="text-yellow-400 text-xs mt-1 mb-4">
                Channels inside this category will <strong>not</strong> be deleted — they will become uncategorised.
              </p>
            )}
            {confirmDelete.kind === 'channel' && (
              <p className="text-red-400 text-xs mt-1 mb-4">This action cannot be undone.</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                className="px-4 py-2 rounded-full text-sm text-sp-muted hover:text-sp-text bg-sp-input hover:bg-sp-hover transition-colors"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-full text-sm font-semibold text-white bg-sp-danger hover:bg-red-500 transition-colors"
                onClick={async () => {
                  if (!serverId) return
                  const target = confirmDelete
                  setConfirmDelete(null)
                  if (target.kind === 'channel') {
                    await deleteChannel(serverId, target.id)
                    qc.invalidateQueries({ queryKey: ['channels', serverId] })
                    if (target.id === channelId) navigate(`/channels/${serverId}`, { replace: true })
                  } else {
                    await deleteCategory(serverId, target.id)
                    qc.invalidateQueries({ queryKey: ['categories', serverId] })
                    qc.invalidateQueries({ queryKey: ['channels', serverId] })
                  }
                }}
              >
                Delete
              </button>
            </div>
          </div>
          </div>
        </Portal>
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
    setLastChannel(serverId, channel.id)
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
            custom_status: null,
            status: 'offline' as const,
            preferred_status: 'offline' as const,
            created_at: '',
            banner: null,
            pronouns: null,
            dm_permission: 'everyone' as const,
            hide_status: false,
            avatar_decoration: null,
          }
        }
        return { user: user as User, isSelf, isSpeaking: p.is_speaking ?? false, isMuted: p.is_muted, isDeafened: p.is_deafened, isSharingScreen: p.is_sharing_screen ?? false }
      })
    : []

  return (
    <>
    <div>
      <button
        onClick={handleClick}
        onContextMenu={onContextMenu}
        className={`w-full flex items-center gap-2 px-3 py-1.5 mx-1 rounded-lg text-sm transition-all duration-200 ease-out select-none
          ${active 
            ? 'bg-sp-hover font-bold text-sp-text shadow-sm' 
            : hasUnread
              ? 'text-sp-text font-semibold hover:bg-sp-hover/60 hover:-translate-x-1'
              : 'text-sp-muted hover:bg-sp-hover/60 hover:text-sp-text hover:-translate-x-1'}`}
      >
        <Icon name={isVoice ? 'headphones' : 'hash'} size={18} className={`shrink-0 transition-colors ${active ? 'text-sp-primary' : 'opacity-70'}`} />
        <span className="truncate">{channel.title}</span>
        {isMuted && (
          <span className="ml-1 inline-flex items-center justify-center leading-none text-sp-muted shrink-0" title="Notifications muted">
            <Icon name="bell-off" size={14} className="align-middle" />
          </span>
        )}
        {hasUnread && !active && (
          <span className="ml-auto w-2 h-2 rounded-full bg-sp-mention shrink-0" aria-label="Unread messages" />
        )}
      </button>

      {/* Voice participants */}
      {participantUsers.length > 0 && (
        <div className="ml-4 mb-1 space-y-0.5">
          {participantUsers.map(({ user: u, isSelf, isSpeaking, isMuted, isDeafened, isSharingScreen }) => (
            <div 
              key={u.id} 
              className="flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs text-sp-muted hover:bg-sp-channel-hover cursor-pointer"
              onClick={(e) => handleUserClick(e, u.id)}
            >
              <AvatarWithStatus
                user={u}
                size={20}
                className={`rounded-full transition-all ${isSpeaking ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-sp-sidebar' : ''}`}
              />
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
      className={`group flex items-center gap-1 px-3 py-2 text-xs font-semibold uppercase text-sp-muted tracking-wider select-none cursor-pointer hover:text-sp-text transition-colors ${isDragging ? 'opacity-0' : ''}`}
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

function SortableSpacer({ id }: { id: string }) {
  const { setNodeRef, isOver } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      className={`mx-2 rounded transition-all ${isOver ? 'h-8 bg-sp-mention/20 my-1' : 'h-2 -my-1 bg-transparent hover:h-4 hover:bg-sp-hover/10'}`}
    />
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
        className="absolute right-1.5 top-4 z-10 opacity-0 group-hover:opacity-40 hover:!opacity-80 cursor-grab active:cursor-grabbing text-sp-muted transition-opacity"
      >
        <Icon name="menu" size={11} />
      </span>
      {children}
    </div>
  )
}
