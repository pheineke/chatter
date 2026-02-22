import { useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { getMessages } from '../api/messages'
import { MessageBubble } from './MessageBubble'
import type { Message } from '../api/types'
import type { TypingUser } from '../hooks/useChannelWS'

const COMPACT_THRESHOLD_MS = 7 * 60 * 1000 // 7 minutes
const PAGE_SIZE = 50

interface Props {
  channelId: string
  typingUsers?: TypingUser[]
  /** Called with a msg id so parent can provide scroll-to-message capability */
  onRegisterScrollTo?: (fn: (id: string) => void) => void
  /** Reply initiator passed down from MessagePane */
  onReply?: (msg: Message) => void
}

function isSameAuthorAndRecent(a: Message, b: Message): boolean {
  return (
    a.author.id === b.author.id &&
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime() < COMPACT_THRESHOLD_MS
  )
}

export function MessageList({ channelId, typingUsers = [], onRegisterScrollTo, onReply }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const prevScrollHeight = useRef<number>(0)
  const isFirstLoad = useRef(true)

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: ['messages', channelId],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      getMessages(channelId, pageParam, PAGE_SIZE),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: Message[]) =>
      lastPage.length >= PAGE_SIZE ? lastPage[0].id : undefined,
    enabled: !!channelId,
    staleTime: 30_000,
  })

  // Flatten pages: pages[0] = latest batch, pages[1] = older batch, etc.
  // Render order: oldest first → reverse the pages array then flat
  const messages: Message[] = data ? data.pages.slice().reverse().flat() : []

  // Auto-scroll to bottom on initial load and on new messages (last page grows)
  const lastPageLength = data?.pages[0]?.length ?? 0
  useEffect(() => {
    if (isFirstLoad.current && messages.length > 0) {
      isFirstLoad.current = false
      bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior })
      return
    }
    if (!isFirstLoad.current) {
      // Only auto-scroll if user is near the bottom
      const el = scrollContainerRef.current
      if (!el) return
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distFromBottom < 150) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPageLength])

  // Preserve scroll position when prepending older messages
  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el || isFetchingNextPage) return
    const diff = el.scrollHeight - prevScrollHeight.current
    if (diff > 0 && prevScrollHeight.current > 0) {
      el.scrollTop += diff
    }
    prevScrollHeight.current = 0
  })

  // Intersection observer – load older messages when scrolling to top
  const handleTopIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        prevScrollHeight.current = scrollContainerRef.current?.scrollHeight ?? 0
        fetchNextPage()
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage],
  )

  useEffect(() => {
    const sentinel = topSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(handleTopIntersect, { threshold: 0.1 })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [handleTopIntersect])

  // Expose scroll-to-message helper to parent
  const bubbleRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const scrollToMessage = useCallback((id: string) => {
    const el = bubbleRefs.current.get(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('highlight-flash')
      setTimeout(() => el.classList.remove('highlight-flash'), 1500)
    }
  }, [])

  useEffect(() => {
    onRegisterScrollTo?.(scrollToMessage)
  }, [onRegisterScrollTo, scrollToMessage])

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
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto py-2">
      {/* Top sentinel for infinite scroll upward */}
      <div ref={topSentinelRef} className="h-1" />

      {/* Spinner / beginning-of-channel indicator */}
      {isFetchingNextPage ? (
        <div className="flex justify-center py-3 text-discord-muted text-sm">
          Loading older messages…
        </div>
      ) : !hasNextPage ? (
        <div className="flex flex-col items-center py-6 text-discord-muted text-sm select-none">
          <div className="text-4xl mb-2">🏁</div>
          <p>You've reached the beginning of this channel.</p>
        </div>
      ) : null}

      {messages.map((msg, idx) => {
        const prev = idx > 0 ? messages[idx - 1] : null
        const compact = !!prev && isSameAuthorAndRecent(prev, msg) && !msg.reply_to_id
        return (
          <div key={msg.id} ref={(el) => { if (el) bubbleRefs.current.set(msg.id, el); else bubbleRefs.current.delete(msg.id) }}>
            <MessageBubble
              message={msg}
              channelId={channelId}
              compact={compact}
              onReply={onReply}
              onScrollToMessage={scrollToMessage}
            />
          </div>
        )
      })}
      <div ref={bottomRef} />

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <div className="px-4 py-1 text-xs text-discord-muted flex items-center gap-1 select-none">
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
    </div>
  )
}
