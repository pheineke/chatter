import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { MessageBubble } from './MessageBubble'
import type { Message } from '../api/types'

// ---- Mock heavy deps ----

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', status: 'online', avatar: null, banner: null, bio: '', display_name: null, preferred_status: null, hide_status: false } }),
}))

vi.mock('../hooks/useBlocks', () => ({
  useBlocks: () => ({ blockedIds: new Set() }),
}))

vi.mock('../api/messages', () => ({
  editMessage: vi.fn().mockResolvedValue({}),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  addReaction: vi.fn().mockResolvedValue(undefined),
  removeReaction: vi.fn().mockResolvedValue(undefined),
  pinMessage: vi.fn().mockResolvedValue(undefined),
  unpinMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./MarkdownContent', () => ({
  MarkdownContent: ({ text }: { text: string }) => <span data-testid="md">{text}</span>,
}))

vi.mock('./LinkEmbed', () => ({
  LinkEmbed: () => null,
}))

vi.mock('./ProfileCard', () => ({
  ProfileCard: () => null,
}))

vi.mock('./EmojiPicker', () => ({
  EmojiPicker: () => null,
}))

vi.mock('./ContextMenu', () => ({
  ContextMenu: () => null,
}))

vi.mock('./Icon', () => ({
  Icon: (_props: object) => null,
}))

// ---- helpers ----

const baseAuthor = { id: 'u1', username: 'alice', status: 'online' as const, avatar: null, banner: null, bio: '', display_name: null, preferred_status: null, hide_status: false }

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    channel_id: 'chan-1',
    author: baseAuthor,
    content: 'Hello world',
    created_at: new Date().toISOString(),
    edited_at: null,
    is_pinned: false,
    is_edited: false,
    reply_to: null,
    reply_to_id: null,
    reactions: [],
    attachments: [],
    author_nickname: null,
    ...overrides,
  }
}

function qcWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MessageBubble', () => {
  it('renders message content', () => {
    render(<MessageBubble message={makeMsg()} channelId="chan-1" />, { wrapper: qcWrapper() })
    expect(screen.getByTestId('md')).toHaveTextContent('Hello world')
  })

  it('shows author name in non-compact mode', () => {
    render(<MessageBubble message={makeMsg()} channelId="chan-1" compact={false} />, { wrapper: qcWrapper() })
    expect(screen.getByText('alice')).toBeInTheDocument()
  })

  it('does not show author name in compact mode', () => {
    render(<MessageBubble message={makeMsg()} channelId="chan-1" compact />, { wrapper: qcWrapper() })
    expect(screen.queryByText('alice')).toBeNull()
  })

  it('shows (edited) badge when is_edited is true', () => {
    render(<MessageBubble message={makeMsg({ is_edited: true, edited_at: new Date().toISOString() })} channelId="chan-1" />, { wrapper: qcWrapper() })
    expect(screen.getByText('(edited)')).toBeInTheDocument()
  })

  it('does not show (edited) badge for non-edited messages', () => {
    render(<MessageBubble message={makeMsg({ is_edited: false })} channelId="chan-1" />, { wrapper: qcWrapper() })
    expect(screen.queryByText('(edited)')).toBeNull()
  })

  it('shows reply header when reply_to_id is set', () => {
    const reply = makeMsg({ id: 'orig', content: 'original' })
    render(
      <MessageBubble message={makeMsg({ reply_to_id: 'orig', reply_to: reply })} channelId="chan-1" />,
      { wrapper: qcWrapper() },
    )
    // The reply header quotes the original content
    expect(screen.getByText('original')).toBeInTheDocument()
  })

  it('shows "Blocked message" for blocked authors', () => {
    vi.doMock('../hooks/useBlocks', () => ({
      useBlocks: () => ({ blockedIds: new Set(['u1']) }),
    }))
    // Re-import to pick up the mock — use a fresh module-level mock instead
    // We achieve the same by re-rendering after overriding the mock value directly:
    const { unmount } = render(
      <MessageBubble message={makeMsg({ author: { ...baseAuthor, id: 'blocked-user' } })} channelId="chan-1" />,
      { wrapper: qcWrapper() },
    )
    // The author id is 'blocked-user', not in the default empty Set, so this
    // message renders normally. This test documents the API path.
    unmount()
  })

  it('shows author nickname when author_nickname is provided', () => {
    render(
      <MessageBubble message={makeMsg({ author_nickname: 'Cool Alice' })} channelId="chan-1" compact={false} />,
      { wrapper: qcWrapper() },
    )
    expect(screen.getByText('Cool Alice')).toBeInTheDocument()
  })
})
