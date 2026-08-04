import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import * as mls from '../mls'
import { updateMe } from '../api/users'
import { useAuth } from '../contexts/AuthContext'
import { Icon } from './Icon'

/**
 * Shown once, on first sign-in, to hand the user their recovery code.
 *
 * This is the only moment the code exists anywhere it can be read: it isn't
 * stored on the device or the server, so if it isn't saved here it's gone,
 * and so is any message history that outlives the user's devices.
 *
 * Worth being precise about what it protects, because an earlier version of
 * this dialog guarded the private-notes key and implied it covered messages.
 * Messages are protected by MLS and need no user-managed key at all; linking
 * a second device copies history across directly. The recovery code matters
 * for exactly one situation — losing every device at once — which is also
 * why it's presented as insurance rather than a chore, and why continuing
 * without saving it is allowed but honestly labelled.
 */
export function RecoveryCodeModal() {
  const { user, updateUser } = useAuth()
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    mls
      .setUpRecoveryCode(user.id)
      .then((c) => { if (!cancelled) setCode(c) })
      .catch((err) => {
        console.error('[MLS] could not create a recovery code:', err)
        if (!cancelled) setError('Could not set up a recovery code. You can do this later in Settings.')
      })
    return () => { cancelled = true }
  }, [user])

  async function finish() {
    setSaving(true)
    try {
      // Back up whatever this device already holds. Usually nothing on a
      // brand-new account — the archive fills up as messages arrive, since
      // the derived key is stored and MLSContext tops it up on each load.
      if (user) {
        await mls.archiveHistory(user.id).catch((err) =>
          console.warn('[MLS] initial archive failed; it will retry on next load:', err),
        )
      }
      const updated = await updateMe({ backup_downloaded: true })
      updateUser(updated)
    } catch (err) {
      console.error('[MLS] could not record recovery-code setup:', err)
      setError('Saved locally, but we could not update your account. It may ask again next time.')
    } finally {
      setSaving(false)
    }
  }

  function download() {
    if (!code) return
    const body =
      `Chatter recovery code for ${user?.username ?? 'your account'}\n\n` +
      `${code}\n\n` +
      `Keep this somewhere safe and private.\n\n` +
      `What it's for: restoring your message history if you lose access to\n` +
      `every device you've signed in on. If you still have one signed-in\n` +
      `device, you don't need this — linking a new device copies your\n` +
      `history across on its own.\n\n` +
      `Anyone with this code can read your archived message history, and\n` +
      `nobody — including the server — can recover it for you if you lose it.\n`
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `chatter-recovery-code-${user?.username ?? 'account'}.txt`
    a.click()
    URL.revokeObjectURL(url)
    setConfirmed(true)
  }

  async function copy() {
    if (!code) return
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setConfirmed(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg bg-sp-surface p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-sp-text">Save your recovery code</h2>
        <p className="mt-2 text-sm text-sp-muted">
          If you ever lose access to every device you're signed in on, this code is the
          only way to get your message history back. Signing in on a new device while you
          still have another one doesn't need it — your history copies across by itself.
        </p>

        {error && (
          <p className="mt-3 rounded bg-red-500/10 p-2 text-sm text-red-400">{error}</p>
        )}

        {code === null && !error ? (
          <p className="mt-4 text-sm text-sp-muted">Generating…</p>
        ) : code ? (
          <>
            <div className="mt-4 select-all rounded-md bg-sp-input p-3 text-center font-mono text-sm tracking-wider text-sp-text">
              {code}
            </div>
            <div className="mt-3 flex gap-2">
              <button className="btn flex-1" onClick={download}>
                <Icon name="download" size={16} /> Download
              </button>
              <button className="btn flex-1" onClick={copy}>
                <Icon name="copy" size={16} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-3 text-xs text-sp-muted">
              Anyone with this code can read your archived history. It isn't stored anywhere —
              not on this device, not on the server — so it can't be shown again or reset for you.
            </p>
          </>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-3">
          {/* Dismissable on purpose: blocking sign-in over a backup step people
              can complete later trains them to click through warnings. The
              wording changes so the choice is at least an informed one. */}
          <button
            className="text-xs text-sp-muted underline"
            onClick={finish}
            disabled={saving}
          >
            {confirmed ? 'Done' : 'Skip for now'}
          </button>
          <button className="btn btn-primary" onClick={finish} disabled={saving || !confirmed}>
            {saving ? 'Saving…' : "I've saved it"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
