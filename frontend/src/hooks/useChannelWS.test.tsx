import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import type { Message } from '../api/types'
import { useChannelWS } from './useChannelWS'

// Capture the onMessage callback so we can fire fake WS events in tests
type OnMessage = (msg: { type: string; data: unknown }) => void
let capturedOnMessage: OnMessage | null = null
const mockSend = vi.fn()

vi.mock('./useWebSocket', () => ({
  useWebSocket: (_url: string, opts: { onMessage: OnMessage; enabled?: boolean }) => {
    if (opts.enabled !== false) {
      capturedOnMessage = opts.onMessage
    }
    return { send: mockSend }
  },
}))

// ---- helpers ----

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    channel_id: 'chan-1',
    author: { id: 'u1', username: 'alice', status: 'online', avatar: null, banner: null, bio: '', display_name: null, preferred_status: null, hide_status: false },
    content: 'hello',
    created_at: '2024-01-01T00:00:00Z',
    edited_at: null,
    is_pinned: false,
    reply_to: null,
    reply_to_id: null,
    reactions: [],
    attachments: [],
    ...overrides,
  }
}

function makeInfiniteData(pages: Message[][]): InfiniteData<Message[]> {
  return {
    pages,
    pageParams: pages.map((_, i) => i),
  }
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

let qc: QueryClient
const CHAN = 'chan-1'

beforeEach(() => {
  vi.clearAllMocks()
  capturedOnMessage = null
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
})

function renderWS() {
  return renderHook(() => useChannelWS(CHAN), { wrapper: wrapper(qc) })
}

function fire(type: string, data: unknown) {
  act(() => {
    capturedOnMessage?.({ type, data })
  })
}

describe('message.created', () => {
  it('appends a new message to pages[0]', () => {
    const initial = makeInfiniteData([[makeMsg({ id: 'msg-0' })]])
    qc.setQueryData(['messages', CHAN], initial)

    renderWS()
    const newMsg = makeMsg({ id: 'msg-1' })
    fire('message.created', newMsg)

    const data = qc.getQueryData<InfiniteData<Message[]>>(['messages', CHAN])!
    expect(data.pages[0]).toHaveLength(2)
    expect(data.pages[0][1].id).toBe('msg-1')
  })
})

describe('message.updated', () => {
  it('replaces the matching message', () => {
    const initial = makeInfiniteData([[makeMsg({ id: 'msg-1', content: 'original' })]])
    qc.setQueryData(['messages', CHAN], initial)

    renderWS()
    fire('message.updated', makeMsg({ id: 'msg-1', content: 'edited', edited_at: '2024-01-02T00:00:00Z' }))

    const data = qc.getQueryData<InfiniteData<Message[]>>(['messages', CHAN])!
    expect(data.pages[0][0].content).toBe('edited')
  })

  it('leaves other messages untouched', () => {
    const initial = makeInfiniteData([[makeMsg({ id: 'msg-1' }), makeMsg({ id: 'msg-2', content: 'other' })]])
    qc.setQueryData(['messages', CHAN], initial)

    renderWS()
    fire('message.updated', makeMsg({ id: 'msg-1', content: 'changed' }))

    const data = qc.getQueryData<InfiniteData<Message[]>>(['messages', CHAN])!
    expect(data.pages[0][1].content).toBe('other')
  })
})

describe('message.deleted', () => {
  it('filters out the deleted message', () => {
    const initial = makeInfiniteData([[makeMsg({ id: 'msg-1' }), makeMsg({ id: 'msg-2' })]])
    qc.setQueryData(['messages', CHAN], initial)

    renderWS()
    fire('message.deleted', { message_id: 'msg-1' })

    const data = qc.getQueryData<InfiniteData<Message[]>>(['messages', CHAN])!
    expect(data.pages[0]).toHaveLength(1)
    expect(data.pages[0][0].id).toBe('msg-2')
  })
})

describe('reaction.added', () => {
  it('appends reaction to the correct message', () => {
    const initial = makeInfiniteData([[makeMsg({ id: 'msg-1', reactions: [] })]])
    qc.setQueryData(['messages', CHAN], initial)

    renderWS()
    fire('reaction.added', { message_id: 'msg-1', user_id: 'u2', emoji: '👍' })

    const data = qc.getQueryData<InfiniteData<Message[]>>(['messages', CHAN])!
    expect(data.pages[0][0].reactions).toHaveLength(1)
    expect(data.pages[0][0].reactions[0].emoji).toBe('👍')
  })

  it('does not add a duplicate reaction', () => {
    const existing = { id: 'u2-👍', user_id: 'u2', emoji: '👍' }
    const initial = makeInfiniteData([[makeMsg({ id: 'msg-1', reactions: [existing] })]])
    qc.setQueryData(['messages', CHAN], initial)

    renderWS()
    fire('reaction.added', { message_id: 'msg-1', user_id: 'u2', emoji: '👍' })

    const data = qc.getQueryData<InfiniteData<Message[]>>(['messages', CHAN])!
    expect(data.pages[0][0].reactions).toHaveLength(1)
  })
})

describe('reaction.removed', () => {
  it('removes the matching reaction', () => {
    const existing = { id: 'u2-👍', user_id: 'u2', emoji: '👍' }
    const initial = makeInfiniteData([[makeMsg({ id: 'msg-1', reactions: [existing] })]])
    qc.setQueryData(['messages', CHAN], initial)

    renderWS()
    fire('reaction.removed', { message_id: 'msg-1', user_id: 'u2', emoji: '👍' })

    const data = qc.getQueryData<InfiniteData<Message[]>>(['messages', CHAN])!
    expect(data.pages[0][0].reactions).toHaveLength(0)
  })
})

describe('typing.start', () => {
  it('adds a user to typingUsers', () => {
    const { result } = renderWS()
    fire('typing.start', { user_id: 'u2', username: 'bob' })
    expect(result.current.typingUsers).toHaveLength(1)
    expect(result.current.typingUsers[0].username).toBe('bob')
  })

  it('does not duplicate an already-typing user', () => {
    const { result } = renderWS()
    fire('typing.start', { user_id: 'u2', username: 'bob' })
    fire('typing.start', { user_id: 'u2', username: 'bob' })
    expect(result.current.typingUsers).toHaveLength(1)
  })
})

describe('sendTyping', () => {
  it('calls send with type: typing', () => {
    const { result } = renderWS()
    act(() => { result.current.sendTyping() })
    expect(mockSend).toHaveBeenCalledWith({ type: 'typing' })
  })
})

describe('disabled when channelId is null', () => {
  it('does not subscribe when channelId is null', () => {
    renderHook(() => useChannelWS(null), { wrapper: wrapper(qc) })
    expect(capturedOnMessage).toBeNull()
  })
})
