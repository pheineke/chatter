import { useAuth } from '../contexts/AuthContext'
import { E2EEProvider } from '../contexts/E2EEContext'
import type { ReactNode } from 'react'

export function E2EEWrapper({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  if (!user) return <>{children}</>

  // Note: this key now only protects the optional private per-user "notes"
  // feature (ProfileFullModal) — DMs and server channels use separate,
  // automatic MLS encryption (see MLSContext) that needs no user-managed
  // backup key at all. A forced blocking backup gate is no longer justified
  // for a minor, optional feature; the backup/rotate controls are still
  // available any time from Settings → Notes Encryption.
  return <E2EEProvider userId={user.id}>{children}</E2EEProvider>
}
