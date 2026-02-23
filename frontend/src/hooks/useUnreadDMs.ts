import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMatch } from 'react-router-dom'
import { useWebSocket } from './useWebSocket'
import { useAuth } from '../contexts/AuthContext'
import { useUnreadChannels } from '../contexts/UnreadChannelsContext'
import { useSoundManager } from './useSoundManager'
import { activeServerIds } from './serverRegistry'
import { useNotificationSettings } from './useNotificationSettings'
import { getConversations } from '../api/dms'
import type { DMConversation, Friend, Message, UserStatus } from '../api/types'

const LAST_READ_KEY = 'dmLastRead'

function loadLastRead(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LAST_READ_KEY) ?? '{}') } catch { return {} }
}

/**
 * Always-on hook (call from AppShell) that:
 *  - Keeps /ws/me open regardless of active route
 *  - Patches the dmConversations cache on new messages
 *  - Returns whether any DM conversation has unread messages
 */
export function useUnreadDMs(): boolean {
  const qc = useQueryClient()
  const { user, updateUser } = useAuth()
  const { notifyMessage, notifyServer } = useUnreadChannels()
  const { playSound } = useSoundManager()
  const { channelLevel } = useNotificationSettings()
  const match = useMatch('/channels/@me/:dmUserId')
  const channelMatch = useMatch('/channels/:serverId/:channelId')
  const activeDmUserId = match?.params.dmUserId ?? null
  const activeChannelId = channelMatch?.params.channelId ?? null
  const activeServerId = channelMatch?.params.serverId ?? null
  const [lastRead, setLastRead] = useState<Record<string, string>>(loadLastRead)

  // useQuery makes this component re-render whenever the cache changes
  const { data: conversations = [] } = useQuery<DMConversation[]>({
    queryKey: ['dmConversations'],
    queryFn: getConversations,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  // Re-sync lastRead from localStorage whenever it changes (DMSidebar writes it)
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === LAST_READ_KEY) setLastRead(loadLastRead())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Also sync whenever the active DM changes (same-tab writes don't fire storage event)
  useEffect(() => {
    setLastRead(loadLastRead())
  }, [activeDmUserId])

  const { send } = useWebSocket('/ws/me', {
    onMessage(msg) {
      if (msg.type === 'user.status_changed') {
        const { user_id, status } = msg.data as { user_id: string; status: UserStatus }
        // If this is our own status being restored after a reconnect, patch AuthContext
        if (user && user_id === user.id) {
          updateUser({ status })
        }
        // Patch friends list
        qc.setQueryData<Friend[]>(['friends'], old =>
          old?.map(f =>
            f.user.id === user_id ? { ...f, user: { ...f.user, status } } : f
          )
        )
        // Patch DM conversation list (status dot in DM sidebar)
        qc.setQueryData<DMConversation[]>(['dmConversations'], old =>
          old?.map(c =>
            c.other_user.id === user_id
              ? { ...c, other_user: { ...c.other_user, status } }
              : c
          )
        )
        return
      }

      if (msg.type === 'channel.message') {
        const { channel_id, server_id } = msg.data as { channel_id: string; server_id: string }
        // If the user has an active server WS for this server, useServerWS already
        // handles the unread indicator and sound — skip here to avoid double-notification
        // and to prevent the sender from getting a ping on their own message.
        if (activeServerIds.has(server_id)) return
        // Fallback for users not currently subscribed to the server WS
        // (e.g. viewing a different server or the DM page).
        if (channel_id === activeChannelId) return
        if (channelLevel(channel_id) === 'mute') return
        notifyMessage(channel_id)
        notifyServer(server_id)
        playSound('notificationSound')
        return
      }

      if (msg.type !== 'message.created') return
      const data = msg.data as Message

      // Play notification sound if the user isn't currently viewing this DM conversation
      const activeDmChannelId = conversations.find(c => c.other_user.id === activeDmUserId)?.channel_id
      if (data.author.id !== user?.id && data.channel_id !== activeDmChannelId) {
        playSound('notificationSound')
      }

      qc.setQueryData<DMConversation[]>(['dmConversations'], old => {
        if (!old) return old
        const exists = old.some(c => c.channel_id === data.channel_id)
        if (!exists) {
          qc.invalidateQueries({ queryKey: ['dmConversations'] })
          return old
        }
        return old.map(c =>
          c.channel_id === data.channel_id
            ? { ...c, last_message_at: data.created_at }
            : c,
        )
      })
    },
  })

  // Heartbeat: server expects a ping at least every 60 s; we send every 30 s.
  useEffect(() => {
    const id = setInterval(() => send({ type: 'ping' }), 30_000)
    return () => clearInterval(id)
  }, [send])

  return conversations.some(conv => {
    const isActive = conv.other_user.id === activeDmUserId
    const lr = lastRead[conv.channel_id]
    return !!conv.last_message_at && (!lr || conv.last_message_at > lr) && !isActive
  })
}
