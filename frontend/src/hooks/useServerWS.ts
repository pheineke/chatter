import { useQueryClient } from '@tanstack/react-query'
import { useWebSocket } from './useWebSocket'
import type { Channel } from '../api/types'

/**
 * Subscribes to the server-level WebSocket and keeps channel/category
 * caches up-to-date in real time for all connected clients.
 */
export function useServerWS(serverId: string | null) {
  const qc = useQueryClient()

  useWebSocket(serverId ? `/ws/servers/${serverId}` : '', {
    enabled: serverId !== null,
    onMessage(msg) {
      switch (msg.type) {
        case 'channel.created': {
          const created = msg.data as Channel
          qc.setQueryData<Channel[]>(['channels', serverId], (old = []) => [...old, created])
          break
        }
        case 'channel.updated': {
          const updated = msg.data as Channel
          qc.setQueryData<Channel[]>(['channels', serverId], (old = []) =>
            old.map((c) => (c.id === updated.id ? updated : c)),
          )
          break
        }
        case 'channel.deleted': {
          const { channel_id } = msg.data as { channel_id: string }
          qc.setQueryData<Channel[]>(['channels', serverId], (old = []) =>
            old.filter((c) => c.id !== channel_id),
          )
          break
        }
        default:
          // member / role events – just refetch members
          qc.invalidateQueries({ queryKey: ['members', serverId] })
      }
    },
  })
}
