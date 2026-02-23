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
  register,
  login,
  logout,
  getMe,
  updateMe,
  getUser,
  getUserByUsername,
  getNote,
  setNote,
  changePassword,
} from './users'

const mockGet = client.get as Mock
const mockPost = client.post as Mock
const mockPatch = client.patch as Mock
const mockDelete = client.delete as Mock
const mockPut = client.put as Mock

const fakeUser = {
  id: 'u1',
  username: 'alice',
  status: 'online' as const,
  avatar: null,
  banner: null,
  bio: '',
  display_name: null,
  preferred_status: null,
  hide_status: false,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('register', () => {
  it('POSTs to /auth/register and returns user', async () => {
    mockPost.mockResolvedValue({ data: fakeUser })
    const result = await register('alice', 'pw123')
    expect(mockPost).toHaveBeenCalledWith('/auth/register', { username: 'alice', password: 'pw123' })
    expect(result).toEqual(fakeUser)
  })
})

describe('login', () => {
  it('POSTs to /auth/login with form-encoded body', async () => {
    const tokens = { access_token: 'acc', refresh_token: 'ref' }
    mockPost.mockResolvedValue({ data: tokens })
    const result = await login('alice', 'pw123')
    expect(mockPost).toHaveBeenCalledWith(
      '/auth/login',
      expect.any(URLSearchParams),
      expect.objectContaining({ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
    )
    expect(result).toEqual(tokens)
  })
})

describe('logout', () => {
  it('POSTs to /auth/logout with refresh token', async () => {
    mockPost.mockResolvedValue({})
    await logout('my-refresh-token')
    expect(mockPost).toHaveBeenCalledWith('/auth/logout', { refresh_token: 'my-refresh-token' })
  })

  it('does not throw if the request fails', async () => {
    mockPost.mockRejectedValue(new Error('network error'))
    await expect(logout('ref')).resolves.toBeUndefined()
  })
})

describe('getMe', () => {
  it('GETs /users/me and returns user', async () => {
    mockGet.mockResolvedValue({ data: fakeUser })
    const result = await getMe()
    expect(mockGet).toHaveBeenCalledWith('/users/me')
    expect(result).toEqual(fakeUser)
  })
})

describe('updateMe', () => {
  it('PATCHes /users/me with patch and returns updated user', async () => {
    const updated = { ...fakeUser, bio: 'Hello' }
    mockPatch.mockResolvedValue({ data: updated })
    const result = await updateMe({ bio: 'Hello' })
    expect(mockPatch).toHaveBeenCalledWith('/users/me', { bio: 'Hello' })
    expect(result).toEqual(updated)
  })
})

describe('getUser', () => {
  it('GETs /users/:id and returns user', async () => {
    mockGet.mockResolvedValue({ data: fakeUser })
    const result = await getUser('u1')
    expect(mockGet).toHaveBeenCalledWith('/users/u1')
    expect(result).toEqual(fakeUser)
  })
})

describe('getUserByUsername', () => {
  it('GETs /users/search with username param', async () => {
    mockGet.mockResolvedValue({ data: fakeUser })
    const result = await getUserByUsername('alice')
    expect(mockGet).toHaveBeenCalledWith('/users/search', { params: { username: 'alice' } })
    expect(result).toEqual(fakeUser)
  })
})

describe('getNote', () => {
  it('GETs /users/:id/note and returns content', async () => {
    mockGet.mockResolvedValue({ data: { content: 'some note' } })
    const result = await getNote('u1')
    expect(mockGet).toHaveBeenCalledWith('/users/u1/note')
    expect(result).toBe('some note')
  })
})

describe('setNote', () => {
  it('PUTs to /users/:id/note', async () => {
    mockPut.mockResolvedValue({})
    await setNote('u1', 'new note')
    expect(mockPut).toHaveBeenCalledWith('/users/u1/note', { content: 'new note' })
  })
})

describe('changePassword', () => {
  it('POSTs to /users/me/change-password', async () => {
    mockPost.mockResolvedValue({})
    await changePassword('oldpw', 'newpw')
    expect(mockPost).toHaveBeenCalledWith('/users/me/change-password', {
      current_password: 'oldpw',
      new_password: 'newpw',
    })
  })
})
