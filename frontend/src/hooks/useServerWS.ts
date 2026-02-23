import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWebSocket } from './useWebSocket'
import { useUnreadChannels } from '../contexts/UnreadChannelsContext'
import { useSoundManager } from './useSoundManager'
import { activeServerIds } from './serverRegistry'
import { useNotificationSettings } from './useNotificationSettings'
import type { Channel, Category, Member, VoiceParticipant } from '../api/types'

/** Voice presence query key for a given server. */
const vpKey = (serverId: string | null) => ['voicePresence', serverId] as const

/**
 * Subscribes to the server-level WebSocket and keeps channel/category
 * caches up-to-date in real time for all connected clients.
 */
export function useServerWS(serverId: string | null, currentChannelId?: string) {
  const qc = useQueryClient()
  const { notifyMessage, notifyServer } = useUnreadChannels()
  const { playSound } = useSoundManager()
  const { channelLevel } = useNotificationSettings()

  // Register/unregister so useUnreadDMs knows not to double-notify for this server.
  useEffect(() => {
    if (!serverId) return
    activeServerIds.add(serverId)
    return () => { activeServerIds.delete(serverId) }
  }, [serverId])

  useWebSocket(serverId ? `/ws/servers/${serverId}` : '', {
    enabled: serverId !== null,
    onOpen() {
      // Refetch presence on every (re)connect so events missed during the gap are recovered
      qc.invalidateQueries({ queryKey: vpKey(serverId) })
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
          // Cancel any in-flight voice presence refetch so it doesn't
          // overwrite this real-time update with stale REST data.
          void qc.cancelQueries({ queryKey: vpKey(serverId) })
          qc.setQueryData<Record<string, VoiceParticipant[]>>(vpKey(serverId), (old = {}) => {
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
          void qc.cancelQueries({ queryKey: vpKey(serverId) })
          qc.setQueryData<Record<string, VoiceParticipant[]>>(vpKey(serverId), (old = {}) => {
            const updated = (old[channelId] ?? []).filter((p) => p.user_id !== user_id)
            if (updated.length === 0) {
              const { [channelId]: _removed, ...rest } = old
              return rest
            }
            return { ...old, [channelId]: updated }
          })
          break
        }
        case 'voice.state_changed': {
          const channelId = msg.channel_id as string
          const participant = msg.data as VoiceParticipant
          void qc.cancelQueries({ queryKey: vpKey(serverId) })
          qc.setQueryData<Record<string, VoiceParticipant[]>>(vpKey(serverId), (old = {}) => {
            const existing = old[channelId]
            if (!existing) return old
            return {
              ...old,
              [channelId]: existing.map((p) =>
                p.user_id === participant.user_id ? participant : p,
              ),
            }
          })
          break
        }
        case 'channel.message': {
          const { channel_id } = msg.data as { channel_id: string }
          // Only notify if the user isn't already viewing this channel.
          // This fires for ALL server members via broadcast_server — including the sender.
          // The sender is in `currentChannelId`, so the check correctly skips them.
          if (channel_id !== currentChannelId && channelLevel(channel_id) !== 'mute') {
            notifyMessage(channel_id)
            if (serverId) notifyServer(serverId)
            playSound('notificationSound')
          }
          break
        }
        case 'channels.reordered': {
          const updated = msg.data as Channel[]
          qc.setQueryData<Channel[]>(['channels', serverId], () => updated)
          break
        }
        case 'categories.reordered': {
          const updated = msg.data as Category[]
          qc.setQueryData<Category[]>(['categories', serverId], () => updated)
          break
        }
        case 'user.status_changed': {
          const { user_id, status } = msg.data as { user_id: string; status: string }
          qc.setQueryData<Member[]>(['members', serverId], (old = []) =>
            old.map(m =>
              m.user.id === user_id ? { ...m, user: { ...m.user, status: status as Member['user']['status'] } } : m
            )
          )
          break
        }
        case 'server.member_joined':
        case 'server.member_left':
        case 'server.member_kicked':
        case 'server.member_updated':
        case 'role.assigned':
        case 'role.removed':
          qc.invalidateQueries({ queryKey: ['members', serverId] })
          if (msg.type === 'server.member_joined') {
            // A join increments an invite's uses counter
            qc.invalidateQueries({ queryKey: ['invites', serverId] })
          }
          break
        case 'invite.created':
        case 'invite.deleted':
          qc.invalidateQueries({ queryKey: ['invites', serverId] })
          break
        case 'role.created':
        case 'role.updated':
        case 'role.deleted':
          qc.invalidateQueries({ queryKey: ['roles', serverId] })
          qc.invalidateQueries({ queryKey: ['members', serverId] })
          break
        default:
          break
      }
    },
  })
}
