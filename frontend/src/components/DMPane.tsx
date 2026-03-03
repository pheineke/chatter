import { useParams } from 'react-router-dom'
import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import { getDMChannel } from '../api/dms'
import { getUser } from '../api/users'
import { getMessages, sendMessage } from '../api/messages'
import { useAuth } from '../contexts/AuthContext'
import { useChannelWS } from '../hooks/useChannelWS'
import { AvatarWithStatus } from './AvatarWithStatus'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import { Icon } from './Icon'
import type { Message } from '../api/types'
import { useE2EE } from '../contexts/E2EEContext'
import {
  getCachedMessages,
  cachePutMessages,
  getLastCachedMessageId,
  outboxEnqueue,
  outboxGetForChannel,
  outboxGetAll,
  outboxRemove,
  type OutboxMessage,
} from '../db/dmCache'

export function DMPane({ onOpenNav }: { onOpenNav?: () => void }) {
  const { dmUserId } = useParams<{ dmUserId: string }>()
  const { user } = useAuth()
  const qc = useQueryClient()
  const e2ee = useE2EE()
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [partnerFingerprint, setPartnerFingerprint] = useState<string | null>(null)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [cachedMsgs, setCachedMsgs] = useState<Message[]>([])
  const [outboxMsgs, setOutboxMsgs] = useState<OutboxMessage[]>([])
  const handleReply = useCallback((msg: Message) => setReplyTo(msg), [])
  const handleCancelReply = useCallback(() => setReplyTo(null), [])
  const scrollToMessageRef = useRef<((id: string) => void) | null>(null)
  const handleRegisterScrollTo = useCallback((fn: (id: string) => void) => {
    scrollToMessageRef.current = fn
  }, [])
  const isSelf = !!user && user.id === dmUserId

  // Fetch partner's E2EE fingerprint for display in header
  useEffect(() => {
    if (!dmUserId || isSelf || !e2ee.isEnabled) { setPartnerFingerprint(null); return }
    let cancelled = false
    e2ee.getPartnerFingerprint(dmUserId).then(fp => { if (!cancelled) setPartnerFingerprint(fp) })
    return () => { cancelled = true }
  }, [dmUserId, isSelf, e2ee.isEnabled])

  // Track online / offline transitions
  useEffect(() => {
    const onOnline = () => setIsOffline(false)
    const onOffline = () => setIsOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const { data: otherUser } = useQuery({
    queryKey: ['user', dmUserId],
    queryFn: () => getUser(dmUserId!),
    enabled: !!dmUserId,
  })

  const { data: dmChannel, isLoading } = useQuery({
    queryKey: ['dmChannel', dmUserId],
    queryFn: () => getDMChannel(dmUserId!),
    enabled: !!dmUserId && !isSelf,
    staleTime: Infinity, // channel ID never changes for a pair
  })

  // When going offline, load cached messages + pending outbox for this channel
  useEffect(() => {
    if (!isOffline || !dmChannel) return
    getCachedMessages(dmChannel.channel_id).then(setCachedMsgs)
    outboxGetForChannel(dmChannel.channel_id).then(setOutboxMsgs)
  }, [isOffline, dmChannel?.channel_id])

  // Gap-sync + outbox flush when WS reconnects
  const handleReconnect = useCallback(async () => {
    if (!dmChannel) return
    // 1. Flush outbox in order
    const allOutbox = await outboxGetAll()
    for (const item of allOutbox) {
      try {
        await sendMessage(item.channelId, item.content)
        await outboxRemove(item.localId)
        setOutboxMsgs((prev) => prev.filter((m) => m.localId !== item.localId))
      } catch {
        // Leave it in the outbox to retry on the next reconnect
      }
    }
    // 2. Gap-sync: fetch messages we missed while offline
    const lastId = await getLastCachedMessageId(dmChannel.channel_id)
    if (!lastId) return
    try {
      const newMsgs = await getMessages(dmChannel.channel_id, undefined, 50, lastId)
      if (!newMsgs.length) return
      await cachePutMessages(newMsgs)
      // Merge into TanStack Query infinite cache
      qc.setQueryData<InfiniteData<Message[]>>(['messages', dmChannel.channel_id], (old) => {
        if (!old) return old
        const [first, ...rest] = old.pages
        const existingIds = new Set((first ?? []).map((m) => m.id))
        const novel = newMsgs.filter((m) => !existingIds.has(m.id))
        if (!novel.length) return old
        return { ...old, pages: [[...(first ?? []), ...novel], ...rest] }
      })
    } catch {
      // Silently fail — WS events will cover any remaining gap
    }
  }, [dmChannel, qc])

  // Enqueue a message to the outbox when offline
  const handleOfflineSubmit = useCallback(async (content: string) => {
    if (!dmChannel) return
    const item: OutboxMessage = {
      localId: crypto.randomUUID(),
      channelId: dmChannel.channel_id,
      content,
      created_at: new Date().toISOString(),
    }
    await outboxEnqueue(item)
    setOutboxMsgs((prev) => [...prev, item])
  }, [dmChannel])

  const { typingUsers, sendTyping } = useChannelWS(dmChannel?.channel_id ?? null, {
    isDM: !isSelf,
    onReconnect: handleReconnect,
  })

  if (!dmUserId) {
    return <div className="flex-1 flex items-center justify-center text-sp-muted">Select a conversation</div>
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-black/20 shadow-sm shrink-0">
        {onOpenNav && (
          <button
            className="md:hidden p-1 -ml-1 text-sp-muted hover:text-sp-text shrink-0"
            onClick={onOpenNav}
            aria-label="Open navigation"
          >
            <Icon name="menu" size={22} />
          </button>
        )}
        <AvatarWithStatus user={otherUser ?? null} size={32} ringColor="#1a1a1e" />
        <span className="font-bold">{otherUser?.username ?? '…'}</span>
        {partnerFingerprint && (
          <span
            className="ml-1 flex items-center gap-1 text-xs text-green-400 font-mono bg-green-400/10 px-2 py-0.5 rounded cursor-help shrink-0"
            title={`E2EE fingerprint: ${partnerFingerprint}`}
          >
            <Icon name="lock-closed" size={11} />
            {partnerFingerprint.split(' ').slice(0, 4).join(' ')}…
          </span>
        )}
      </div>

      {/* Messages */}
      {isLoading || !dmChannel ? (
        <div className="flex-1 flex items-center justify-center text-sp-muted text-sm">
          {isLoading ? 'Loading…' : 'Could not load conversation.'}
        </div>
      ) : isOffline ? (
        /* ── Offline view: cached messages + queued outbox ── */
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 bg-orange-500/10 border-b border-orange-500/20 px-4 py-2 text-xs text-orange-300 shrink-0">
            <Icon name="cloud-offline" size={13} className="shrink-0" />
            You're offline — showing {cachedMsgs.length} cached message{cachedMsgs.length !== 1 ? 's' : ''}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5">
            {cachedMsgs.length === 0 ? (
              <p className="text-center text-sp-muted text-sm mt-8">No cached messages for this conversation.</p>
            ) : (
              cachedMsgs.map((msg) => (
                <div key={msg.id} className="text-sm py-0.5">
                  <span className="font-semibold text-sp-text mr-2">{msg.author.username}</span>
                  <span className="text-sp-muted text-xs mr-2">
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span>{msg.content}</span>
                </div>
              ))
            )}
            {outboxMsgs.map((item) => (
              <div key={item.localId} className="text-sm py-0.5 opacity-50 flex items-center gap-2">
                <span className="font-semibold text-sp-text mr-2">{user?.username}</span>
                <span className="italic">{item.content}</span>
                <span className="text-xs text-orange-400 ml-auto shrink-0">queued</span>
              </div>
            ))}
          </div>
          {!isSelf && (
            <MessageInput
              channelId={dmChannel.channel_id}
              partnerId={dmUserId}
              placeholder={`Message ${otherUser?.username ?? '…'}`}
              isOffline
              onOfflineSubmit={handleOfflineSubmit}
            />
          )}
        </div>
      ) : (
        <>
          <MessageList
            channelId={dmChannel.channel_id}
            partnerId={dmUserId}
            onReply={handleReply}
            onRegisterScrollTo={handleRegisterScrollTo}
          />

          {/* Typing indicator */}
          {typingUsers.length > 0 && (
            <div className="px-4 py-1 text-xs text-sp-muted flex items-center gap-1 select-none shrink-0">
              <span className="flex gap-0.5 items-center">
                <span className="w-1 h-1 bg-sp-muted rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1 h-1 bg-sp-muted rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1 h-1 bg-sp-muted rounded-full animate-bounce [animation-delay:300ms]" />
              </span>
              <span>
                {typingUsers.length === 1
                  ? <><strong>{typingUsers[0].username}</strong> is typing…</>
                  : typingUsers.length === 2
                    ? <><strong>{typingUsers[0].username}</strong> and <strong>{typingUsers[1].username}</strong> are typing…</>
                    : <><strong>Several people</strong> are typing…</>
                }
              </span>
            </div>
          )}

          {!isSelf && (
            <MessageInput
              channelId={dmChannel.channel_id}
              partnerId={dmUserId}
              placeholder={`Message ${otherUser?.username ?? '…'}`}
              replyTo={replyTo}
              onCancelReply={handleCancelReply}
              onTyping={sendTyping}
              isOffline={isOffline}
              onOfflineSubmit={handleOfflineSubmit}
            />
          )}
        </>
      )}
    </div>
  )
}

