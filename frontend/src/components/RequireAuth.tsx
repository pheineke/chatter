import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { ReactNode } from 'react'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-discord-sidebar">
        <div className="text-discord-muted text-lg">Loading…</div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return <>{children}</>
}
