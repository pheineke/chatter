import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useMatch } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { getConversations } from '../api/dms'
import { UserAvatar } from './UserAvatar'
import { StatusIndicator } from './StatusIndicator'
import { useWebSocket } from '../hooks/useWebSocket'
import type { DMConversation, Message } from '../api/types'

const LAST_READ_KEY = 'dmLastRead'

function loadLastRead(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LAST_READ_KEY) ?? '{}') } catch { return {} }
}

function saveLastRead(data: Record<string, string>) {
  localStorage.setItem(LAST_READ_KEY, JSON.stringify(data))
}

export function DMSidebar() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const match = useMatch('/channels/@me/:dmUserId')
  const activeDmUserId = match?.params.dmUserId ?? null

  const [lastRead, setLastRead] = useState<Record<string, string>>(loadLastRead)

  const { data: conversations = [] } = useQuery({
    queryKey: ['dmConversations'],
    queryFn: getConversations,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  // Subscribe to personal WS for real-time unread badge updates
  useWebSocket('/ws/me', {
    onMessage(msg) {
      if (msg.type === 'message.created') {
        const data = msg.data as Message
        const exists = conversations.some(c => c.channel_id === data.channel_id)
        if (!exists) {
          // Potentially a brand-new DM channel; refresh the list
          qc.invalidateQueries({ queryKey: ['dmConversations'] })
          return
        }
        // Patch last_message_at so the unread dot updates without a refetch
        qc.setQueryData<DMConversation[]>(['dmConversations'], old =>
          old?.map(c =>
            c.channel_id === data.channel_id
              ? { ...c, last_message_at: data.created_at }
              : c,
          ) ?? [],
        )
      }
    },
  })

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
    </div>
  )
}
