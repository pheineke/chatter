import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider, useAuth } from './AuthContext'

// Mock all api/users functions used by AuthContext
vi.mock('../api/users', () => ({
  getMe: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}))

import * as usersApi from '../api/users'
const mockGetMe = usersApi.getMe as ReturnType<typeof vi.fn>
const mockLogin = usersApi.login as ReturnType<typeof vi.fn>
const mockRegister = usersApi.register as ReturnType<typeof vi.fn>
const mockLogout = usersApi.logout as ReturnType<typeof vi.fn>

const fakeUser = { id: 'u1', username: 'alice', status: 'online' as const, avatar: null, banner: null, bio: '', display_name: null, preferred_status: null, hide_status: false }

/** Small consumer component so we can test the hook */
function Consumer() {
  const { user, loading, login, register, logout, updateUser } = useAuth()
  return (
    <div>
      {loading && <span data-testid="loading">loading</span>}
      {user && <span data-testid="username">{user.username}</span>}
      {user && <span data-testid="bio">{user.bio}</span>}
      <button onClick={() => login('alice', 'pw')}>login</button>
      <button onClick={() => register('alice', 'pw')}>register</button>
      <button onClick={logout}>logout</button>
      <button onClick={() => updateUser({ bio: 'updated bio' })}>update</button>
    </div>
  )
}

function renderConsumer() {
  return render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  // Default: no token stored, so loading resolves quickly without network call
  mockGetMe.mockResolvedValue(fakeUser)
  mockLogin.mockResolvedValue({ access_token: 'acc', refresh_token: 'ref' })
  mockLogout.mockResolvedValue(undefined)
  mockRegister.mockResolvedValue(fakeUser)
})

describe('AuthProvider — initial state', () => {
  it('sets loading=false and user=null when no token is stored', async () => {
    renderConsumer()
    await waitFor(() => expect(screen.queryByTestId('loading')).toBeNull())
    expect(screen.queryByTestId('username')).toBeNull()
  })

  it('calls getMe and sets user when token is present', async () => {
    localStorage.setItem('token', 'existing-token')
    renderConsumer()
    await waitFor(() => expect(screen.queryByTestId('loading')).toBeNull())
    expect(await screen.findByTestId('username')).toHaveTextContent('alice')
    expect(mockGetMe).toHaveBeenCalledTimes(1)
  })
})

describe('login()', () => {
  it('stores tokens in localStorage and sets user', async () => {
    const user = userEvent.setup()
    renderConsumer()
    await waitFor(() => expect(screen.queryByTestId('loading')).toBeNull())

    await user.click(screen.getByText('login'))
    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('alice'))

    expect(localStorage.getItem('token')).toBe('acc')
    expect(localStorage.getItem('refreshToken')).toBe('ref')
    expect(mockLogin).toHaveBeenCalledWith('alice', 'pw')
    expect(mockGetMe).toHaveBeenCalled()
  })
})

describe('logout()', () => {
  it('clears tokens and nulls user', async () => {
    // Set up logged in state first
    localStorage.setItem('token', 'acc')
    localStorage.setItem('refreshToken', 'ref')
    renderConsumer()
    await waitFor(() => expect(screen.queryByTestId('loading')).toBeNull())
    expect(screen.getByTestId('username')).toHaveTextContent('alice')

    const user = userEvent.setup()
    await user.click(screen.getByText('logout'))

    await waitFor(() => expect(screen.queryByTestId('username')).toBeNull())
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('refreshToken')).toBeNull()
    expect(mockLogout).toHaveBeenCalledWith('ref')
  })
})

describe('updateUser()', () => {
  it('patches user state without a network call', async () => {
    localStorage.setItem('token', 'acc')
    renderConsumer()
    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('alice'))

    const user = userEvent.setup()
    await user.click(screen.getByText('update'))

    await waitFor(() => expect(screen.getByTestId('bio')).toHaveTextContent('updated bio'))
    // getMe should NOT have been called again for the local patch
    expect(mockGetMe).toHaveBeenCalledTimes(1)
  })
})

describe('register()', () => {
  it('calls register API', async () => {
    const user = userEvent.setup()
    renderConsumer()
    await waitFor(() => expect(screen.queryByTestId('loading')).toBeNull())

    await user.click(screen.getByText('register'))
    expect(mockRegister).toHaveBeenCalledWith('alice', 'pw')
  })
})
