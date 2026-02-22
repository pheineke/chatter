import { useQueryClient } from '@tanstack/react-query'
import { useState, useCallback, useRef } from 'react'
import type { InfiniteData } from '@tanstack/react-query'
import { useWebSocket } from './useWebSocket'
import type { Message } from '../api/types'

type InfMessages = InfiniteData<Message[]>

export interface TypingUser {
  user_id: string
  username: string
}

const TYPING_EXPIRE_MS = 4_000  // clear indicator 4 s after last event

/** Map every message across all pages */
function mapPages(data: InfMessages, fn: (m: Message) => Message): InfMessages {
  return { ...data, pages: data.pages.map((page) => page.map(fn)) }
}

/** Filter every message across all pages */
function filterPages(data: InfMessages, pred: (m: Message) => boolean): InfMessages {
  return { ...data, pages: data.pages.map((page) => page.filter(pred)) }
}

/**
 * Subscribes to the channel WebSocket and keeps the React Query
 * `['messages', channelId]` cache up-to-date in real time.
 *
 * Returns:
 *  - `typingUsers`: users currently typing in this channel
 *  - `sendTyping`:  call this when the local user is typing
 */
export function useChannelWS(channelId: string | null) {
  const qc = useQueryClient()
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const removeTyping = useCallback((userId: string) => {
    const t = timers.current.get(userId)
    if (t) { clearTimeout(t); timers.current.delete(userId) }
    setTypingUsers((prev) => prev.filter((u) => u.user_id !== userId))
  }, [])

  const { send } = useWebSocket(channelId ? `/ws/channels/${channelId}` : '', {
    enabled: channelId !== null,
    onMessage(msg) {
      const key = ['messages', channelId] as const

      switch (msg.type) {
        case 'message.created': {
          const newMsg = msg.data as Message
          // Clear typing indicator for the sender immediately
          removeTyping(newMsg.author.id)
          qc.setQueryData<InfMessages>(key, (old) => {
            if (!old) return old
            // Append to pages[0] (the latest batch)
            const [first, ...rest] = old.pages
            return { ...old, pages: [[...(first ?? []), newMsg], ...rest] }
          })
          break
        }
        case 'message.updated': {
          const updated = msg.data as Message
          qc.setQueryData<InfMessages>(key, (old) => {
            if (!old) return old
            return mapPages(old, (m) => (m.id === updated.id ? updated : m))
          })
          break
        }
        case 'message.deleted': {
          const { message_id } = msg.data as { message_id: string }
          qc.setQueryData<InfMessages>(key, (old) => {
            if (!old) return old
            return filterPages(old, (m) => m.id !== message_id)
          })
          break
        }
        case 'reaction.added': {
          const { message_id, user_id, emoji } = msg.data as { message_id: string; user_id: string; emoji: string }
          qc.setQueryData<InfMessages>(key, (old) => {
            if (!old) return old
            return mapPages(old, (m) => {
              if (m.id !== message_id) return m
              const already = m.reactions.some((r) => r.user_id === user_id && r.emoji === emoji)
              if (already) return m
              return { ...m, reactions: [...m.reactions, { id: `${user_id}-${emoji}`, user_id, emoji }] }
            })
          })
          break
        }
        case 'reaction.removed': {
          const { message_id, user_id, emoji } = msg.data as { message_id: string; user_id: string; emoji: string }
          qc.setQueryData<InfMessages>(key, (old) => {
            if (!old) return old
            return mapPages(old, (m) => {
              if (m.id !== message_id) return m
              return { ...m, reactions: m.reactions.filter((r) => !(r.user_id === user_id && r.emoji === emoji)) }
            })
          })
          break
        }
        case 'typing.start': {
          const { user_id, username } = msg.data as { user_id: string; username: string }
          setTypingUsers((prev) => {
            if (prev.some((u) => u.user_id === user_id)) return prev
            return [...prev, { user_id, username }]
          })
          // Reset auto-expire timer
          const existing = timers.current.get(user_id)
          if (existing) clearTimeout(existing)
          timers.current.set(user_id, setTimeout(() => removeTyping(user_id), TYPING_EXPIRE_MS))
          break
        }
        case 'message.pinned':
        case 'message.unpinned': {
          // Bubble up to MessagePane via custom DOM event so it can invalidate pins query
          window.dispatchEvent(new CustomEvent('channel-ws-event', {
            detail: { type: msg.type, channelId },
          }))
          break
        }
      }
    },
  })

  const sendTyping = useCallback(() => {
    send({ type: 'typing' })
  }, [send])

  return { typingUsers, sendTyping }
}
