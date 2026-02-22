import { useParams } from 'react-router-dom'
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getChannels } from '../api/channels'
import { getPins } from '../api/messages'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import { MemberSidebar } from './MemberSidebar'
import { PinnedMessagesPanel } from './PinnedMessagesPanel'
import { VoiceGridPane } from './VoiceGridPane'
import { Icon } from './Icon'
import type { VoiceSession } from '../pages/AppShell'
import type { Message } from '../api/types'
import { useUnreadChannels } from '../contexts/UnreadChannelsContext'
import { useChannelWS } from '../hooks/useChannelWS'
import { Linkified } from '../utils/linkify'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  voiceSession: VoiceSession | null
  onJoinVoice: (s: VoiceSession) => void
  onLeaveVoice: () => void
}

export function MessagePane({ voiceSession, onJoinVoice, onLeaveVoice }: Props) {
  const { serverId, channelId } = useParams<{ serverId: string; channelId: string }>()
  const [showMembers, setShowMembers] = useState(true)
  const [showPins, setShowPins] = useState(false)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const scrollToMessageRef = useRef<((id: string) => void) | null>(null)
  const { markRead, markServerRead } = useUnreadChannels()
  const qc = useQueryClient()

  // Mark channel + server as read when the user opens a channel
  useEffect(() => {
    if (channelId) markRead(channelId)
    if (serverId) markServerRead(serverId)
  }, [channelId, serverId, markRead, markServerRead])

  const handleReply = useCallback((msg: Message) => setReplyTo(msg), [])
  const handleCancelReply = useCallback(() => setReplyTo(null), [])
  const handleRegisterScrollTo = useCallback((fn: (id: string) => void) => {
    scrollToMessageRef.current = fn
  }, [])

  const { user } = useAuth()

  // Real-time channel events (WS lifted here so sendTyping/typingUsers can be passed to children)
  const { typingUsers, sendTyping } = useChannelWS(channelId ?? null)

  // Pinned messages query + WS event handling
  const { data: pins = [] } = useQuery({
    queryKey: ['pins', channelId],
    queryFn: () => getPins(channelId!),
    enabled: !!channelId,
    staleTime: 60_000,
  })
  const pinnedIds = useMemo(() => new Set(pins.map((p) => p.message.id)), [pins])

  // Invalidate pins cache on WS pin/unpin events
  useEffect(() => {
    const handler = (e: Event) => {
      const { type, channelId: eid } = (e as CustomEvent).detail
      if ((type === 'message.pinned' || type === 'message.unpinned') && eid === channelId) {
        qc.invalidateQueries({ queryKey: ['pins', channelId] })
      }
    }
    window.addEventListener('channel-ws-event', handler)
    return () => window.removeEventListener('channel-ws-event', handler)
  }, [channelId, qc])

  const { data: channels = [], isLoading: channelsLoading } = useQuery({
    queryKey: ['channels', serverId],
    queryFn: () => getChannels(serverId!),
    enabled: !!serverId,
  })

  const channel = channels.find((c) => c.id === channelId)

  if (!channelId) {
    return (
      <div className="flex-1 flex items-center justify-center text-discord-muted">
        Select a channel to start chatting.
      </div>
    )
  }

  // If we're already in a voice session for this channel, show the grid immediately
  // (don't wait for the channels query — we know it's a voice channel).
  if (voiceSession?.channelId === channelId) {
    return <VoiceGridPane session={voiceSession} onLeave={onLeaveVoice} />
  }

  // Still loading channel list — don't render a text-channel layout for a voice channel
  if (channelsLoading && !channel) {
    return (
      <div className="flex-1 flex items-center justify-center text-discord-muted">
        <Icon name="loader" size={24} className="animate-spin" />
      </div>
    )
  }

  if (channel?.type === 'voice') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-discord-muted">
        <div className="text-5xl">🔊</div>
        <h2 className="text-xl font-bold text-discord-text">{channel.title}</h2>
        <p className="text-sm">Voice Channel</p>
        <button
          onClick={() => onJoinVoice({ channelId: channel.id, channelName: channel.title, serverId: serverId! })}
          className="btn"
        >
          Join Voice
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Channel header */}
      <div className="flex items-center gap-2 px-4 border-b border-black/20 shadow-sm shrink-0 h-12 min-w-0">
        <span className="text-discord-muted font-semibold shrink-0">#</span>
        <span className="font-bold shrink-0">{channel?.title ?? channelId}</span>
        {channel?.description && (
          <>
            <div className="w-px h-5 bg-white/20 shrink-0 mx-1" />
            <span
              className="text-sm text-discord-muted truncate"
              title={channel.description}
            >
              <Linkified text={channel.description} noMentions />
            </span>
          </>
        )}
        <div className="flex-1" />
        {/* Pins toggle */}
        <button
          onClick={() => setShowPins(v => !v)}
          title={showPins ? 'Close pins' : 'Pinned messages'}
          className={`p-1.5 rounded transition-colors shrink-0 ${showPins ? 'text-discord-text' : 'text-discord-muted hover:text-discord-text'}`}
        >
          <Icon name="pin" size={20} />
          {pinnedIds.size > 0 && (
            <span className="ml-0.5 text-xs text-discord-muted">{pinnedIds.size}</span>
          )}
        </button>
        {/* Members toggle */}
        <button
          onClick={() => setShowMembers(v => !v)}
          title="Toggle member list"
          className={`p-1.5 rounded transition-colors shrink-0 ${showMembers ? 'text-discord-text' : 'text-discord-muted hover:text-discord-text'}`}
        >
          <Icon name="people" size={20} />
        </button>
      </div>

      {/* Body: messages + optional sidebars */}
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Messages */}
          <MessageList
            channelId={channelId}
            onReply={handleReply}
            onRegisterScrollTo={handleRegisterScrollTo}
            pinnedIds={pinnedIds}
          />

          {/* Typing indicator */}
          {typingUsers.length > 0 && (
            <div className="px-4 py-1 text-xs text-discord-muted flex items-center gap-1 select-none shrink-0">
              <span className="flex gap-0.5 items-center">
                <span className="w-1 h-1 bg-discord-muted rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1 h-1 bg-discord-muted rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1 h-1 bg-discord-muted rounded-full animate-bounce [animation-delay:300ms]" />
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

          {/* Input */}
          <MessageInput
            channelId={channelId}
            serverId={serverId}
            placeholder={`Message #${channel?.title ?? channelId}`}
            replyTo={replyTo}
            onCancelReply={handleCancelReply}
            onTyping={sendTyping}
            slowmodeDelay={channel?.slowmode_delay ?? 0}
          />
        </div>

        {/* Pinned messages panel */}
        {showPins && (
          <PinnedMessagesPanel
            channelId={channelId}
            onScrollToMessage={(id) => scrollToMessageRef.current?.(id)}
            onClose={() => setShowPins(false)}
          />
        )}

        {showMembers && serverId && <MemberSidebar serverId={serverId} />}
      </div>
    </div>
  )
}
