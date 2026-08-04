import { useCallback, useEffect, useState } from 'react'
import * as mls from '../mls'
import { useAuth } from '../contexts/AuthContext'
import { Icon } from './Icon'

/**
 * Settings panel for the recovery-code archive.
 *
 * Covers what the sign-up modal can't: someone who skipped it, lost their
 * code, or has decided they'd rather not have a decryptable copy of their
 * history stored at all.
 *
 * Regenerating and deleting are both destructive in ways worth being explicit
 * about — a new code makes the existing archive permanently unreadable, and
 * deletion means losing every device becomes unrecoverable — so both are
 * behind a confirmation that says which of those you're choosing.
 */
export function RecoveryCodeSettings() {
  const { user } = useAuth()
  const [hasArchive, setHasArchive] = useState<boolean | null>(null)
  const [chunkCount, setChunkCount] = useState(0)
  const [newCode, setNewCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'regenerate' | 'delete' | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const meta = await mls.fetchRecoveryArchiveMeta()
      setHasArchive(meta !== null)
      setChunkCount(meta?.chunkCount ?? 0)
    } catch {
      setHasArchive(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function regenerate() {
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      const code = await mls.setUpRecoveryCode(user.id)
      setNewCode(code)
      // Re-archive from scratch: the old chunks were dropped server-side when
      // the salt changed, and this device's progress marker has to start over
      // with them.
      await mls.resetArchiveProgress(user.id)
      await mls.archiveHistory(user.id)
      await refresh()
    } catch (err) {
      console.error('[MLS] could not regenerate recovery code:', err)
      setError('Could not create a new recovery code. Please try again.')
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  async function remove() {
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      await mls.deleteRecoveryArchive(user.id)
      setNewCode(null)
      await refresh()
    } catch (err) {
      console.error('[MLS] could not delete recovery archive:', err)
      setError('Could not delete the archive. Please try again.')
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  async function copy() {
    if (!newCode) return
    await navigator.clipboard.writeText(newCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-sp-sidebar rounded-lg p-4">
      <div className="text-xs font-bold text-sp-muted uppercase mb-3">Recovery Code</div>

      <p className="text-sm text-sp-muted">
        Your messages are encrypted, and signing in on a new device copies your history
        across from a device you're already signed in on. A recovery code is only needed
        if you lose access to <em>every</em> device at once.
      </p>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {newCode && (
        <div className="mt-4 rounded-md border border-sp-divider/40 p-3">
          <p className="text-xs text-sp-muted">
            Your new recovery code. Save it now — it can't be shown again, and any
            previously saved code no longer works.
          </p>
          <div className="mt-2 select-all rounded bg-sp-input p-2 text-center font-mono text-sm tracking-wider text-sp-text">
            {newCode}
          </div>
          <button className="btn mt-2 w-full" onClick={copy}>
            <Icon name="copy" size={16} /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      <div className="mt-4 text-sm text-sp-text">
        {hasArchive === null
          ? 'Checking…'
          : hasArchive
            ? `History archive is active${chunkCount > 0 ? ` (${chunkCount} block${chunkCount === 1 ? '' : 's'} stored)` : ', nothing archived yet'}.`
            : 'No recovery code set up. If you lose every device, your history can’t be recovered.'}
      </div>

      {confirming === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn" onClick={() => setConfirming('regenerate')} disabled={busy}>
            {hasArchive ? 'Generate a new code' : 'Set up a recovery code'}
          </button>
          {hasArchive && (
            <button className="btn" onClick={() => setConfirming('delete')} disabled={busy}>
              Delete archive
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-sp-divider/40 p-3">
          <p className="text-sm text-sp-text">
            {confirming === 'regenerate'
              ? 'A new code replaces the old one. Anything already archived becomes permanently unreadable and will be re-uploaded from this device — so run this on a device that still has your history.'
              : 'This deletes the stored copy of your history. Messages on your devices are unaffected, but if you later lose every device there will be nothing to restore from.'}
          </p>
          <div className="mt-3 flex gap-2">
            <button className="btn" onClick={() => setConfirming(null)} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={confirming === 'regenerate' ? regenerate : remove}
              disabled={busy}
            >
              {busy ? 'Working…' : confirming === 'regenerate' ? 'Generate new code' : 'Delete archive'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
