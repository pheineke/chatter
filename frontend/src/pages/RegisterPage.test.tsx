import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import RegisterPage from './RegisterPage'

const register = vi.fn()
const login = vi.fn()
const getRegistrationMode = vi.fn()

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ register, login }) }))
vi.mock('../api/users', () => ({ getRegistrationMode: () => getRegistrationMode() }))

function renderAt(entry: string | { pathname: string; search?: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/invite/:code" element={<p>invite page</p>} />
        <Route path="/channels/@me" element={<p>home</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function fill() {
  fireEvent.change(screen.getByPlaceholderText('Choose a username'), { target: { value: 'newbie' } })
  fireEvent.change(screen.getByPlaceholderText('Create a password'), { target: { value: 'password1' } })
  fireEvent.change(screen.getByPlaceholderText('Confirm your password'), { target: { value: 'password1' } })
}

describe('RegisterPage registration modes', () => {
  beforeEach(() => {
    register.mockReset().mockResolvedValue(undefined)
    login.mockReset().mockResolvedValue(undefined)
    getRegistrationMode.mockReset()
  })

  it('shows no invite field when registration is open', async () => {
    getRegistrationMode.mockResolvedValue('open')
    renderAt('/register')
    await waitFor(() => expect(getRegistrationMode).toHaveBeenCalled())
    expect(screen.queryByPlaceholderText('From your invite link')).toBeNull()
    fill()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(screen.getByText('home')).toBeTruthy())
    expect(register).toHaveBeenCalledWith('newbie', 'password1', undefined)
  })

  it('hides the form when registration is closed', async () => {
    getRegistrationMode.mockResolvedValue('closed')
    renderAt('/register')
    expect(await screen.findByText(/Sign-ups are closed/)).toBeTruthy()
    expect(screen.queryByPlaceholderText('Choose a username')).toBeNull()
  })

  it('prefills the invite from the login redirect and returns to it', async () => {
    getRegistrationMode.mockResolvedValue('invite')
    renderAt({ pathname: '/register', state: { from: { pathname: '/invite/abc123' } } })
    const field = (await screen.findByPlaceholderText('From your invite link')) as HTMLInputElement
    expect(field.value).toBe('abc123')
    fill()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(screen.getByText('invite page')).toBeTruthy())
    expect(register).toHaveBeenCalledWith('newbie', 'password1', 'abc123')
  })

  it('takes the invite from ?invite= and goes to it after sign-up', async () => {
    getRegistrationMode.mockResolvedValue('invite')
    renderAt({ pathname: '/register', search: '?invite=xyz' })
    const field = (await screen.findByPlaceholderText('From your invite link')) as HTMLInputElement
    expect(field.value).toBe('xyz')
    fill()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(screen.getByText('invite page')).toBeTruthy())
  })
})
