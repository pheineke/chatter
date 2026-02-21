import { useQueryClient } from '@tanstack/react-query'
import { useWebSocket } from './useWebSocket'
import type { Message } from '../api/types'

/**
 * Subscribes to the channel WebSocket and keeps the React Query
 * `['messages', channelId]` cache up-to-date in real time.
 */
export function useChannelWS(channelId: string | null) {
  const qc = useQueryClient()

  useWebSocket(channelId ? `/ws/channels/${channelId}` : '', {
    enabled: channelId !== null,
    onMessage(msg) {
      const key = ['messages', channelId] as const

      switch (msg.type) {
        case 'message.created': {
          const newMsg = msg.data as Message
          qc.setQueryData<Message[]>(key, (old = []) => [...old, newMsg])
          break
        }
        case 'message.updated': {
          const updated = msg.data as Message
          qc.setQueryData<Message[]>(key, (old = []) =>
            old.map((m) => (m.id === updated.id ? updated : m)),
          )
          break
        }
        case 'message.deleted': {
          const { message_id } = msg.data as { message_id: string }
          qc.setQueryData<Message[]>(key, (old = []) => old.filter((m) => m.id !== message_id))
          break
        }
        case 'reaction.added': {
          const { message_id, user_id, emoji } = msg.data as { message_id: string; user_id: string; emoji: string }
          qc.setQueryData<Message[]>(key, (old = []) =>
            old.map((m) => {
              if (m.id !== message_id) return m
              // Avoid duplicates (e.g. own optimistic mutation already added it)
              const already = m.reactions.some((r) => r.user_id === user_id && r.emoji === emoji)
              if (already) return m
              return {
                ...m,
                reactions: [...m.reactions, { id: `${user_id}-${emoji}`, user_id, emoji }],
              }
            }),
          )
          break
        }
        case 'reaction.removed': {
          const { message_id, user_id, emoji } = msg.data as { message_id: string; user_id: string; emoji: string }
          qc.setQueryData<Message[]>(key, (old = []) =>
            old.map((m) => {
              if (m.id !== message_id) return m
              return {
                ...m,
                reactions: m.reactions.filter((r) => !(r.user_id === user_id && r.emoji === emoji)),
              }
            }),
          )
          break
        }
      }
    },
  })
}
