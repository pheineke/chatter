import { useEffect, useState } from 'react'
import { getQRSessionInfo, type QRSessionInfo } from '../api/e2ee'
import { describeUserAgent } from '../utils/userAgent'
import { Icon } from './Icon'

interface Props {
  sessionId: string
  onApprove: () => void
  onCancel: () => void
  /** Rendered over the black camera view (QRScanner) instead of the app background. */
  onDark?: boolean
}

/**
 * Confirmation shown on the trusted device after it scans a login QR.
 *
 * QRLjacking: an attacker can show you *their* QR code (on a phishing page, in
 * a chat, on a sign) and, if you approve it, receive your session and E2EE key.
 * So before approving we show where the request really came from and ask the
 * user to confirm the device is in front of them (security_pass S18).
 */
export function QRApprovalPrompt({ sessionId, onApprove, onCancel, onDark }: Props) {
  const [info, setInfo] = useState<QRSessionInfo | null>(null)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    let cancelled = false
    getQRSessionInfo(sessionId)
      .then((i) => { if (!cancelled) setInfo(i) })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.detail ?? 'This QR code is no longer valid.')
      })
    return () => { cancelled = true }
  }, [sessionId])

  const text = onDark ? 'text-white' : 'text-sp-text'
  const muted = onDark ? 'text-white/60' : 'text-sp-muted'
  const panel = onDark ? 'bg-white/10' : 'bg-sp-input'
  const outline = onDark ? 'border-white/20 hover:bg-white/10' : 'border-sp-divider/50 hover:bg-sp-input'

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 px-6 text-center max-w-sm">
        <Icon name="alert-circle" size={40} className="text-red-400" />
        <p className="text-red-400 text-sm">{error}</p>
        <button onClick={onCancel} className={`px-6 py-2 rounded text-sm ${muted} border ${outline} transition`}>
          Back
        </button>
      </div>
    )
  }

  if (!info) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-sp-mention border-t-transparent" />
        <p className={`text-sm ${muted}`}>Checking the login request…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-5 px-6 text-center max-w-sm">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sp-mention/20">
        <Icon name="monitor" size={32} className="text-sp-mention" />
      </div>
      <div>
        <p className={`font-semibold text-lg ${text}`}>Log in on another device?</p>
        <p className={`mt-1 text-sm ${muted}`}>
          This signs that device into your account and gives it your E2EE key.
        </p>
      </div>

      <dl className={`w-full rounded-lg ${panel} px-4 py-3 text-left text-sm space-y-1`}>
        <div className="flex justify-between gap-3">
          <dt className={muted}>Device</dt>
          <dd className={`${text} font-medium`}>{describeUserAgent(info.requester_user_agent)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className={muted}>IP address</dt>
          <dd className={`${text} font-mono text-xs break-all`}>{info.requester_ip ?? 'unknown'}</dd>
        </div>
      </dl>

      {!info.same_network && (
        <div role="alert" className="flex items-start gap-2 w-full rounded-lg bg-red-500/15 px-3 py-2 text-left text-sm text-red-300">
          <Icon name="alert-triangle" size={16} className="mt-0.5 shrink-0" />
          <span>
            This request comes from a <strong>different network</strong> than this device.
            If someone sent you this QR code, or it's on a website, do not approve it.
          </span>
        </div>
      )}

      <label className={`flex items-start gap-2 text-left text-sm ${text} cursor-pointer`}>
        <input
          type="checkbox"
          className="mt-0.5 accent-sp-mention"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>I'm logging in on this device myself, and it's in front of me right now.</span>
      </label>

      <div className="flex gap-3">
        <button onClick={onCancel} className={`px-6 py-2 rounded text-sm ${muted} border ${outline} transition`}>
          Cancel
        </button>
        <button
          onClick={onApprove}
          disabled={!confirmed}
          className="px-6 py-2 rounded bg-sp-mention text-sm font-semibold text-white hover:bg-sp-mention/85 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          Approve
        </button>
      </div>
    </div>
  )
}
