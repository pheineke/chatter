import { useState, useRef, useCallback, useEffect } from 'react'
import type { VoiceParticipant } from '../api/types'
import { useWebSocket } from './useWebSocket'

interface UseVoiceChannelOptions {
  channelId: string | null
  userId: string
}

export interface VoiceState {
  participants: VoiceParticipant[]
  isMuted: boolean
  isDeafened: boolean
  isSharingScreen: boolean
  isSharingWebcam: boolean
}

/**
 * Manages a voice channel connection:
 *  - Maintains participant list via WS events
 *  - Holds local mute/deafen/screen/webcam state and signals changes
 *  - Manages WebRTC peer connections for audio/video
 */
export function useVoiceChannel({ channelId, userId }: UseVoiceChannelOptions) {
  const [state, setState] = useState<VoiceState>({
    participants: [],
    isMuted: false,
    isDeafened: false,
    isSharingScreen: false,
    isSharingWebcam: false,
  })

  // Map of peerId → RTCPeerConnection
  const peers = useRef<Map<string, RTCPeerConnection>>(new Map())
  const localStream = useRef<MediaStream | null>(null)
  // ICE candidates received before setRemoteDescription is applied are queued here
  const iceCandidateQueue = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null)
  // Only open the voice WebSocket after the local audio stream has been acquired
  // (or the attempt has definitively failed). This ensures localStream.current is
  // populated before the first offer/answer exchange happens.
  const [streamReady, setStreamReady] = useState(false)

  /**
   * Tie-breaking: the peer with the lexicographically smaller user ID is the
   * "impolite" side and always initiates calls. The other side only answers.
   * This eliminates the WebRTC glare condition (both sides sending offers
   * simultaneously).
   */
  const isImpolite = useCallback((peerId: string) => userId < peerId, [userId])

  const { send } = useWebSocket(
    channelId && streamReady ? `/ws/voice/${channelId}` : '',
    {
      enabled: channelId !== null && streamReady,
      onMessage: (msg) => {
        switch (msg.type) {
          case 'voice.members': {
            const members = (msg.data as VoiceParticipant[]).filter(
              (p) => p.user_id !== userId,
            )
            setState((s) => ({ ...s, participants: members }))
            // Only the impolite side (lower ID) initiates to each existing member
            members.forEach((p) => { if (isImpolite(p.user_id)) initiateCall(p.user_id) })
            break
          }
          case 'voice.user_joined': {
            const p = msg.data as VoiceParticipant
            if (p.user_id === userId) break
            setState((s) => ({ ...s, participants: [...s.participants, p] }))
            // Only initiate if we are the impolite side
            if (isImpolite(p.user_id)) initiateCall(p.user_id)
            break
          }
          case 'voice.user_left': {
            const { user_id } = msg.data as { user_id: string }
            setState((s) => ({ ...s, participants: s.participants.filter((p) => p.user_id !== user_id) }))
            cleanupPeer(user_id)
            break
          }
          case 'voice.state_changed': {
            const updated = msg.data as VoiceParticipant
            if (updated.user_id === userId) break
            setState((s) => ({
              ...s,
              participants: s.participants.map((p) =>
                p.user_id === updated.user_id ? updated : p,
              ),
            }))
            break
          }
          case 'offer': {
            handleOffer(msg.from as string, msg.sdp as string)
            break
          }
          case 'answer': {
            handleAnswer(msg.from as string, msg.sdp as string)
            break
          }
          case 'ice_candidate': {
            handleIce(msg.from as string, msg.candidate as RTCIceCandidateInit)
            break
          }
        }
      },
    },
  )

  // --- WebRTC helpers -------------------------------------------------------

  /**
   * Flush any ICE candidates that arrived before setRemoteDescription was
   * called. Must be called immediately after every setRemoteDescription.
   */
  const flushIceCandidates = useCallback(async (peerId: string) => {
    const pc = peers.current.get(peerId)
    if (!pc) return
    const queued = iceCandidateQueue.current.get(peerId) ?? []
    iceCandidateQueue.current.delete(peerId)
    for (const candidate of queued) {
      try { await pc.addIceCandidate(candidate) } catch { /* ignore stale/out-of-order */ }
    }
  }, [])

  /**
   * Build and register a new RTCPeerConnection for `peerId`.
   * Memoised so that initiateCall / handleOffer always close over the same
   * stable function — avoiding subtle issues if the component re-renders
   * between the call being initiated and the answer arriving.
   */
  const createPeer = useCallback((peerId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    })

    // Add every local audio track so the remote side receives our mic.
    const stream = localStream.current
    if (stream) {
      stream.getAudioTracks().forEach(track => pc.addTrack(track, stream))
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) send({ type: 'ice_candidate', to: peerId, candidate: candidate.toJSON() })
    }

    // Automatically attempt ICE restart if the connection drops.
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce()
    }

    pc.ontrack = ({ track, streams }) => {
      // e.streams[0] can be undefined if the sender didn't bundle the track
      // into a named stream — fall back to wrapping it ourselves.
      const remoteStream = streams[0] ?? new MediaStream([track])

      if (track.kind === 'audio') {
        const elId = `audio-${peerId}`
        let audio = document.getElementById(elId) as HTMLAudioElement | null
        if (!audio) {
          audio = Object.assign(document.createElement('audio'), {
            id: elId,
            autoplay: true,
          })
          document.body.appendChild(audio)
        }
        audio.srcObject = remoteStream
        // Explicit play() is required — autoplay alone is blocked by browser policy.
        const tryPlay = () =>
          audio!.play().catch(() => document.addEventListener('click', tryPlay, { once: true }))
        tryPlay()
      }

      setRemoteStreams(prev => {
        // Keep audio stream reference stable: only overwrite if we don't have
        // one yet, or if this is a video track update.
        if (track.kind === 'video' || !prev[peerId]) {
          return { ...prev, [peerId]: remoteStream }
        }
        return prev
      })
    }

    peers.current.set(peerId, pc)
    return pc
  }, [send])

  const initiateCall = useCallback(async (peerId: string) => {
    const pc = createPeer(peerId)
    // offerToReceiveAudio ensures the SDP has an active audio m-section even
    // if the local mic is currently muted (track enabled=false still adds the
    // track; the remote side still sees the sendrecv direction).
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
    await pc.setLocalDescription(offer)
    send({ type: 'offer', to: peerId, sdp: offer.sdp })
  }, [createPeer, send])

  const handleOffer = useCallback(async (peerId: string, sdp: string) => {
    // Tear down any previous connection for this peer (e.g. after a reconnect).
    if (peers.current.has(peerId)) {
      peers.current.get(peerId)!.close()
      peers.current.delete(peerId)
    }
    const pc = createPeer(peerId)
    await pc.setRemoteDescription({ type: 'offer', sdp })
    // Flush candidates that arrived before setRemoteDescription.
    await flushIceCandidates(peerId)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    send({ type: 'answer', to: peerId, sdp: answer.sdp })
  }, [createPeer, flushIceCandidates, send])

  const handleAnswer = useCallback(async (peerId: string, sdp: string) => {
    const pc = peers.current.get(peerId)
    if (!pc) return
    if (pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription({ type: 'answer', sdp })
      await flushIceCandidates(peerId)
    }
  }, [flushIceCandidates])

  const handleIce = useCallback(async (peerId: string, candidate: RTCIceCandidateInit) => {
    const pc = peers.current.get(peerId)
    if (!pc) return
    if (pc.remoteDescription == null) {
      // Remote description not yet applied — queue the candidate.
      const q = iceCandidateQueue.current.get(peerId) ?? []
      q.push(candidate)
      iceCandidateQueue.current.set(peerId, q)
      return
    }
    try { await pc.addIceCandidate(candidate) } catch { /* ignore stale candidates */ }
  }, [])

  const cleanupPeer = useCallback((peerId: string) => {
    peers.current.get(peerId)?.close()
    peers.current.delete(peerId)
    iceCandidateQueue.current.delete(peerId)
    document.getElementById(`audio-${peerId}`)?.remove()
    setRemoteStreams(prev => { const next = { ...prev }; delete next[peerId]; return next })
  }, [])

  // --- Local media ----------------------------------------------------------

  const acquireMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      localStream.current = stream
    } catch {
      console.warn('Microphone access denied')
    } finally {
      // Signal that the media acquisition attempt is complete (success or failure)
      // so the WebSocket connection can now be opened safely.
      setStreamReady(true)
    }
  }, [])

  useEffect(() => {
    if (!channelId) return
    // Reset streamReady so the WebSocket waits for the new stream on every
    // channel join (including when switching channels).
    setStreamReady(false)
    acquireMedia()
    return () => {
      localStream.current?.getTracks().forEach((t) => t.stop())
      localStream.current = null
      peers.current.forEach((pc) => pc.close())
      peers.current.clear()
      iceCandidateQueue.current.clear()
    }
  }, [channelId, acquireMedia])

  // --- Controls -------------------------------------------------------------

  const toggleMute = useCallback(() => {
    setState((s) => {
      const next = !s.isMuted
      localStream.current?.getAudioTracks().forEach((t) => { t.enabled = !next })
      send({ type: 'mute', is_muted: next })
      return { ...s, isMuted: next }
    })
  }, [send])

  const toggleDeafen = useCallback(() => {
    setState((s) => {
      const next = !s.isDeafened
      // Mute all remote audio when deafened
      document.querySelectorAll('audio[id^="audio-"]').forEach((el) => {
        (el as HTMLAudioElement).muted = next
      })
      send({ type: 'deafen', is_deafened: next })
      return { ...s, isDeafened: next }
    })
  }, [send])

  const sendSpeaking = useCallback((isSpeaking: boolean) => {
    send({ type: 'speaking', is_speaking: isSpeaking })
  }, [send])

  const toggleScreenShare = useCallback(async () => {
    const current = state.isSharingScreen
    if (!current) {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true })
        screen.getTracks().forEach((t) => {
          localStream.current?.addTrack(t)
          peers.current.forEach((pc) => pc.addTrack(t, localStream.current!))
        })
        setLocalVideoStream(screen)
        // Auto-stop when user ends sharing via browser UI
        screen.getVideoTracks()[0]?.addEventListener('ended', () => {
          setState(s => ({ ...s, isSharingScreen: false }))
          setLocalVideoStream(null)
          send({ type: 'screen_share', enabled: false })
        })
      } catch {
        return
      }
    } else {
      setLocalVideoStream(null)
    }
    setState((s) => {
      send({ type: 'screen_share', enabled: !s.isSharingScreen })
      return { ...s, isSharingScreen: !s.isSharingScreen }
    })
  }, [state.isSharingScreen, send])

  const toggleWebcam = useCallback(async () => {
    const current = state.isSharingWebcam
    if (!current) {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: true })
        cam.getTracks().forEach((t) => {
          localStream.current?.addTrack(t)
          peers.current.forEach((pc) => pc.addTrack(t, localStream.current!))
        })
        setLocalVideoStream(cam)
      } catch {
        return
      }
    } else {
      setLocalVideoStream(null)
    }
    setState((s) => {
      send({ type: 'webcam', enabled: !s.isSharingWebcam })
      return { ...s, isSharingWebcam: !s.isSharingWebcam }
    })
  }, [state.isSharingWebcam, send])

  return { state, toggleMute, toggleDeafen, toggleScreenShare, toggleWebcam, sendSpeaking, remoteStreams, localVideoStream, localStream }
}
