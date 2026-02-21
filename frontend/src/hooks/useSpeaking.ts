import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'

/** RMS of frequency-bin data (0–255 scale) above which the user is "speaking". */
const SPEAKING_THRESHOLD = 10

/** Poll interval in ms. */
const POLL_INTERVAL = 80

/**
 * How many consecutive silent polls before we declare the user has stopped
 * speaking. Prevents rapid flicker on short pauses (3 × 80 ms = 240 ms).
 */
const SILENCE_HOLD_POLLS = 3

function getRms(analyser: AnalyserNode): number {
  const data = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteFrequencyData(data)
  return Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length)
}

/**
 * Detects whether the LOCAL user is speaking using the Web Audio API and
 * notifies the server via `onSpeakingChange` so it can broadcast the state
 * to all peers. Remote participants' speaking state arrives via
 * `voice.state_changed` WS events and lives in the VoiceState participants list.
 *
 * @param localStreamRef    Ref to the local microphone MediaStream.
 * @param onSpeakingChange  Called with `true`/`false` when speaking state changes.
 * @returns                 Whether the local user is currently speaking.
 */
export function useSpeaking(
  localStreamRef: MutableRefObject<MediaStream | null>,
  onSpeakingChange: (isSpeaking: boolean) => void,
): boolean {
  const [isSpeaking, setIsSpeaking] = useState(false)

  const onSpeakingChangeRef = useRef(onSpeakingChange)
  onSpeakingChangeRef.current = onSpeakingChange

  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const speakingRef = useRef(false)
  const silenceCountRef = useRef(0)

  useEffect(() => {
    let timerId: ReturnType<typeof setInterval>

    timerId = setInterval(() => {
      const stream = localStreamRef.current
      if (!stream) return

      // Lazily create AudioContext after the user gesture of joining a channel.
      if (!ctxRef.current) {
        try { ctxRef.current = new AudioContext() } catch { return }
      }
      const ctx = ctxRef.current

      // Chrome suspends AudioContext by policy — resume it and wait for next tick.
      if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); return }

      // Create analyser node once the stream is available.
      if (!analyserRef.current) {
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        analyser.smoothingTimeConstant = 0.4
        ctx.createMediaStreamSource(stream).connect(analyser)
        analyserRef.current = analyser
      }

      const rms = getRms(analyserRef.current)
      const loud = rms > SPEAKING_THRESHOLD

      if (loud) {
        silenceCountRef.current = 0
        if (!speakingRef.current) {
          speakingRef.current = true
          setIsSpeaking(true)
          onSpeakingChangeRef.current(true)
        }
      } else {
        silenceCountRef.current++
        if (speakingRef.current && silenceCountRef.current >= SILENCE_HOLD_POLLS) {
          speakingRef.current = false
          setIsSpeaking(false)
          onSpeakingChangeRef.current(false)
        }
      }
    }, POLL_INTERVAL)

    return () => {
      clearInterval(timerId)
      // If the user was speaking when the hook unmounts (e.g. navigating away),
      // send a final false so the server clears the speaking state.
      if (speakingRef.current) {
        onSpeakingChangeRef.current(false)
      }
      ctxRef.current?.close()
      ctxRef.current = null
      analyserRef.current = null
      speakingRef.current = false
      silenceCountRef.current = 0
    }
  }, [localStreamRef]) // runs once per voice session — reads latest stream via ref

  return isSpeaking
}
