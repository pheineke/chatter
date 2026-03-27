/**
 * Bridges the AuthContext (user.id) into the E2EEProvider.
 *
 * Renders nothing while the user is not logged in — the E2EEProvider only
 * starts when there is a confirmed userId available.
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { E2EEProvider, useE2EE } from '../contexts/E2EEContext'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

export function E2EEWrapper({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  if (!user) return <>{children}</>

  return (
    <E2EEProvider userId={user.id}>
      <ForcedKeyBackupGate userId={user.id} username={user.username}>
        {children}
      </ForcedKeyBackupGate>
    </E2EEProvider>
  )
}

function ForcedKeyBackupGate({
  userId,
  username,
  children,
}: {
  userId: string
  username: string
  children: ReactNode
}) {
  const { ready, initialising, isEnabled, downloadBackup } = useE2EE()
  const [showGate, setShowGate] = useState(false)
  const [downloaded, setDownloaded] = useState(false)

  const markerKey = `e2ee_backup_done_${userId}`

  useEffect(() => {
    if (initialising || !ready || !isEnabled) return
    const alreadyBackedUp = localStorage.getItem(markerKey) === '1'
    setShowGate(!alreadyBackedUp)
  }, [initialising, ready, isEnabled, markerKey])

  async function handleDownload() {
    await downloadBackup(username || 'chatter')
    setDownloaded(true)
  }

  function handleContinue() {
    localStorage.setItem(markerKey, '1')
    setShowGate(false)
  }

  return (
    <>
      {children}
      {showGate && (
        <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-sp-xl bg-sp-popup border border-sp-divider/60 p-6 shadow-sp-3">
            <div className="flex items-start gap-3 mb-4">
              <div className="mt-0.5 text-yellow-400">
                <Icon name="alert-triangle" size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-sp-text">Back Up Your Encryption Key</h2>
                <p className="text-sm text-sp-muted mt-1">
                  This is required before using Chatter. If you lose this key and your device,
                  your encrypted DMs cannot be recovered.
                </p>
              </div>
            </div>

            <div className="rounded bg-sp-bg p-3 text-xs text-sp-muted mb-4">
              Save the downloaded backup file in a secure place (password manager vault,
              encrypted USB, or secure cloud storage).
            </div>

            <div className="flex flex-col sm:flex-row gap-2 justify-end">
              <button
                onClick={handleDownload}
                className="px-4 py-2 rounded bg-sp-input hover:bg-sp-muted/20 text-sp-text text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Icon name="download" size={16} />
                Download key backup
              </button>
              <button
                onClick={handleContinue}
                disabled={!downloaded}
                className="px-4 py-2 rounded bg-sp-mention text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                I backed it up, continue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
