/**
 * QRLoginPage
 *
 * Shown when the user visits /qr-login (or clicks "Scan with phone" on the
 * standard login page).
 *
 * Flow on this page (NEW / untrusted device):
 *  1. Generate an ephemeral ECDH keypair (in-memory).
 *  2. POST /auth/qr/challenge with the ephemeral public key → get session_id.
 *  3. Display a QR code encoding:  { session_id, device_ephemeral_pk }
 *  4. Poll GET /auth/qr/{id}/status every 2 s.
 *  5. When status === "approved":
 *     a. Import the approver's E2EE public key.
 *     b. Decrypt the encrypted E2EE private key using
 *        ECDH(my ephemeral private key, approver's E2EE public key) → AES-GCM.
 *     c. Persist the received keypair to IndexedDB.
 *     d. Call loginWithTokens(access_token, refresh_token) → navigate to app.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import {
  generateEphemeralKeyPair,
  exportPublicKey,
  importPublicKey,
  decryptPrivateKeyFromTransfer,
} from '../crypto'
import { saveKeyPair } from '../db/keyStore'
import { createQRChallenge, pollQRStatus } from '../api/e2ee'
import { useAuth } from '../contexts/AuthContext'
import { Icon } from '../components/Icon'

type Phase = 'initialising' | 'waiting' | 'scanned' | 'approved' | 'expired' | 'error'

export default function QRLoginPage() {
  const { loginWithTokens } = useAuth()
  const navigate = useNavigate()

  const [phase, setPhase] = useState<Phase>('initialising')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [qrPayload, setQrPayload] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(120)
  const [errorMsg, setErrorMsg] = useState('')

  // Keep references to the ephemeral key pair (not serialisable to state)
  const ephemeralPairRef = useRef<CryptoKeyPair | null>(null)

  // ── Initialise session ─────────────────────────────────────────────────

  const startSession = useCallback(async () => {
    setPhase('initialising')
    setErrorMsg('')
    try {
      const pair = await generateEphemeralKeyPair()
      ephemeralPairRef.current = pair
      const pubB64 = await exportPublicKey(pair.publicKey)
      const session = await createQRChallenge(pubB64)
      setSessionId(session.session_id)
      // Embed everything the phone needs
      setQrPayload(
        JSON.stringify({
          type: 'chatter-qr-login-v1',
          session_id: session.session_id,
          device_ephemeral_pk: session.device_ephemeral_pk,
        }),
      )
      setSecondsLeft(120)
      setPhase('waiting')
    } catch (e) {
      setPhase('error')
      setErrorMsg('Could not contact the server. Please try again.')
    }
  }, [])

  useEffect(() => {
    startSession()
  }, [startSession])

  // ── Polling ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'scanned') return
    if (!sessionId) return

    let cancelled = false

    const poll = async () => {
      try {
        const resp = await pollQRStatus(sessionId)

        if (cancelled) return

        if (resp.status === 'scanned') {
          setPhase('scanned')
        } else if (resp.status === 'expired') {
          setPhase('expired')
        } else if (resp.status === 'approved') {
          setPhase('approved')
          clearInterval(handle)

          // Decrypt and persist the received private key
          const ephemeral = ephemeralPairRef.current
          if (
            !ephemeral ||
            !resp.approver_e2ee_public_key ||
            !resp.encrypted_private_key ||
            !resp.encryption_nonce ||
            !resp.access_token ||
            !resp.refresh_token
          ) {
            setPhase('error')
            setErrorMsg('Incomplete approval data received from server.')
            return
          }

          const approverPub = await importPublicKey(resp.approver_e2ee_public_key)
          const privateKey = await decryptPrivateKeyFromTransfer(
            ephemeral.privateKey,
            approverPub,
            resp.encrypted_private_key,
            resp.encryption_nonce,
          )

          if (!privateKey) {
            setPhase('error')
            setErrorMsg('Failed to decrypt the transferred key. Please try again.')
            return
          }

          // We need the user ID to save the key, but we don't know it yet.
          // loginWithTokens will set the user; we save under a temporary key
          // and re-save under the real userId in the E2EEProvider init.
          // For now, store under the approver's public key fingerprint as a temp key.
          // On E2EEProvider mount it will load the pair and skip generation.
          //
          // Alternative: loginWithTokens and then persist in E2EEContext.
          // We use a "pending" key in localStorage to pass the pair across the navigation.
          const tempPub = await exportPublicKey(approverPub)
          const transferPair: CryptoKeyPair = {
            publicKey: approverPub,
            privateKey,
          }

          // We will save it under the real userId after login
          // (E2EEContext checks IndexedDB on mount; if it finds nothing, it generates a new pair)
          // To bridge the gap, store the base64 private key in sessionStorage for
          // the E2EEContext to pick up on first mount.
          const privB64 = await exportPublicKey(approverPub) // just for type safety below
          void privB64 // suppress unused warning — we derive again in E2EEContext
          sessionStorage.setItem(
            '__e2ee_pending_private_key__',
            JSON.stringify({
              publicKey: tempPub,
              privateKey: await (async () => {
                const buf = await crypto.subtle.exportKey('pkcs8', privateKey)
                return btoa(String.fromCharCode(...new Uint8Array(buf)))
              })(),
            }),
          )

          await loginWithTokens(resp.access_token, resp.refresh_token)
          navigate('/channels/@me', { replace: true })
        }
      } catch {
        if (!cancelled) {
          setPhase('error')
          setErrorMsg('Lost connection to server.')
          clearInterval(handle)
        }
      }
    }

    const handle = setInterval(poll, 2000)

    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [phase, sessionId, loginWithTokens, navigate])

  // ── Countdown timer ────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'scanned') return
    if (secondsLeft <= 0) {
      setPhase('expired')
      return
    }
    const t = setTimeout(() => setSecondsLeft(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [phase, secondsLeft])

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen items-center justify-center bg-sp-bg">
      <div className="flex w-full max-w-4xl overflow-hidden rounded-2xl bg-sp-sidebar shadow-2xl">
        {/* Left panel */}
        <div className="flex w-1/2 flex-col items-center justify-center gap-6 bg-sp-bg px-8 py-12">
          <h2 className="text-2xl font-bold text-white text-center">Log in with QR Code</h2>
          <p className="text-center text-sm text-sp-muted leading-relaxed">
            Scan this code with your phone.<br />
            Logging in this way gives the new device your E2EE key — no password needed.
          </p>

          {/* QR code area */}
          <div className="relative flex items-center justify-center rounded-2xl bg-white p-4 shadow-md w-56 h-56">
            {phase === 'initialising' && (
              <div className="flex flex-col items-center gap-3 text-sp-muted text-sm">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-sp-mention border-t-transparent" />
                Generating…
              </div>
            )}

            {(phase === 'waiting' || phase === 'scanned') && qrPayload && (
              <QRCodeSVG
                value={qrPayload}
                size={192}
                bgColor="#ffffff"
                fgColor="#1e1f22"
                level="M"
              />
            )}

            {phase === 'expired' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-sp-bg/90 backdrop-blur-sm">
                <Icon name="clock" size={32} className="text-sp-muted" />
                <span className="text-sm text-sp-muted">Expired</span>
              </div>
            )}

            {phase === 'approved' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-sp-online/20 backdrop-blur-sm">
                <Icon name="check-circle" size={32} className="text-sp-online" />
                <span className="text-sm text-sp-online font-semibold">Approved!</span>
              </div>
            )}

            {phase === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-sp-dnd/20 backdrop-blur-sm">
                <Icon name="alert-circle" size={32} className="text-red-400" />
                <span className="text-xs text-red-400 text-center px-2">{errorMsg}</span>
              </div>
            )}
          </div>

          {/* Status line */}
          {(phase === 'waiting' || phase === 'scanned') && (
            <div className="flex items-center gap-2 text-sm">
              {phase === 'scanned' ? (
                <>
                  <Icon name="smartphone" size={16} className="text-sp-online" />
                  <span className="text-sp-online font-medium">Phone connected — awaiting approval…</span>
                </>
              ) : (
                <>
                  <div className="h-2 w-2 animate-pulse rounded-full bg-sp-mention" />
                  <span className="text-sp-muted">Waiting for scan — expires in {secondsLeft}s</span>
                </>
              )}
            </div>
          )}

          {(phase === 'expired' || phase === 'error') && (
            <button
              onClick={startSession}
              className="rounded-m3-sm bg-sp-mention px-4 py-2 text-sm font-semibold text-white hover:bg-sp-mention/85 transition flex items-center gap-2"
            >
              <Icon name="refresh-cw" size={16} />
              Generate New Code
            </button>
          )}
        </div>

        {/* Right panel — instructions */}
        <div className="flex w-1/2 flex-col justify-center gap-6 px-10 py-12">
          <h3 className="text-lg font-bold text-white">How to use</h3>
          <ol className="space-y-4 text-sm text-sp-muted">
            {[
              { icon: 'smartphone', text: 'Open Chatter on your phone (or another trusted device where you\'re already logged in).' },
              { icon: 'settings', text: 'Go to Settings →  Scan QR Code.' },
              { icon: 'camera', text: 'Point the camera at the QR code on this screen.' },
              { icon: 'check-circle', text: 'Tap Approve to log in instantly. Your E2EE keys will be transferred securely.' },
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sp-mention/20 text-xs font-bold text-sp-mention">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{step.text}</span>
              </li>
            ))}
          </ol>

          <div className="mt-2 rounded-lg bg-sp-bg px-4 py-3 text-xs text-sp-muted border border-sp-input">
            <Icon name="shield" size={12} className="inline mr-1 text-sp-online" />
            Your password is never transmitted. Keys are exchanged using{' '}
            <strong className="text-white">ECDH P-256</strong> — even the server cannot read them.
          </div>

          <Link
            to="/login"
            className="text-sm text-sp-mention hover:underline"
          >
            ← Back to password login
          </Link>
        </div>
      </div>
    </div>
  )
}
