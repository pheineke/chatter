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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 shrink-0 bg-black/80 z-10">
        <button onClick={onClose} className="text-white/70 hover:text-white">
          <Icon name="arrow-back" size={24} />
        </button>
        <span className="text-white font-semibold text-base">Scan QR Code</span>
      </div>

      {/* Camera / content fills remaining */}
      <div className="flex-1 relative flex items-center justify-center">
        {phase === 'scanning' && (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="h-48 w-48 rounded-lg border-2 border-white/60 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
            </div>
            <canvas ref={canvasRef} className="hidden" />
            <p className="absolute bottom-8 text-sm text-white/60 text-center px-4">
              Point at the QR code shown on the new device
            </p>
          </>
        )}

        {phase === 'confirming' && scannedPayload && (
          <div className="flex flex-col items-center gap-6 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sp-mention/20">
              <Icon name="monitor" size={32} className="text-sp-mention" />
            </div>
            <div>
              <p className="font-semibold text-white text-lg">New device wants to log in</p>
              <p className="mt-2 text-sm text-white/60 max-w-xs">
                This will transfer your E2EE key to the new device.
                Only approve if you initiated this login.
              </p>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => { setPhase('scanning'); setScannedPayload(null) }}
                className="px-6 py-2 rounded text-sm text-white/70 border border-white/20 hover:bg-white/10 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                className="px-6 py-2 rounded bg-sp-mention text-sm font-semibold text-white hover:bg-sp-mention/85 transition"
              >
                Approve
              </button>
            </div>
          </div>
        )}

        {phase === 'approving' && (
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-sp-mention border-t-transparent" />
            <p className="text-white/60 text-sm">Transferring keys…</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <Icon name="check-circle" size={48} className="text-sp-online" />
            <p className="text-white font-semibold text-lg">New device approved!</p>
            <p className="text-sm text-white/60">
              The new device can now use Chatter and has your E2EE key.
            </p>
            <button
              onClick={onClose}
              className="mt-2 px-6 py-2 rounded bg-sp-mention text-sm font-semibold text-white hover:bg-sp-mention/85 transition"
            >
              Done
            </button>
          </div>
        )}

        {(phase === 'error' || phase === 'no-camera' || phase === 'no-key') && (
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <Icon name="alert-circle" size={48} className="text-red-400" />
            <p className="text-red-400 text-sm max-w-xs">
              {phase === 'no-camera'
                ? 'Camera access was denied. Please allow camera access and try again.'
                : errorMsg || 'Something went wrong.'}
            </p>
            <button
              onClick={onClose}
              className="mt-2 px-6 py-2 rounded bg-white/10 text-sm text-white/60 hover:text-white transition"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}