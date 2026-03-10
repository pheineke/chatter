import { useQuery } from '@tanstack/react-query'
import { useNavigate, useMatch } from 'react-router-dom'
import { useState, useEffect } from 'react'
import type { MouseEvent } from 'react'
import { getConversations } from '../api/dms'
import { updateMe } from '../api/users'
import { useAuth } from '../contexts/AuthContext'
import { useNotificationSettings } from '../hooks/useNotificationSettings'
import { AvatarWithStatus } from './AvatarWithStatus'
import { Icon } from './Icon'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuItem } from './ContextMenu'
import type { DMConversation } from '../api/types'
import { cacheConversations, getCachedConversations } from '../db/dmCache'

const LAST_READ_KEY = 'dmLastRead'

function loadLastRead(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LAST_READ_KEY) ?? '{}') } catch { return {} }
}

function saveLastRead(data: Record<string, string>) {
  localStorage.setItem(LAST_READ_KEY, JSON.stringify(data))
}

interface DMSidebarProps {}

export function DMSidebar() {
  const navigate = useNavigate()
  const { user, refreshUser } = useAuth()
  const match = useMatch('/channels/@me/:dmUserId')
  const activeDmUserId = match?.params.dmUserId ?? null
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  const [lastRead, setLastRead] = useState<Record<string, string>>(loadLastRead)
  const { channelLevel, setChannelLevel } = useNotificationSettings()
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [cachedConversations, setCachedConversations] = useState<DMConversation[]>([])

  // Track online/offline
  useEffect(() => {
    const onOnline = () => setIsOffline(false)
    const onOffline = () => {
      setIsOffline(true)
      getCachedConversations().then(setCachedConversations)
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    // Load cache immediately if already offline on mount
    if (!navigator.onLine) getCachedConversations().then(setCachedConversations)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const { data: netConversations = [] } = useQuery({
    queryKey: ['dmConversations'],
    queryFn: getConversations,
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: !isOffline,
  })

  // Mirror freshly fetched conversations to IndexedDB
  useEffect(() => {
    if (netConversations.length) cacheConversations(netConversations).catch(() => {})
  }, [netConversations])

  const conversations = isOffline ? cachedConversations : netConversations

  // Subscribe to personal WS — handled globally by useUnreadDMs in AppShell.
  // This component just reacts to cache changes already applied by that hook.

  // Mark active channel as read whenever it becomes active or new messages arrive
  useEffect(() => {
    if (!activeDmUserId) return
    const conv = conversations.find(c => c.other_user.id === activeDmUserId)
    if (!conv) return
    const now = new Date().toISOString()
    setLastRead(prev => {
      const next = { ...prev, [conv.channel_id]: now }
      saveLastRead(next)
      return next
    })
  }, [activeDmUserId, conversations])

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 text-xs font-semibold uppercase text-sp-muted tracking-wider">
        Direct Messages
      </div>
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {conversations.map(conv => {
          const isActive = conv.other_user.id === activeDmUserId
          const lr = lastRead[conv.channel_id]
          // Show unread badge if there are messages after the last read time (and not currently viewing)
          const hasUnread =
            !!conv.last_message_at && (!lr || conv.last_message_at > lr) && !isActive
          const isMuted = channelLevel(conv.channel_id) === 'mute'

          function openConvContextMenu(e: MouseEvent<HTMLButtonElement>) {
            e.preventDefault()
            e.stopPropagation()
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              items: [
                ...(hasUnread ? [{
                  label: 'Mark as Read',
                  icon: 'check-circle',
                  onClick: () => {
                    const now = new Date().toISOString()
                    setLastRead(prev => {
                      const next = { ...prev, [conv.channel_id]: now }
                      saveLastRead(next)
                      // Notify useUnreadDMs in the same tab (storage event is cross-tab only)
                      window.dispatchEvent(new StorageEvent('storage', { key: LAST_READ_KEY }))
                      return next
                    })
                  },
                }, { separator: true as const }] : []),
                {
                  label: isMuted ? 'Unmute Conversation' : 'Mute Conversation',
                  icon: isMuted ? 'bell' : 'bell-off',
                  onClick: () => setChannelLevel(conv.channel_id, isMuted ? 'all' : 'mute'),
                },
              ],
            })
          }

          return (
            <button
              key={conv.channel_id}
              onClick={() => navigate(`/channels/@me/${conv.other_user.id}`)}
              onContextMenu={openConvContextMenu}
              data-avatar-ring
              style={{ '--avatar-ring': isActive ? 'transparent' : 'transparent', '--avatar-ring-hover': 'transparent' } as React.CSSProperties}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-full text-sm transition-all
                ${isActive
                  ? 'bg-sp-mention/15 text-sp-mention font-semibold'
                  : 'text-sp-muted hover:bg-sp-channel-hover hover:text-sp-text'}`}
            >
              <AvatarWithStatus user={conv.other_user} size={32} />
              <span className={`flex-1 text-left truncate ${hasUnread ? 'text-sp-text font-semibold' : ''}`}>
                {conv.other_user.username}
              </span>
              {isMuted && (
                <span className="text-sp-muted" title="Notifications muted">
                  <Icon name="bell-off" size={14} />
                </span>
              )}
              {hasUnread && !isMuted && (
                <span className="w-2 h-2 rounded-full bg-sp-mention shrink-0" aria-label="Unread messages" />
              )}
            </button>
          )
        })}
        {conversations.length === 0 && (
          <p className="text-xs text-sp-muted px-2 py-1">No conversations yet.</p>
        )}
      </div>

      {/* User panel MOVED to AppShell */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
