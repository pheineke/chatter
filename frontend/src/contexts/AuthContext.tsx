import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import type { User } from '../api/types'
import { getMe, login as apiLogin, register as apiRegister, logout as apiLogout } from '../api/users'
import { adoptRefreshToken, endSession, shareAccessToken } from '../api/refresh'
import { clearLegacyTokens, hasSession, markSession, setAccessToken } from '../api/tokenStore'

import { applyColorOverrides, loadColorOverrides } from '../utils/colorOverrides'

export interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  /** Authenticate using a pre-issued token pair (e.g. from QR login). The
   * refresh token is exchanged for this browser's cookie session. */
  loginWithTokens: (accessToken: string, refreshToken: string) => Promise<void>
  register: (username: string, password: string, inviteCode?: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
  /** Patch a subset of fields on the current user without a network round-trip. */
  updateUser: (patch: Partial<User>) => void
}

/** Exported so tests can inject a fixed user instead of mounting the real
 * AuthProvider, which fetches /users/me on mount. App code should use
 * `useAuth()` / `<AuthProvider>`. */
export const AuthContext = createContext<AuthContextValue | null>(null)

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
    // The access token is memory-only and the refresh token an HttpOnly
    // cookie (S15); the API client gets a token on the first request.
    if (!hasSession()) { setLoading(false); return }

    // Restore from cache immediately so the UI is never stuck, and validate
    // in the background. Without a cached profile, wait for /users/me:
    // showing "logged out" first would send RequireAuth to /login.
    const cached = localStorage.getItem('cachedUser')
    let restored = false
    if (cached) {
      try { setUser(JSON.parse(cached)); restored = true } catch { /* ignore */ }
    }
    if (restored) {
      setLoading(false)
      void refreshUser()
    } else {
      void refreshUser().finally(() => setLoading(false))
    }
  }, [])

  useEffect(() => {
    if (!user) return

    if (user.theme_preset) {
      localStorage.setItem('appPreset', user.theme_preset)
    }

    if (user.theme_colors) {
      try {
        const parsed = JSON.parse(user.theme_colors)
        applyColorOverrides(parsed)
        localStorage.setItem('colorOverrides', user.theme_colors)
      } catch { /* ignore */ }
    } else {
      const fallback = loadColorOverrides()
      applyColorOverrides(fallback)
    }
  }, [user?.theme_colors, user?.theme_preset])

  const login = async (username: string, password: string) => {
    const data = await apiLogin(username, password)
    clearLegacyTokens()
    markSession(true)
    setAccessToken(data.access_token)
    shareAccessToken(data.access_token)
    await refreshUser()
  }

  const loginWithTokens = async (_accessToken: string, refreshToken: string) => {
    const result = await adoptRefreshToken(refreshToken)
    if (!result.ok) throw new Error('Could not start the session.')
    await refreshUser()
  }

  const register = async (username: string, password: string, inviteCode?: string) => {
    await apiRegister(username, password, inviteCode)
  }

  const logout = () => {
    void apiLogout() // sends the cookie; the server revokes and clears it
    endSession()
    localStorage.removeItem('cachedUser')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithTokens, register, logout, refreshUser, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
