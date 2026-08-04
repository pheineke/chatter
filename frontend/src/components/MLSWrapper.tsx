import type { ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { MLSProvider } from '../contexts/MLSContext'
import { RecoveryCodeModal } from './RecoveryCodeModal'
import { RecoveryRestorePrompt } from './RecoveryRestorePrompt'

/** Mounts MLSProvider once a user is logged in, and offers the recovery code
 * once.
 *
 * Losing a device's MLS state isn't catastrophic on its own — the device gets
 * re-Added to its groups and another device hands its history over. What that
 * doesn't cover is losing every device at once, which is the only thing the
 * recovery code is for, and why it's offered rather than enforced.
 *
 * `backup_downloaded` is reused as the "has been through this once" flag. It
 * predates MLS, when it tracked the old private-key download; the column means
 * the same thing (the user has been shown their recovery material) so it's
 * reused rather than duplicated. */
export function MLSWrapper({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <>{children}</>
  return (
    <MLSProvider userId={user.id}>
      {children}
      {user.backup_downloaded === false ? (
        <RecoveryCodeModal />
      ) : (
        // Only relevant to someone who already has a code — and it decides
        // for itself whether restoring is even applicable (archive exists,
        // this device is empty), so it usually renders nothing.
        <RecoveryRestorePrompt />
      )}
    </MLSProvider>
  )
}
