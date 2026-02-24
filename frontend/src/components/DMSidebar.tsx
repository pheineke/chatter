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
          const isMuted = channelLevel(conv.channel_id) === 'mute'

          function openConvContextMenu(e: MouseEvent<HTMLButtonElement>) {
            e.preventDefault()
            e.stopPropagation()
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              items: [
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
              style={{ '--avatar-ring': isActive ? '#383a40' : '#121214', '--avatar-ring-hover': isActive ? '#383a40' : '#25262a' } as React.CSSProperties}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors
                ${isActive
                  ? 'bg-discord-input text-white'
                  : 'text-discord-muted hover:bg-discord-input/50 hover:text-discord-text'}`}
            >
              <AvatarWithStatus user={conv.other_user} size={32} />
              <span className={`flex-1 text-left truncate ${hasUnread ? 'text-white font-medium' : ''}`}>
                {conv.other_user.username}
              </span>
              {isMuted && (
                <span className="text-discord-muted" title="Notifications muted">
                  <Icon name="bell-off" size={14} />
                </span>
              )}
              {hasUnread && !isMuted && (
                <span className="w-2 h-2 rounded-full bg-white shrink-0" aria-label="Unread messages" />
              )}
            </button>
          )
        })}
        {conversations.length === 0 && (
          <p className="text-xs text-discord-muted px-2 py-1">No conversations yet.</p>
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
