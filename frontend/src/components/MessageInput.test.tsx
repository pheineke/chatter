import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { MessageInput } from './MessageInput'

// ---- Mocks ----

vi.mock('../api/messages', () => ({
  sendMessage: vi.fn().mockResolvedValue({
    id: 'new-msg',
    channel_id: 'chan-1',
    author: { id: 'me', username: 'me', status: 'online', avatar: null, banner: null, bio: '', display_name: null, preferred_status: null, hide_status: false },
    content: 'hello',
    created_at: new Date().toISOString(),
    edited_at: null,
    is_pinned: false,
    is_edited: false,
    reply_to: null,
    reply_to_id: null,
    reactions: [],
    attachments: [],
    author_nickname: null,
  }),
  uploadAttachment: vi.fn(),
}))

vi.mock('../api/servers', () => ({
  getMembers: vi.fn().mockResolvedValue([]),
}))

vi.mock('./Icon', () => ({
  Icon: (_props: object) => null,
}))

vi.mock('./EmojiPicker', () => ({
  EmojiPicker: () => null,
}))

vi.mock('./UserAvatar', () => ({
  UserAvatar: () => null,
}))

import * as messagesApi from '../api/messages'
const mockSendMessage = messagesApi.sendMessage as ReturnType<typeof vi.fn>

// ---- Helpers ----

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MessageInput', () => {
  it('renders the textarea with placeholder', () => {
    render(<MessageInput channelId="chan-1" placeholder="Write something…" />, { wrapper: wrapper() })
    expect(screen.getByPlaceholderText('Write something…')).toBeInTheDocument()
  })

  it('pressing Enter submits the message', async () => {
    const user = userEvent.setup()
    render(<MessageInput channelId="chan-1" />, { wrapper: wrapper() })

    const ta = screen.getByRole('textbox')
    await user.click(ta)
    await user.type(ta, 'hello world')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledWith('chan-1', 'hello world', undefined))
  })

  it('clears the textarea after submit', async () => {
    const user = userEvent.setup()
    render(<MessageInput channelId="chan-1" />, { wrapper: wrapper() })

    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.click(ta)
    await user.type(ta, 'hello')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(ta.value).toBe(''))
  })

  it('Shift+Enter inserts a newline instead of submitting', async () => {
    const user = userEvent.setup()
    render(<MessageInput channelId="chan-1" />, { wrapper: wrapper() })

    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.click(ta)
    await user.type(ta, 'first line')
    await user.keyboard('{Shift>}{Enter}{/Shift}')

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(ta.value).toContain('\n')
  })

  it('does not submit when textarea is empty', async () => {
    const user = userEvent.setup()
    render(<MessageInput channelId="chan-1" />, { wrapper: wrapper() })

    const ta = screen.getByRole('textbox')
    await user.click(ta)
    await user.keyboard('{Enter}')

    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('shows slowmode countdown after sending when slowmodeDelay > 0', async () => {
    const user = userEvent.setup()
    render(<MessageInput channelId="chan-1" slowmodeDelay={5} />, { wrapper: wrapper() })

    const ta = screen.getByRole('textbox')
    await user.click(ta)
    await user.type(ta, 'test')
    await user.keyboard('{Enter}')

    // After sending the cooldown counter should appear
    await waitFor(() => expect(screen.queryByText(/\ds/)).not.toBeNull(), { timeout: 2000 })
  })

  it('calls onCancelReply after sending', async () => {
    const onCancelReply = vi.fn()
    const replyTo = {
      id: 'orig',
      channel_id: 'chan-1',
      author: { id: 'u1', username: 'alice', status: 'online' as const, avatar: null, banner: null, bio: '', display_name: null, preferred_status: null, hide_status: false },
      content: 'original',
      created_at: new Date().toISOString(),
      edited_at: null,
      is_pinned: false,
      is_edited: false,
      reply_to: null,
      reply_to_id: null,
      reactions: [],
      attachments: [],
      author_nickname: null,
    }
    const user = userEvent.setup()
    render(
      <MessageInput channelId="chan-1" replyTo={replyTo} onCancelReply={onCancelReply} />,
      { wrapper: wrapper() },
    )

    const ta = screen.getByRole('textbox')
    await user.click(ta)
    await user.type(ta, 'my reply')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onCancelReply).toHaveBeenCalled())
  })
})
