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
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from './channels'

const mockGet = client.get as Mock
const mockPost = client.post as Mock
const mockPatch = client.patch as Mock
const mockDelete = client.delete as Mock

const fakeChan = { id: 'chan-1', server_id: 'srv-1', title: 'general', type: 'text' as const, description: null, position: 0, category_id: null, slowmode_delay: 0, nsfw: false, user_limit: null, bitrate: null }
const fakeCat = { id: 'cat-1', server_id: 'srv-1', title: 'Category', position: 0 }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getChannels', () => {
  it('GETs /servers/:id/channels', async () => {
    mockGet.mockResolvedValue({ data: [fakeChan] })
    const result = await getChannels('srv-1')
    expect(mockGet).toHaveBeenCalledWith('/servers/srv-1/channels')
    expect(result).toEqual([fakeChan])
  })
})

describe('createChannel', () => {
  it('POSTs to /servers/:id/channels with body', async () => {
    mockPost.mockResolvedValue({ data: fakeChan })
    const result = await createChannel('srv-1', { title: 'general', type: 'text' })
    expect(mockPost).toHaveBeenCalledWith('/servers/srv-1/channels', { title: 'general', type: 'text' })
    expect(result).toEqual(fakeChan)
  })
})

describe('updateChannel', () => {
  it('PATCHes /servers/:id/channels/:chanId', async () => {
    mockPatch.mockResolvedValue({ data: fakeChan })
    const result = await updateChannel('srv-1', 'chan-1', { title: 'renamed' })
    expect(mockPatch).toHaveBeenCalledWith('/servers/srv-1/channels/chan-1', { title: 'renamed' })
    expect(result).toEqual(fakeChan)
  })
})

describe('deleteChannel', () => {
  it('DELETEs /servers/:id/channels/:chanId', async () => {
    mockDelete.mockResolvedValue({})
    await deleteChannel('srv-1', 'chan-1')
    expect(mockDelete).toHaveBeenCalledWith('/servers/srv-1/channels/chan-1')
  })
})

describe('getCategories', () => {
  it('GETs /servers/:id/categories', async () => {
    mockGet.mockResolvedValue({ data: [fakeCat] })
    const result = await getCategories('srv-1')
    expect(mockGet).toHaveBeenCalledWith('/servers/srv-1/categories')
    expect(result).toEqual([fakeCat])
  })
})

describe('createCategory', () => {
  it('POSTs to /servers/:id/categories', async () => {
    mockPost.mockResolvedValue({ data: fakeCat })
    const result = await createCategory('srv-1', 'Category')
    expect(mockPost).toHaveBeenCalledWith('/servers/srv-1/categories', { title: 'Category' })
    expect(result).toEqual(fakeCat)
  })
})

describe('updateCategory', () => {
  it('PATCHes /servers/:id/categories/:catId', async () => {
    mockPatch.mockResolvedValue({ data: fakeCat })
    const result = await updateCategory('srv-1', 'cat-1', 'Renamed')
    expect(mockPatch).toHaveBeenCalledWith('/servers/srv-1/categories/cat-1', { title: 'Renamed' })
    expect(result).toEqual(fakeCat)
  })
})

describe('deleteCategory', () => {
  it('DELETEs /servers/:id/categories/:catId', async () => {
    mockDelete.mockResolvedValue({})
    await deleteCategory('srv-1', 'cat-1')
    expect(mockDelete).toHaveBeenCalledWith('/servers/srv-1/categories/cat-1')
  })
})
