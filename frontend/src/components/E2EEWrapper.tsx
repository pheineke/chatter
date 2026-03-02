/**
 * Bridges the AuthContext (user.id) into the E2EEProvider.
 *
 * Renders nothing while the user is not logged in — the E2EEProvider only
 * starts when there is a confirmed userId available.
 */
import { useAuth } from '../contexts/AuthContext'
import { E2EEProvider } from '../contexts/E2EEContext'
import type { ReactNode } from 'react'

export function E2EEWrapper({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  if (!user) return <>{children}</>

  return <E2EEProvider userId={user.id}>{children}</E2EEProvider>
}
