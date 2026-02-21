import { useQuery } from '@tanstack/react-query'
import { useNavigate, useMatch } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { getConversations } from '../api/dms'
import { updateMe } from '../api/users'
import { useAuth } from '../contexts/AuthContext'
import { UserAvatar } from './UserAvatar'
import { StatusIndicator } from './StatusIndicator'
import { Icon } from './Icon'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuItem } from './ContextMenu'
import type { DMConversation } from '../api/types'

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

  const { data: conversations = [] } = useQuery({
    queryKey: ['dmConversations'],
    queryFn: getConversations,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

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
      <div className="px-3 py-3 text-xs font-semibold uppercase text-discord-muted tracking-wider">
        Direct Messages
      </div>
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {conversations.map(conv => {
          const isActive = conv.other_user.id === activeDmUserId
          const lr = lastRead[conv.channel_id]
          // Show unread badge if there are messages after the last read time (and not currently viewing)
          const hasUnread =
            !!conv.last_message_at && (!lr || conv.last_message_at > lr) && !isActive

          return (
            <button
              key={conv.channel_id}
              onClick={() => navigate(`/channels/@me/${conv.other_user.id}`)}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors
                ${isActive
                  ? 'bg-discord-input text-white'
                  : 'text-discord-muted hover:bg-discord-input/50 hover:text-discord-text'}`}
            >
              <div className="relative shrink-0">
                <UserAvatar user={conv.other_user} size={32} />
                <span className="absolute -bottom-0.5 -right-0.5">
                  <StatusIndicator status={conv.other_user.status} size={10} />
                </span>
              </div>
              <span className={`flex-1 text-left truncate ${hasUnread ? 'text-white font-medium' : ''}`}>
                {conv.other_user.username}
              </span>
              {hasUnread && (
                <span className="w-2 h-2 rounded-full bg-white shrink-0" aria-label="Unread messages" />
              )}
            </button>
          )
        })}
        {conversations.length === 0 && (
          <p className="text-xs text-discord-muted px-2 py-1">No conversations yet.</p>
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
              { label: 'Online',         value: 'online',  icon: 'ellipse' },
              { label: 'Away',           value: 'away',    icon: 'time' },
              { label: 'Do Not Disturb', value: 'busy',    icon: 'remove-circle' },
              { label: 'Offline',        value: 'offline', icon: 'ellipse' },
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
