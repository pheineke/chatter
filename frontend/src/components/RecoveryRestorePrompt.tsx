import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import * as mls from '../mls'
import { useAuth } from '../contexts/AuthContext'

/**
 * Offers a recovery-code restore on a device that has no history and no
 * sibling device to get it from.
 *
 * Deliberately narrow. Linking a device while another is still signed in
 * copies history across on its own, so prompting for a code then would be
 * asking for something people have to go and find, to do a job already being
 * done. This only appears when that path can't help: an archive exists, and
 * this device has nothing.
 *
 * It's also dismissable — someone signing in on a borrowed machine shouldn't
 * be pushed into typing their recovery code into it, and history will fill in
 * by itself if another device ever comes back online.
 */
export function RecoveryRestorePrompt() {
  const { user } = useAuth()
  const [applicable, setApplicable] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restored, setRestored] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Only worth offering if there's an archive to restore *and* nothing
        // here already.
        const [hasArchive, localCount] = await Promise.all([
          mls.hasRecoveryArchive(),
          mls.cachedMessageCount(),
        ])
        if (!cancelled) setApplicable(hasArchive && localCount === 0)
      } catch {
        // Offline or the endpoint is unavailable — say nothing rather than
        // prompting for a recovery code we might not be able to use.
        if (!cancelled) setApplicable(false)
      }
    })()
    return () => { cancelled = true }
  }, [user])

  if (!user || !applicable || dismissed) return null

  async function restore() {
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      const count = await mls.restoreFromArchive(user.id, code)
      if (count === null) {
        // Distinguished from a failed restore on purpose: the usual cause is
        // a typo, and "check the code" is actionable where "restore failed"
        // isn't.
        setError("That code doesn't match this account. Check it and try again.")
        return
      }
      setRestored(count)
    } catch (err) {
      console.error('[MLS] restore failed:', err)
      setError('Could not restore right now. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg bg-sp-surface p-6 shadow-xl">
        {restored === null ? (
          <>
            <h2 className="text-lg font-semibold text-sp-text">Restore your message history</h2>
            <p className="mt-2 text-sm text-sp-muted">
              This device has no message history yet. If you still have another device signed
              in, it will send your history over automatically and you can close this. Otherwise,
              enter the recovery code you saved when you signed up.
            </p>
            <input
              className="input mt-4 w-full rounded-md bg-sp-input p-2 font-mono text-sm tracking-wider text-sp-text"
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex items-center justify-between gap-3">
              <button className="text-xs text-sp-muted underline" onClick={() => setDismissed(true)}>
                Not now
              </button>
              <button
                className="btn btn-primary"
                onClick={restore}
                disabled={busy || code.trim().length === 0}
              >
                {busy ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-sp-text">History restored</h2>
            <p className="mt-2 text-sm text-sp-muted">
              {restored === 0
                ? 'There was nothing archived yet, so there was nothing to bring back.'
                : `Recovered ${restored} message${restored === 1 ? '' : 's'} onto this device.`}
            </p>
            <div className="mt-5 flex justify-end">
              <button className="btn btn-primary" onClick={() => setDismissed(true)}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
