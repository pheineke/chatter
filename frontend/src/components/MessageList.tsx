import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMessages } from '../api/messages'
import { useChannelWS } from '../hooks/useChannelWS'
import { MessageBubble } from './MessageBubble'
import type { Message } from '../api/types'

const COMPACT_THRESHOLD_MS = 7 * 60 * 1000 // 7 minutes

interface Props {
  channelId: string
}

function isSameAuthorAndRecent(a: Message, b: Message): boolean {
  return (
    a.author.id === b.author.id &&
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime() < COMPACT_THRESHOLD_MS
  )
}

export function MessageList({ channelId }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['messages', channelId],
    queryFn: () => getMessages(channelId),
    enabled: !!channelId,
    staleTime: 30_000,
  })

  // Real-time updates
  useChannelWS(channelId)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-discord-muted">
        Loading messages…
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-end pb-4 text-discord-muted text-sm">
        <div className="text-4xl mb-2">👋</div>
        <p>This is the beginning of the channel.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto py-2">
      {messages.map((msg, idx) => {
        const prev = idx > 0 ? messages[idx - 1] : null
        const compact = !!prev && isSameAuthorAndRecent(prev, msg)
        return (
          <MessageBubble
            key={msg.id}
            message={msg}
            channelId={channelId}
            compact={compact}
          />
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
