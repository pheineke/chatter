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
  getMyServers,
  getServer,
  createServer,
  updateServer,
  deleteServer,
  getMembers,
  kickMember,
  getRoles,
  assignRole,
  removeRole,
} from './servers'

const mockGet = client.get as Mock
const mockPost = client.post as Mock
const mockPatch = client.patch as Mock
const mockDelete = client.delete as Mock

const fakeServer = { id: 'srv-1', title: 'My Server', owner_id: 'u1', description: '', icon: null, banner: null, member_count: 1 }
const fakeMember = { user_id: 'u1', server_id: 'srv-1', nickname: null, joined_at: '2024-01-01T00:00:00Z', username: 'alice', avatar: null, status: 'online', roles: [] }
const fakeRole = { id: 'role-1', server_id: 'srv-1', name: 'Admin', color: '#ff0000', is_admin: true, hoist: false, mentionable: false, position: 0 }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getMyServers', () => {
  it('GETs /servers/', async () => {
    mockGet.mockResolvedValue({ data: [fakeServer] })
    const result = await getMyServers()
    expect(mockGet).toHaveBeenCalledWith('/servers/')
    expect(result).toEqual([fakeServer])
  })
})

describe('getServer', () => {
  it('GETs /servers/:id', async () => {
    mockGet.mockResolvedValue({ data: fakeServer })
    const result = await getServer('srv-1')
    expect(mockGet).toHaveBeenCalledWith('/servers/srv-1')
    expect(result).toEqual(fakeServer)
  })
})

describe('createServer', () => {
  it('POSTs to /servers/', async () => {
    mockPost.mockResolvedValue({ data: fakeServer })
    const result = await createServer('My Server', 'desc')
    expect(mockPost).toHaveBeenCalledWith('/servers/', { title: 'My Server', description: 'desc' })
    expect(result).toEqual(fakeServer)
  })
})

describe('updateServer', () => {
  it('PATCHes /servers/:id', async () => {
    mockPatch.mockResolvedValue({ data: fakeServer })
    const result = await updateServer('srv-1', { title: 'Renamed' })
    expect(mockPatch).toHaveBeenCalledWith('/servers/srv-1', { title: 'Renamed' })
    expect(result).toEqual(fakeServer)
  })
})

describe('deleteServer', () => {
  it('DELETEs /servers/:id', async () => {
    mockDelete.mockResolvedValue({})
    await deleteServer('srv-1')
    expect(mockDelete).toHaveBeenCalledWith('/servers/srv-1')
  })
})

describe('getMembers', () => {
  it('GETs /servers/:id/members', async () => {
    mockGet.mockResolvedValue({ data: [fakeMember] })
    const result = await getMembers('srv-1')
    expect(mockGet).toHaveBeenCalledWith('/servers/srv-1/members')
    expect(result).toEqual([fakeMember])
  })
})

describe('kickMember', () => {
  it('DELETEs /servers/:id/members/:userId', async () => {
    mockDelete.mockResolvedValue({})
    await kickMember('srv-1', 'u2')
    expect(mockDelete).toHaveBeenCalledWith('/servers/srv-1/members/u2')
  })
})

describe('getRoles', () => {
  it('GETs /servers/:id/roles', async () => {
    mockGet.mockResolvedValue({ data: [fakeRole] })
    const result = await getRoles('srv-1')
    expect(mockGet).toHaveBeenCalledWith('/servers/srv-1/roles')
    expect(result).toEqual([fakeRole])
  })
})

describe('assignRole', () => {
  it('POSTs to /servers/:id/members/:uid/roles/:rid', async () => {
    mockPost.mockResolvedValue({})
    await assignRole('srv-1', 'u2', 'role-1')
    expect(mockPost).toHaveBeenCalledWith('/servers/srv-1/members/u2/roles/role-1')
  })
})

describe('removeRole', () => {
  it('DELETEs /servers/:id/members/:uid/roles/:rid', async () => {
    mockDelete.mockResolvedValue({})
    await removeRole('srv-1', 'u2', 'role-1')
    expect(mockDelete).toHaveBeenCalledWith('/servers/srv-1/members/u2/roles/role-1')
  })
})
