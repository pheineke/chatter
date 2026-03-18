import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMatch } from 'react-router-dom'
import { useWebSocket } from './useWebSocket'
import { useAuth } from '../contexts/AuthContext'
import { useUnreadChannels } from '../contexts/UnreadChannelsContext'
import { useSoundManager } from './useSoundManager'
import { activeServerIds } from './serverRegistry'
import { useNotificationSettings } from './useNotificationSettings'
import { useDesktopNotificationsContext } from '../contexts/DesktopNotificationsContext'
import { useE2EE } from '../contexts/E2EEContext'
import { getConversations } from '../api/dms'
import type { Channel, DMConversation, Friend, Message, UserStatus } from '../api/types'

/**
 * Always-on hook (call from AppShell) that:
 *  - Keeps /ws/me open regardless of active route
 *  - Patches the dmConversations cache on new messages
 *  - Returns the count of unread DM conversations
 */
export function useUnreadDMs(): number {
  const qc = useQueryClient()
  const { user, updateUser } = useAuth()
  const e2ee = useE2EE()
  const { notifyMessage, notifyServer } = useUnreadChannels()
  const { playSound } = useSoundManager()
  const { channelLevel, serverLevel } = useNotificationSettings()
  const { notify } = useDesktopNotificationsContext()
  const match = useMatch('/channels/@me/:dmUserId')
  const channelMatch = useMatch('/channels/:serverId/:channelId')
  const activeDmUserId = match?.params.dmUserId ?? null
  const activeChannelId = channelMatch?.params.channelId ?? null
  const activeServerId = channelMatch?.params.serverId ?? null

  // useQuery makes this component re-render whenever the cache changes
  const { data: conversations = [] } = useQuery<DMConversation[]>({
    queryKey: ['dmConversations'],
    queryFn: getConversations,
    staleTime: 30_000,
  })

  const { send } = useWebSocket('/ws/me', {
    onMessage(msg) {
      if (msg.type === 'friend_request.received') {
        qc.invalidateQueries({ queryKey: ['friendRequests'] })
        playSound('notificationSound')
        notify({
          title: 'Friend request received',
          body: 'Someone sent you a friend request',
          channelPath: '/channels/@me',
        })
        return
      }
      if (msg.type === 'friend_request.accepted') {
        qc.invalidateQueries({ queryKey: ['friends'] })
        qc.invalidateQueries({ queryKey: ['friendRequests'] })
        playSound('notificationSound')
        notify({
          title: 'Friend request accepted',
          body: 'You are now friends',
          channelPath: '/channels/@me',
        })
        return
      }
      if (msg.type === 'friend_request.declined' || msg.type === 'friend_request.cancelled') {
        qc.invalidateQueries({ queryKey: ['friendRequests'] })
        return
      }
      if (msg.type === 'friend.removed') {
        qc.invalidateQueries({ queryKey: ['friends'] })
        return
      }

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

      if (msg.type === 'user.updated') {
        const updatedUser = msg.data as Friend['user']
        if (user && updatedUser.id === user.id) {
          updateUser(updatedUser)
        }
        qc.setQueryData<Friend[]>(['friends'], old =>
          old?.map(f =>
            f.user.id === updatedUser.id ? { ...f, user: { ...f.user, ...updatedUser } } : f
          )
        )
        qc.setQueryData<DMConversation[]>(['dmConversations'], old =>
          old?.map(c =>
            c.other_user.id === updatedUser.id
              ? { ...c, other_user: { ...c.other_user, ...updatedUser } }
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
        if (serverLevel(server_id) === 'mute') return
        notifyMessage(channel_id, server_id)
        notifyServer(server_id)
        playSound('notificationSound')
        // Desktop notification: look up channel name from cache
        const channels = qc.getQueryData<Channel[]>(['channels', server_id]) ?? []
        const ch = channels.find(c => c.id === channel_id)
        notify({
          title: ch ? `#${ch.title}` : 'New message',
          body: 'You have a new message',
          channelId: channel_id,
          channelPath: `/channels/${server_id}/${channel_id}`,
        })
        return
      }

      if (msg.type === 'dm.read_updated') {
        const { channel_id, last_read_at } = msg.data as { channel_id: string; last_read_at: string }
        qc.setQueryData<DMConversation[]>(['dmConversations'], old =>
          old?.map(c =>
            c.channel_id === channel_id
              ? { ...c, last_read_at, unread_count: 0 }
              : c
          )
        )
        return
      }

      if (msg.type !== 'message.created') return
      const data = msg.data as Message
      const isActiveChannel = data.channel_id === conversations.find(c => c.other_user.id === activeDmUserId)?.channel_id

      // Play notification sound if the user isn't currently viewing this DM conversation
      if (data.author.id !== user?.id && !isActiveChannel) {
        if (channelLevel(data.channel_id) === 'mute') return
        playSound('notificationSound')

        // Desktop notification for DMs (async decryption if needed)
        ;(async () => {
          let body = data.content
          // Attempt decryption if encrypted and we have the tools
          if (data.is_encrypted && data.content && data.nonce && e2ee.isEnabled) {
            try {
              const plain = await e2ee.decryptFromUser(data.author.id, data.content, data.nonce)
              body = plain ?? 'Encrypted Message'
            } catch {
              body = 'Encrypted Message'
            }
          }

          const truncated = body
            ? (body.length > 100 ? body.slice(0, 100) + '\u2026' : body)
            : 'Sent an attachment'

          notify({
            title: data.author.username,
            body: truncated,
            icon: data.author.avatar ? `/api/static/${data.author.avatar}` : undefined,
            channelId: data.channel_id,
            channelPath: `/channels/@me/${data.author.id}`,
          })
        })()
      }

      qc.setQueryData<DMConversation[]>(['dmConversations'], old => {
        if (!old) return old
        if (!old.some(c => c.channel_id === data.channel_id)) {
          // New conversation started by someone else
          qc.invalidateQueries({ queryKey: ['dmConversations'] })
          return old
        }
        return old.map(c => {
          if (c.channel_id !== data.channel_id) return c
          // Increment unread count if we are not the author and not currently viewing
          const isMe = data.author.id === user?.id
          const isViewing = c.other_user.id === activeDmUserId
          const inc = (!isMe && !isViewing) ? 1 : 0
          return {
            ...c,
            last_message_at: data.created_at,
            unread_count: (c.unread_count || 0) + inc,
          }
        })
      })
    },
  })

  // Heartbeat: server expects a ping at least every 60 s; we send every 30 s.
  useEffect(() => {
    const id = setInterval(() => send({ type: 'ping' }), 30_000)
    return () => clearInterval(id)
  }, [send])

  return conversations.reduce((acc, conv) => {
    const isActive = conv.other_user.id === activeDmUserId
    const lr = conv.last_read_at
    const unread = !!conv.last_message_at && (!lr || conv.last_message_at > lr) && !isActive
    return acc + (unread ? 1 : 0)
  }, 0)
}
