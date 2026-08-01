import type { ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { MLSProvider } from '../contexts/MLSContext'

/** Mounts MLSProvider once a user is logged in. Unlike E2EEWrapper's forced
 * key-backup gate, MLS needs no blocking UI here: losing local device state
 * just means waiting to be re-Added to your groups (self-healing, not
 * catastrophic — see MLSContext's founder-race recovery for the same idea
 * applied to a different failure mode). */
export function MLSWrapper({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <>{children}</>
  return <MLSProvider userId={user.id}>{children}</MLSProvider>
}
