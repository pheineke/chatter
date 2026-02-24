import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import type { User } from '../api/types'
import { getMe, login as apiLogin, register as apiRegister, logout as apiLogout } from '../api/users'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
  /** Patch a subset of fields on the current user without a network round-trip. */
  updateUser: (patch: Partial<User>) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = async () => {
    try {
      const me = await getMe()
      setUser(me)
      localStorage.setItem('cachedUser', JSON.stringify(me))
    } catch {
      setUser(null)
      localStorage.removeItem('cachedUser')
    }
  }

  const updateUser = (patch: Partial<User>) => {
    setUser(prev => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      localStorage.setItem('cachedUser', JSON.stringify(next))
      return next
    })
  }

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { setLoading(false); return }

    // Restore from cache immediately so the UI is never stuck
    const cached = localStorage.getItem('cachedUser')
    if (cached) {
      try { setUser(JSON.parse(cached)) } catch { /* ignore */ }
    }
    setLoading(false)

    // Validate in background — update or clear user silently
    refreshUser()
  }, [])

  const login = async (username: string, password: string) => {
    const data = await apiLogin(username, password)
    localStorage.setItem('token', data.access_token)
    localStorage.setItem('refreshToken', data.refresh_token)
    await refreshUser()
  }

  const register = async (username: string, password: string) => {
    await apiRegister(username, password)
  }

  const logout = () => {
    const refreshToken = localStorage.getItem('refreshToken')
    if (refreshToken) {
      void apiLogout(refreshToken)
    }
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('cachedUser')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
