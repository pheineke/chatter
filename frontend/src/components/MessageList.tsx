import { useEffect, useRef, useCallback, useLayoutEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { getMessages } from '../api/messages'
import { MessageBubble } from './MessageBubble'
import { Icon } from './Icon'
import type { Message } from '../api/types'

const COMPACT_THRESHOLD_MS = 7 * 60 * 1000 // 7 minutes
const PAGE_SIZE = 50

interface Props {
  channelId: string
  /** Called with a msg id so parent can provide scroll-to-message capability */
  onRegisterScrollTo?: (fn: (id: string) => void) => void
  /** Reply initiator passed down from MessagePane */
  onReply?: (msg: Message) => void
  /** Set of currently pinned message IDs */
  pinnedIds?: Set<string>
}

function isSameAuthorAndRecent(a: Message, b: Message): boolean {
  return (
    a.author.id === b.author.id &&
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime() < COMPACT_THRESHOLD_MS
  )
}

export function MessageList({ channelId, onRegisterScrollTo, onReply, pinnedIds }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const prevScrollHeight = useRef<number>(0)
  const isFirstLoad = useRef(true)
  const [showScrollDown, setShowScrollDown] = useState(false)

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

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    bottomRef.current?.scrollIntoView({ behavior })
  }

  // Show/hide the "jump to bottom" pill based on scroll distance
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    function onScroll() {
      const dist = el!.scrollHeight - el!.scrollTop - el!.clientHeight
      setShowScrollDown(dist > 200)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

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
      <div className="flex-1 flex flex-col justify-end pb-4 px-4 text-discord-muted">
        <Icon name="hash" size={72} className="mb-4 opacity-20" />
        <p className="text-2xl font-bold text-discord-text mb-1">This is the beginning of the channel.</p>
        <p className="text-sm">Send a message to get things started.</p>
      </div>
    )
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={scrollContainerRef} className="h-full overflow-y-auto py-2">
        {/* Top sentinel for infinite scroll upward */}
        <div ref={topSentinelRef} className="h-1" />

      {/* Spinner / beginning-of-channel indicator */}
      {isFetchingNextPage ? (
        <div className="flex justify-center py-3 text-discord-muted text-sm">
          Loading older messages…
        </div>
      ) : !hasNextPage ? (
        <div className="flex flex-col py-6 px-4 text-discord-muted select-none">
          <Icon name="hash" size={72} className="mb-4 opacity-20" />
          <p className="text-2xl font-bold text-discord-text mb-1">You've reached the beginning.</p>
          <p className="text-sm">That's everything in this channel.</p>
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
              isPinned={pinnedIds?.has(msg.id)}
            />
          </div>
        )
      })}
      <div ref={bottomRef} />
      </div>

      {/* Jump to bottom pill */}
      {showScrollDown && (
        <button
          onClick={() => scrollToBottom()}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-discord-sidebar border border-white/10 text-discord-text text-sm font-semibold px-4 py-1.5 rounded-full shadow-xl hover:bg-discord-input transition-colors z-10 whitespace-nowrap"
        >
          <span>Jump to bottom</span>
          <Icon name="arrow-down" size={14} />
        </button>
      )}
    </div>
  )
}
