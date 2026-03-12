import { useEffect, useRef, useCallback, useLayoutEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { getMessages } from '../api/messages'
import { MessageBubble } from './MessageBubble'
import { Icon } from './Icon'
import type { Message } from '../api/types'
import { cachePutMessages } from '../db/dmCache'

const COMPACT_THRESHOLD_MS = 7 * 60 * 1000 // 7 minutes
const PAGE_SIZE = 50
const ESTIMATED_ROW_HEIGHT = 92
const WINDOW_OVERSCAN = 30

interface Props {
  channelId: string
  /** If set, decrypt E2EE messages from this DM partner */
  partnerId?: string
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

export function MessageList({ channelId, partnerId, onRegisterScrollTo, onReply, pinnedIds }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const prevScrollHeight = useRef<number>(0)
  const isFirstLoad = useRef(true)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [viewport, setViewport] = useState({ scrollTop: 0, clientHeight: 0 })

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

  // Mirror DM pages to IndexedDB for offline reading.
  // We track how many pages have been persisted so we only write new ones.
  const cachedPageCount = useRef(0)
  useEffect(() => {
    if (!partnerId || !data) return
    const total = data.pages.length
    if (total <= cachedPageCount.current) return
    const newMsgs = data.pages.slice(cachedPageCount.current).flat()
    if (newMsgs.length) {
      cachePutMessages(newMsgs).catch(() => {})
      cachedPageCount.current = total
    }
  }, [data, partnerId])

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
    const node = scrollContainerRef.current
    if (!node) return
    function onScroll() {
      const current = scrollContainerRef.current
      if (!current) return
      const dist = current.scrollHeight - current.scrollTop - current.clientHeight
      setShowScrollDown(dist > 200)
      setViewport({ scrollTop: current.scrollTop, clientHeight: current.clientHeight })
    }
    setViewport({ scrollTop: node.scrollTop, clientHeight: node.clientHeight })
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const onResize = () => {
      const current = scrollContainerRef.current
      if (!current) return
      setViewport({ scrollTop: current.scrollTop, clientHeight: current.clientHeight })
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const total = messages.length
  const startIdx = Math.max(0, Math.floor(viewport.scrollTop / ESTIMATED_ROW_HEIGHT) - WINDOW_OVERSCAN)
  const endIdx = Math.min(
    total,
    Math.ceil((viewport.scrollTop + Math.max(viewport.clientHeight, 1)) / ESTIMATED_ROW_HEIGHT) + WINDOW_OVERSCAN,
  )
  const visibleMessages = messages.slice(startIdx, endIdx)
  const topSpacer = startIdx * ESTIMATED_ROW_HEIGHT
  const bottomSpacer = Math.max(0, (total - endIdx) * ESTIMATED_ROW_HEIGHT)

  const scrollToMessage = useCallback((id: string) => {
    const el = bubbleRefs.current.get(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('highlight-flash')
      setTimeout(() => el.classList.remove('highlight-flash'), 1500)
      return
    }
    const idx = messages.findIndex((m) => m.id === id)
    if (idx >= 0 && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: idx * ESTIMATED_ROW_HEIGHT, behavior: 'smooth' })
      setTimeout(() => {
        const target = bubbleRefs.current.get(id)
        if (!target) return
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        target.classList.add('highlight-flash')
        setTimeout(() => target.classList.remove('highlight-flash'), 1500)
      }, 250)
    }
  }, [messages])

  useEffect(() => {
    onRegisterScrollTo?.(scrollToMessage)
  }, [onRegisterScrollTo, scrollToMessage])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sp-muted">
        Loading messages…
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col justify-end pb-4 px-4 text-sp-muted">
        <Icon name="hash" size={72} className="mb-4 opacity-20" />
        <p className="text-2xl font-bold text-sp-text mb-1">This is the beginning of the channel.</p>
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
        <div className="flex justify-center py-3 text-sp-muted text-sm">
          Loading older messages…
        </div>
      ) : !hasNextPage ? (
        <div className="flex flex-col py-6 px-4 text-sp-muted select-none">
          <Icon name="hash" size={72} className="mb-4 opacity-20" />
          <p className="text-2xl font-bold text-sp-text mb-1">You've reached the beginning.</p>
          <p className="text-sm">That's everything in this channel.</p>
        </div>
      ) : null}

      {topSpacer > 0 && <div style={{ height: topSpacer }} />}

      {visibleMessages.map((msg, visibleIdx) => {
        const idx = startIdx + visibleIdx
        const prev = idx > 0 ? messages[idx - 1] : null
        const compact = !!prev && isSameAuthorAndRecent(prev, msg) && !msg.reply_to_id
        return (
          <div key={msg.id} ref={(el) => { if (el) bubbleRefs.current.set(msg.id, el); else bubbleRefs.current.delete(msg.id) }}>
            <MessageBubble
              message={msg}
              channelId={channelId}
              partnerId={partnerId}
              compact={compact}
              onReply={onReply}
              onScrollToMessage={scrollToMessage}
              isPinned={pinnedIds?.has(msg.id)}
            />
          </div>
        )
      })}
      {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} />}
      <div ref={bottomRef} />
      </div>

      {/* Jump to bottom pill */}
      {showScrollDown && (
        <button
          onClick={() => scrollToBottom()}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-sp-popup border border-sp-divider/60 text-sp-text text-sm font-semibold px-4 py-1.5 rounded-full shadow-sp-2 hover:bg-sp-hover transition-colors z-10 whitespace-nowrap"
        >
          <span>Jump to bottom</span>
          <Icon name="arrow-down" size={14} />
        </button>
      )}
    </div>
  )
}
