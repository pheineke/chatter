/**
 * QRLoginPage
 *
 * Shown when the user visits /qr-login.
 *
 * BEHAVIOR BY DEVICE:
 * - Desktop: Show a QR code for a phone to scan. The desktop generates an
 *   ephemeral ECDH keypair, POSTs a challenge to the server, displays the QR.
 *   Polls until the phone approves.
 *
 * - Mobile: Open the camera and scan a QR code shown on the desktop screen.
 *   Requires the user to already be logged in (to approve the session +
 *   transfer the E2EE key). If not logged in, shows a prompt to log in first.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import jsQR from 'jsqr'
import {
  generateEphemeralKeyPair,
  exportPublicKey,
  importPublicKey,
  decryptPrivateKeyFromTransfer,
  encryptPrivateKeyForTransfer,
} from '../crypto'
import { loadKeyPair } from '../db/keyStore'
import { createQRChallenge, pollQRStatus, approveQRSession } from '../api/e2ee'
import { useAuth } from '../contexts/AuthContext'
import { Icon } from '../components/Icon'

const isMobile = typeof window !== 'undefined' && 'maxTouchPoints' in navigator && navigator.maxTouchPoints > 0

type HostPhase = 'initialising' | 'waiting' | 'scanned' | 'approved' | 'expired' | 'error'
type ScanPhase = 'checking' | 'need-login' | 'ready-scan' | 'scanning' | 'confirming' | 'approving' | 'done' | 'error'

export default function QRLoginPage() {
  const { user, loginWithTokens } = useAuth()

  if (isMobile) {
    return <MobileQRScanner loginWithTokens={loginWithTokens} />
  }

  return <DesktopQRHost loginWithTokens={loginWithTokens} />
}

// ─── DESKTOP: show QR code ────────────────────────────────────────────────

function DesktopQRHost({ loginWithTokens }: { loginWithTokens: (at: string, rt: string) => Promise<void> }) {
  const navigate = useNavigate()

  const [phase, setPhase] = useState<HostPhase>('initialising')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [qrPayload, setQrPayload] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(120)
  const [errorMsg, setErrorMsg] = useState('')

  const ephemeralPairRef = useRef<CryptoKeyPair | null>(null)

  const startSession = useCallback(async () => {
    setPhase('initialising')
    setErrorMsg('')
    try {
      const pair = await generateEphemeralKeyPair()
      ephemeralPairRef.current = pair
      const pubB64 = await exportPublicKey(pair.publicKey)
      const session = await createQRChallenge(pubB64)
      setSessionId(session.session_id)
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

  useEffect(() => { startSession() }, [startSession])

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
          const ephemeral = ephemeralPairRef.current
          if (!ephemeral || !resp.approver_e2ee_public_key || !resp.encrypted_private_key || !resp.encryption_nonce || !resp.access_token || !resp.refresh_token) {
            setPhase('error')
            setErrorMsg('Incomplete approval data received from server.')
            return
          }
          const approverPub = await importPublicKey(resp.approver_e2ee_public_key)
          const privateKey = await decryptPrivateKeyFromTransfer(ephemeral.privateKey, approverPub, resp.encrypted_private_key, resp.encryption_nonce)
          if (!privateKey) {
            setPhase('error')
            setErrorMsg('Failed to decrypt the transferred key. Please try again.')
            return
          }
          const tempPub = await exportPublicKey(approverPub)
          sessionStorage.setItem('__e2ee_pending_private_key__', JSON.stringify({
            publicKey: tempPub,
            privateKey: await (async () => {
              const buf = await crypto.subtle.exportKey('pkcs8', privateKey)
              return btoa(String.fromCharCode(...new Uint8Array(buf)))
            })(),
          }))
          await loginWithTokens(resp.access_token, resp.refresh_token)
          navigate('/channels/@me', { replace: true })
        }
      } catch {
        if (!cancelled) { setPhase('error'); setErrorMsg('Lost connection to server.'); clearInterval(handle) }
      }
    }
    const handle = setInterval(poll, 2000)
    return () => { cancelled = true; clearInterval(handle) }
  }, [phase, sessionId, loginWithTokens, navigate])

  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'scanned') return
    if (secondsLeft <= 0) { setPhase('expired'); return }
    const t = setTimeout(() => setSecondsLeft(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [phase, secondsLeft])

  return (
    <div className="flex h-screen items-center justify-center bg-sp-bg">
      <div className="flex w-full max-w-4xl overflow-hidden rounded-sp-xl bg-sp-popup border border-sp-divider/50" style={{ boxShadow: 'var(--sp-shadow-2)' }}>
        <div className="flex w-1/2 flex-col items-center justify-center gap-6 bg-sp-bg px-8 py-12">
          <h2 className="text-2xl font-bold text-sp-text text-center">Log in with QR Code</h2>
          <p className="text-center text-sm text-sp-muted leading-relaxed">
            Scan this code with your phone.<br />
            No password needed — your E2EE key will be transferred securely.
          </p>
          <div className="relative flex items-center justify-center rounded-2xl bg-white p-4 shadow-md w-56 h-56">
            {phase === 'initialising' && (
              <div className="flex flex-col items-center gap-3 text-sp-muted text-sm">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-sp-mention border-t-transparent" />
                Generating…
              </div>
            )}
            {(phase === 'waiting' || phase === 'scanned') && qrPayload && (
              <QRCodeSVG value={qrPayload} size={192} bgColor="#ffffff" fgColor="#1e1f22" level="M" />
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
            <button onClick={startSession} className="rounded-m3-sm bg-sp-mention px-4 py-2 text-sm font-semibold text-white hover:bg-sp-mention/85 transition flex items-center gap-2">
              <Icon name="refresh-cw" size={16} />
              Generate New Code
            </button>
          )}
        </div>
        <div className="flex w-1/2 flex-col justify-center gap-6 px-10 py-12">
          <h3 className="text-lg font-bold text-white">How to use</h3>
          <ol className="space-y-4 text-sm text-sp-muted">
            {[
              { icon: 'smartphone', text: 'Open Chatter on your phone (or another trusted device where you\'re already logged in).' },
              { icon: 'camera', text: 'Point your phone\'s camera at the QR code on this screen.' },
              { icon: 'check-circle', text: 'Tap Approve to log in instantly. Your E2EE keys will be transferred securely.' },
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sp-mention/20 text-xs font-bold text-sp-mention">{i + 1}</span>
                <span className="leading-relaxed">{step.text}</span>
              </li>
            ))}
          </ol>
          <div className="mt-2 rounded-lg bg-sp-bg px-4 py-3 text-xs text-sp-muted border border-sp-input">
            <Icon name="shield" size={12} className="inline mr-1 text-sp-online" />
            Your password is never transmitted. Keys are exchanged using <strong className="text-white">ECDH P-256</strong> — even the server cannot read them.
          </div>
          <Link to="/login" className="text-sm text-sp-mention hover:underline">← Back to password login</Link>
        </div>
      </div>
    </div>
  )
}

// ─── MOBILE: scan QR code ──────────────────────────────────────────────────

interface QRPayload { type: string; session_id: string; device_ephemeral_pk: string }

function MobileQRScanner({ loginWithTokens }: { loginWithTokens: (at: string, rt: string) => Promise<void> }) {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [phase, setPhase] = useState<ScanPhase>('checking')
  const [scannedPayload, setScannedPayload] = useState<QRPayload | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [doneNavigate, setDoneNavigate] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    cancelAnimationFrame(rafRef.current)
  }, [])

  const startCamera = useCallback(async () => {
    setPhase('scanning')
    try {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch {
      setPhase('error')
      setErrorMsg('Camera could not be started. If you are using the PWA, open this page in your browser (tap the three dots → "Open in Chrome"). Otherwise, check camera permissions.')
    }
  }, [])

  useEffect(() => {
    if (!user) { setPhase('need-login'); return }
    setPhase('ready-scan')
  }, [user])

  const tick = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < video.HAVE_ENOUGH_DATA) { rafRef.current = requestAnimationFrame(tick); return }
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0)
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const code = jsQR(imgData.data, imgData.width, imgData.height)
    if (code) {
      try {
        const parsed = JSON.parse(code.data) as QRPayload
        if (parsed.type === 'chatter-qr-login-v1' && parsed.session_id && parsed.device_ephemeral_pk) {
          cancelAnimationFrame(rafRef.current)
          stopCamera()
          setScannedPayload(parsed)
          setPhase('confirming')
          return
        }
      } catch {}
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stopCamera])

  useEffect(() => {
    if (phase !== 'scanning') return
    const video = videoRef.current
    if (!video) return
    const onPlay = () => { rafRef.current = requestAnimationFrame(tick) }
    video.addEventListener('play', onPlay)
    return () => { video.removeEventListener('play', onPlay); cancelAnimationFrame(rafRef.current) }
  }, [phase, tick])

  const handleApprove = useCallback(async () => {
    if (!scannedPayload || !user) return
    setPhase('approving')
    try {
      const pair = await loadKeyPair(user.id)
      if (!pair) {
        setPhase('error')
        setErrorMsg('No E2EE keypair found on this device. Enable E2EE in Settings first.')
        return
      }
      const deviceEphemeralPub = await importPublicKey(scannedPayload.device_ephemeral_pk)
      const encrypted = await encryptPrivateKeyForTransfer(pair.privateKey, deviceEphemeralPub, pair.privateKey)
      const myPubB64 = await exportPublicKey(pair.publicKey)
      await approveQRSession(scannedPayload.session_id, encrypted.ciphertext, encrypted.nonce, myPubB64)
      setPhase('done')
    } catch (e: any) {
      setPhase('error')
      setErrorMsg(e?.response?.data?.detail || 'Approval failed. The QR code may have expired.')
    }
  }, [scannedPayload, user])

  useEffect(() => {
    if (phase === 'done' && !doneNavigate) {
      setDoneNavigate(true)
      const t = setTimeout(() => navigate('/channels/@me', { replace: true }), 2000)
      return () => clearTimeout(t)
    }
  }, [phase, doneNavigate, navigate])

  return (
    <div className="flex flex-col min-h-dvh bg-sp-bg">
      {/* Header */}
      <div className="flex items-center px-4 h-12 shrink-0 border-b border-sp-divider/60">
        <Link to="/login" className="text-sp-muted hover:text-sp-text mr-auto"><Icon name="arrow-back" size={20} /></Link>
        <h1 className="font-bold text-sp-text text-sm">Scan QR Code</h1>
        <div className="w-5" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-4">
        {phase === 'checking' && (
          <div className="flex flex-col items-center gap-4 text-sp-muted">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-sp-mention border-t-transparent" />
            <span className="text-sm">Checking login status…</span>
          </div>
        )}

        {phase === 'need-login' && (
          <div className="flex flex-col items-center gap-4 text-center">
            <Icon name="lock" size={40} className="text-sp-muted" />
            <p className="text-sp-text font-semibold">You need to be logged in to scan a QR code</p>
            <p className="text-sm text-sp-muted">
              Log in with your password on this device first, then scan the QR code shown on your desktop.
            </p>
            <Link
              to="/login"
              className="rounded-full bg-sp-mention px-6 py-2 text-sm font-semibold text-white hover:bg-sp-mention/85 transition"
            >
              Go to Login
            </Link>
          </div>
        )}

        {phase === 'ready-scan' && (
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-sp-mention/20">
              <Icon name="camera" size={40} className="text-sp-mention" />
            </div>
            <p className="text-sp-text font-semibold">Scan a QR code from your desktop</p>
            <p className="text-sm text-sp-muted max-w-xs">
              Open the Chatter login page on your desktop, then scan the QR code shown there.
            </p>
            <button
              onClick={() => { void startCamera() }}
              className="rounded-full bg-sp-mention px-8 py-3 text-sm font-semibold text-white hover:bg-sp-mention/85 transition shadow-sp-2"
            >
              Start Scanning
            </button>
          </div>
        )}

        {phase === 'scanning' && (
          <div className="space-y-4 w-full max-w-sm">
            <div className="relative overflow-hidden rounded-xl bg-black aspect-[4/3]">
              <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="h-48 w-48 rounded-lg border-2 border-sp-mention/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
              </div>
            </div>
            <canvas ref={canvasRef} className="hidden" />
            <p className="text-sm text-sp-muted text-center">Point your camera at the QR code on your desktop screen</p>
          </div>
        )}

        {phase === 'confirming' && scannedPayload && (
          <div className="space-y-5 text-center max-w-sm">
            <div className="flex items-center justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sp-mention/20">
                <Icon name="monitor" size={32} className="text-sp-mention" />
              </div>
            </div>
            <div>
              <p className="font-semibold text-sp-text text-lg">New device wants to log in</p>
              <p className="mt-1 text-sm text-sp-muted">This will transfer your E2EE key to the new device. Only approve if you initiated this login.</p>
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => { setPhase('scanning'); setScannedPayload(null); location.reload() }} className="rounded px-4 py-2 text-sm text-sp-muted hover:bg-sp-input transition">
                Cancel
              </button>
              <button onClick={handleApprove} className="rounded bg-sp-mention px-6 py-2 text-sm font-semibold text-white hover:bg-sp-mention/85 transition">
                Approve
              </button>
            </div>
          </div>
        )}

        {phase === 'approving' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-sp-mention border-t-transparent" />
            <p className="text-sp-muted text-sm">Transferring keys…</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <Icon name="check-circle" size={40} className="text-sp-online" />
            <p className="text-sp-text font-semibold text-lg">Approved!</p>
            <p className="text-sm text-sp-muted">Redirecting…</p>
          </div>
        )}

        {(phase === 'error') && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <Icon name="alert-circle" size={40} className="text-red-400" />
            <p className="text-red-400 text-sm max-w-xs">{errorMsg}</p>
            <button onClick={() => navigate('/login')} className="rounded bg-sp-input px-6 py-2 text-sm font-semibold text-sp-muted hover:text-sp-text transition">
              Back to Login
            </button>
          </div>
        )}
      </div>
    </div>
  )
}