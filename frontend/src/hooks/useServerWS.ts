import { useQueryClient } from '@tanstack/react-query'
import { useWebSocket } from './useWebSocket'
import type { Channel, VoiceParticipant } from '../api/types'

/**
 * Subscribes to the server-level WebSocket and keeps channel/category
 * caches up-to-date in real time for all connected clients.
 */
export function useServerWS(serverId: string | null) {
  const qc = useQueryClient()

  useWebSocket(serverId ? `/ws/servers/${serverId}` : '', {
    enabled: serverId !== null,
    onOpen() {
      // Refetch presence on every (re)connect so events missed during the gap are recovered
      qc.invalidateQueries({ queryKey: ['voicePresence', serverId] })
    },
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
        case 'voice.user_joined': {
          const channelId = msg.channel_id as string
          const participant = msg.data as VoiceParticipant
          qc.setQueryData<Record<string, VoiceParticipant[]>>(['voicePresence', serverId], (old = {}) => {
            const existing = old[channelId] ?? []
            // Avoid duplicates
            if (existing.some((p) => p.user_id === participant.user_id)) return old
            return { ...old, [channelId]: [...existing, participant] }
          })
          break
        }
        case 'voice.user_left': {
          const channelId = msg.channel_id as string
          const { user_id } = msg.data as { user_id: string }
          qc.setQueryData<Record<string, VoiceParticipant[]>>(['voicePresence', serverId], (old = {}) => {
            const updated = (old[channelId] ?? []).filter((p) => p.user_id !== user_id)
            if (updated.length === 0) {
              const { [channelId]: _removed, ...rest } = old
              return rest
            }
            return { ...old, [channelId]: updated }
          })
          break
        }
        default:
          // member / role events – just refetch members
          qc.invalidateQueries({ queryKey: ['members', serverId] })
      }
    },
  })
}
