/**
 * QRScanner
 *
 * Scans a QR code and approves the QR login session for the new device.
 *
 * Flow (TRUSTED / phone side):
 *  1. Request camera permission and start the video stream.
 *  2. Decode QR frames using jsQR.
 *  3. Parse the payload { type, session_id, device_ephemeral_pk }.
 *  4. Import the new device's ephemeral public key.
 *  5. Load own E2EE private key from context.
 *  6. Encrypt own E2EE private key with:
 *       AES-GCM( ECDH( my_private, device_ephemeral_pub ) )
 *  7. POST /auth/qr/{id}/approve with the encrypted key + own public key.
 *  8. Show success / error.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import {
  importPublicKey,
  exportPublicKey,
  encryptPrivateKeyForTransfer,
} from '../crypto'
import { loadKeyPair } from '../db/keyStore'
import { approveQRSession } from '../api/e2ee'
import { useAuth } from '../contexts/AuthContext'
import { Icon } from './Icon'

type ScanPhase = 'scanning' | 'confirming' | 'approving' | 'done' | 'error' | 'no-camera' | 'no-key'

interface QRPayload {
  type: string
  session_id: string
  device_ephemeral_pk: string
}

interface Props {
  onClose: () => void
}

export function QRScanner({ onClose }: Props) {
  const { user } = useAuth()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)

  const [phase, setPhase] = useState<ScanPhase>('scanning')
  const [scannedPayload, setScannedPayload] = useState<QRPayload | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  // ── Camera setup ────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
      } catch {
        if (!cancelled) setPhase('no-camera')
      }
    }

    startCamera()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // ── Frame scanning ──────────────────────────────────────────────────────

  const tick = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick)
      return
    }

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
          streamRef.current?.getTracks().forEach(t => t.stop())
          setScannedPayload(parsed)
          setPhase('confirming')
          return
        }
      } catch {
        // not a valid payload — keep scanning
      }
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    if (phase !== 'scanning') return
    const video = videoRef.current
    if (!video) return

    const handlePlay = () => {
      rafRef.current = requestAnimationFrame(tick)
    }

    video.addEventListener('play', handlePlay)
    return () => {
      video.removeEventListener('play', handlePlay)
      cancelAnimationFrame(rafRef.current)
    }
  }, [phase, tick])

  // ── Approve ────────────────────────────────────────────────────────────

  const handleApprove = useCallback(async () => {
    if (!scannedPayload || !user) return
    setPhase('approving')

    try {
      const pair = await loadKeyPair(user.id)
      if (!pair) {
        setPhase('no-key')
        setErrorMsg('You do not have an E2EE keypair on this device. Enable E2EE in Settings first.')
        return
      }

      const deviceEphemeralPub = await importPublicKey(scannedPayload.device_ephemeral_pk)
      const encrypted = await encryptPrivateKeyForTransfer(
        pair.privateKey,
        deviceEphemeralPub,
        pair.privateKey,
      )
      const myPubB64 = await exportPublicKey(pair.publicKey)

      await approveQRSession(
        scannedPayload.session_id,
        encrypted.ciphertext,
        encrypted.nonce,
        myPubB64,
      )

      setPhase('done')
    } catch (e: any) {
      setPhase('error')
      setErrorMsg(e?.response?.data?.detail ?? 'Approval failed. The QR code may have expired.')
    }
  }, [scannedPayload, user])

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="relative w-full max-w-md rounded-2xl bg-sp-sidebar p-6 shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-sp-muted hover:text-white"
        >
          <Icon name="x" size={20} />
        </button>

        <h2 className="mb-4 text-center text-xl font-bold text-white">Scan QR Code</h2>

        {phase === 'scanning' && (
          <div className="space-y-4">
            <div className="relative overflow-hidden rounded-xl bg-black aspect-[4/3]">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="h-full w-full object-cover"
              />
              {/* Viewfinder overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="h-48 w-48 rounded-lg border-2 border-sp-mention/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
              </div>
            </div>
            <canvas ref={canvasRef} className="hidden" />
            <p className="text-center text-sm text-sp-muted">
              Point at the QR code shown on the new device
            </p>
          </div>
        )}

        {phase === 'confirming' && scannedPayload && (
          <div className="space-y-5 text-center">
            <div className="flex items-center justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sp-mention/20">
                <Icon name="monitor" size={32} className="text-sp-mention" />
              </div>
            </div>
            <div>
              <p className="font-semibold text-white">New device wants to log in</p>
              <p className="mt-1 text-sm text-sp-muted">
                This will transfer your E2EE key to the new device.
                Only approve if you initiated this login.
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => { setPhase('scanning'); setScannedPayload(null) }}
                className="rounded px-4 py-2 text-sm text-sp-muted hover:bg-sp-input transition"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                className="rounded-m3-sm bg-sp-mention px-6 py-2 text-sm font-semibold text-white hover:bg-sp-mention/85 transition"
              >
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
            <p className="text-white font-semibold">New device approved!</p>
            <p className="text-sm text-sp-muted">
              The new device can now use Chatter and has your E2EE key.
            </p>
            <button
              onClick={onClose}
              className="rounded-m3-sm bg-sp-mention px-6 py-2 text-sm font-semibold text-white hover:bg-sp-mention/85 transition"
            >
              Done
            </button>
          </div>
        )}

        {(phase === 'error' || phase === 'no-camera' || phase === 'no-key') && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <Icon name="alert-circle" size={40} className="text-red-400" />
            <p className="text-red-400 text-sm max-w-xs">
              {phase === 'no-camera'
                ? 'Camera access was denied. Please allow camera access and try again.'
                : errorMsg || 'Something went wrong.'}
            </p>
            <button
              onClick={onClose}
              className="rounded bg-sp-input px-6 py-2 text-sm font-semibold text-sp-muted hover:text-white transition"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
