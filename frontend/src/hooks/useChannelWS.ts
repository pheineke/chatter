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
        case 'reaction.added':
        case 'reaction.removed': {
          // Trigger a refetch for simplicity – reactions are high-frequency but small
          qc.invalidateQueries({ queryKey: key })
          break
        }
      }
    },
  })
}
