import { useParams } from 'react-router-dom'
import { useState, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDMChannel } from '../api/dms'
import { getUser } from '../api/users'
import { useAuth } from '../contexts/AuthContext'
import { useChannelWS } from '../hooks/useChannelWS'
import { UserAvatar } from './UserAvatar'
import { StatusIndicator } from './StatusIndicator'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import type { Message } from '../api/types'

export function DMPane() {
  const { dmUserId } = useParams<{ dmUserId: string }>()
  const { user } = useAuth()
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const handleReply = useCallback((msg: Message) => setReplyTo(msg), [])
  const handleCancelReply = useCallback(() => setReplyTo(null), [])
  const scrollToMessageRef = useRef<((id: string) => void) | null>(null)
  const handleRegisterScrollTo = useCallback((fn: (id: string) => void) => {
    scrollToMessageRef.current = fn
  }, [])
  const isSelf = !!user && user.id === dmUserId

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

  const { typingUsers, sendTyping } = useChannelWS(dmChannel?.channel_id ?? null)

  if (!dmUserId) {
    return <div className="flex-1 flex items-center justify-center text-discord-muted">Select a conversation</div>
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-black/20 shadow-sm shrink-0">
        <div className="relative">
          <UserAvatar user={otherUser ?? null} size={32} />
          {otherUser && (
            <span className="absolute -bottom-0.5 -right-0.5">
              <StatusIndicator status={otherUser.status} size={10} />
            </span>
          )}
        </div>
        <span className="font-bold">{otherUser?.username ?? '…'}</span>
      </div>

      {/* Messages */}
      {isLoading || !dmChannel ? (
        <div className="flex-1 flex items-center justify-center text-discord-muted text-sm">
          {isLoading ? 'Loading…' : 'Could not load conversation.'}
        </div>
      ) : (
        <>
          <MessageList
            channelId={dmChannel.channel_id}
            onReply={handleReply}
            onRegisterScrollTo={handleRegisterScrollTo}
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

          {!isSelf && (
            <MessageInput
              channelId={dmChannel.channel_id}
              placeholder={`Message ${otherUser?.username ?? '…'}`}
              replyTo={replyTo}
              onCancelReply={handleCancelReply}
              onTyping={sendTyping}
            />
          )}
        </>
      )}
    </div>
  )
}

