import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useMatch } from 'react-router-dom'
import { useWebSocket } from './useWebSocket'
import { getConversations } from '../api/dms'
import type { DMConversation, Message } from '../api/types'

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
  const match = useMatch('/channels/@me/:dmUserId')
  const activeDmUserId = match?.params.dmUserId ?? null
  const [lastRead, setLastRead] = useState<Record<string, string>>(loadLastRead)

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

  useWebSocket('/ws/me', {
    onMessage(msg) {
      if (msg.type !== 'message.created') return
      const data = msg.data as Message

      qc.setQueryData<DMConversation[]>(['dmConversations'], old => {
        if (!old) return old
        const exists = old.some(c => c.channel_id === data.channel_id)
        if (!exists) {
          // New conversation — refetch the list
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

  // Ensure conversations are loaded even if DMSidebar hasn't mounted yet
  const conversations = qc.getQueryState<DMConversation[]>(['dmConversations'])?.data ?? []

  // Pre-fetch if not loaded
  useEffect(() => {
    if (!qc.getQueryState(['dmConversations'])?.data) {
      qc.prefetchQuery({ queryKey: ['dmConversations'], queryFn: getConversations })
    }
  }, [qc])

  return conversations.some(conv => {
    const isActive = conv.other_user.id === activeDmUserId
    const lr = lastRead[conv.channel_id]
    return !!conv.last_message_at && (!lr || conv.last_message_at > lr) && !isActive
  })
}
