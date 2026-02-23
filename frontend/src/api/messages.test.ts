import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
  },
}))

import client from './client'
import {
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  addReaction,
  removeReaction,
  getPins,
  pinMessage,
  unpinMessage,
} from './messages'

const mockGet = client.get as Mock
const mockPost = client.post as Mock
const mockPatch = client.patch as Mock
const mockDelete = client.delete as Mock
const mockPut = client.put as Mock

const fakeMsg = {
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
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getMessages', () => {
  it('GETs channel messages with default params', async () => {
    mockGet.mockResolvedValue({ data: [fakeMsg] })
    const result = await getMessages('chan-1')
    expect(mockGet).toHaveBeenCalledWith('/channels/chan-1/messages', {
      params: { before: undefined, limit: 50 },
    })
    expect(result).toEqual([fakeMsg])
  })

  it('passes before and limit params', async () => {
    mockGet.mockResolvedValue({ data: [] })
    await getMessages('chan-1', 'msg-0', 25)
    expect(mockGet).toHaveBeenCalledWith('/channels/chan-1/messages', {
      params: { before: 'msg-0', limit: 25 },
    })
  })
})

describe('sendMessage', () => {
  it('POSTs message content to channel', async () => {
    mockPost.mockResolvedValue({ data: fakeMsg })
    const result = await sendMessage('chan-1', 'hello')
    expect(mockPost).toHaveBeenCalledWith('/channels/chan-1/messages', {
      content: 'hello',
      reply_to_id: null,
    })
    expect(result).toEqual(fakeMsg)
  })

  it('includes reply_to_id when provided', async () => {
    mockPost.mockResolvedValue({ data: fakeMsg })
    await sendMessage('chan-1', 'reply', 'msg-0')
    expect(mockPost).toHaveBeenCalledWith('/channels/chan-1/messages', {
      content: 'reply',
      reply_to_id: 'msg-0',
    })
  })

  it('sends null content when falsy string passed', async () => {
    mockPost.mockResolvedValue({ data: fakeMsg })
    await sendMessage('chan-1', '')
    expect(mockPost).toHaveBeenCalledWith('/channels/chan-1/messages', {
      content: null,
      reply_to_id: null,
    })
  })
})

describe('editMessage', () => {
  it('PATCHes message content', async () => {
    mockPatch.mockResolvedValue({ data: fakeMsg })
    const result = await editMessage('chan-1', 'msg-1', 'updated')
    expect(mockPatch).toHaveBeenCalledWith('/channels/chan-1/messages/msg-1', { content: 'updated' })
    expect(result).toEqual(fakeMsg)
  })
})

describe('deleteMessage', () => {
  it('DELETEs the message', async () => {
    mockDelete.mockResolvedValue({})
    await deleteMessage('chan-1', 'msg-1')
    expect(mockDelete).toHaveBeenCalledWith('/channels/chan-1/messages/msg-1')
  })
})

describe('addReaction', () => {
  it('POSTs to reaction endpoint with encoded emoji', async () => {
    mockPost.mockResolvedValue({})
    await addReaction('chan-1', 'msg-1', '👍')
    expect(mockPost).toHaveBeenCalledWith(
      `/channels/chan-1/messages/msg-1/reactions/${encodeURIComponent('👍')}`,
    )
  })
})

describe('removeReaction', () => {
  it('DELETEs from reaction endpoint with encoded emoji', async () => {
    mockDelete.mockResolvedValue({})
    await removeReaction('chan-1', 'msg-1', '👍')
    expect(mockDelete).toHaveBeenCalledWith(
      `/channels/chan-1/messages/msg-1/reactions/${encodeURIComponent('👍')}`,
    )
  })
})

describe('getPins', () => {
  it('GETs /channels/:id/pins', async () => {
    mockGet.mockResolvedValue({ data: [] })
    await getPins('chan-1')
    expect(mockGet).toHaveBeenCalledWith('/channels/chan-1/pins')
  })
})

describe('pinMessage', () => {
  it('PUTs to pin endpoint', async () => {
    mockPut.mockResolvedValue({})
    await pinMessage('chan-1', 'msg-1')
    expect(mockPut).toHaveBeenCalledWith('/channels/chan-1/messages/msg-1/pin')
  })
})

describe('unpinMessage', () => {
  it('DELETEs from pin endpoint', async () => {
    mockDelete.mockResolvedValue({})
    await unpinMessage('chan-1', 'msg-1')
    expect(mockDelete).toHaveBeenCalledWith('/channels/chan-1/messages/msg-1/pin')
  })
})
