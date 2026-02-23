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
    } catch {
      setUser(null)
    }
  }

  const updateUser = (patch: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...patch } : prev)
  }

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      refreshUser().finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
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
      // Fire-and-forget – revoke the refresh token on the server
      void apiLogout(refreshToken)
    }
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
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
