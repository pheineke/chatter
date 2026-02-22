import { useState, useRef, useCallback, useEffect } from 'react'
import type { VoiceParticipant } from '../api/types'
import { useWebSocket } from './useWebSocket'
import { useSoundManager } from './useSoundManager'

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
  const { playSound } = useSoundManager()

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
  // peerId → RTCRtpSender[] for screen share (can be video+audio) / webcam so we can removeTrack later
  const screenSenders = useRef<Map<string, RTCRtpSender[]>>(new Map())
  const webcamSenders = useRef<Map<string, RTCRtpSender>>(new Map())
  // Stable refs to local screen/webcam streams so stop-callbacks can reach them
  const screenStreamRef = useRef<MediaStream | null>(null)
  const webcamStreamRef = useRef<MediaStream | null>(null)
  // Perfect Negotiation: tracks whether we are in the middle of createOffer per peer
  const makingOffer = useRef<Map<string, boolean>>(new Map())
  // Handles the race between audio and video ontrack events from the same stream.
  // When an audio track arrives before the video track for the same stream ID we
  // temporarily route it as mic audio. When the video track arrives we check this
  // map and upgrade the audio to the screen-share audio path.
  const pendingStreamAudio = useRef<Map<string, {
    el: HTMLAudioElement
    peerId: string
    stream: MediaStream
    track: MediaStreamTrack
  }>>(new Map())
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Record<string, MediaStream>>({})
  const [remoteWebcamStreams, setRemoteWebcamStreams] = useState<Record<string, MediaStream>>({})
  const [remoteScreenAudioStreams, setRemoteScreenAudioStreams] = useState<Record<string, MediaStream>>({})
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null)
  const [localWebcamStream, setLocalWebcamStream] = useState<MediaStream | null>(null)
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
            playSound('connectSound')
            // Only initiate if we are the impolite side
            if (isImpolite(p.user_id)) initiateCall(p.user_id)
            break
          }
          case 'voice.user_left': {
            const { user_id } = msg.data as { user_id: string }
            setState((s) => ({ ...s, participants: s.participants.filter((p) => p.user_id !== user_id) }))
            playSound('disconnectSound')
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

    // Perfect Negotiation: both sides can send renegotiation offers.
    // A makingOffer flag lets handleOffer detect and resolve collisions.
    pc.onnegotiationneeded = async () => {
      if (pc.signalingState !== 'stable') return
      try {
        makingOffer.current.set(peerId, true)
        const offer = await pc.createOffer()
        if (pc.signalingState !== 'stable') return  // state changed while awaiting
        await pc.setLocalDescription(offer)
        send({ type: 'offer', to: peerId, sdp: offer.sdp })
      } catch { /* ignore errors from racing state changes */ } finally {
        makingOffer.current.set(peerId, false)
      }
    }

    pc.ontrack = ({ track, streams }) => {
      // streams[0] can be undefined if the sender didn't bundle the track into a
      // named stream — fall back to a single-track wrapper as a safety net.
      const remoteStream = streams[0] ?? new MediaStream([track])
      const streamId = remoteStream.id

      if (track.kind === 'audio') {
        // We can't reliably tell at this moment whether the audio is from the mic
        // (audio-only stream) or from a screen share (audio + video in same stream)
        // because the peer's ontrack fires once per track — the video track for the
        // same stream may not have arrived yet.
        //
        // Strategy:
        //  • If the stream already has a video track → screen audio immediately.
        //  • Otherwise → create a hidden mic-audio element, but register it in
        //    pendingStreamAudio so the video ontrack handler can upgrade it.

        const routeAsScreenAudio = (audioTrack: MediaStreamTrack, audioStream: MediaStream) => {
          setRemoteScreenAudioStreams(prev => ({ ...prev, [peerId]: audioStream }))
          audioTrack.addEventListener('ended', () => {
            setRemoteScreenAudioStreams(prev => { const n = { ...prev }; delete n[peerId]; return n })
          }, { once: true })
        }

        if (remoteStream.getVideoTracks().length > 0) {
          // Video already present — definitely screen-share audio.
          routeAsScreenAudio(track, remoteStream)
        } else {
          // Route as mic audio for now; upgrade if video arrives later.
          const elId = `audio-${streamId}`
          let audio = document.getElementById(elId) as HTMLAudioElement | null
          if (!audio) {
            audio = document.createElement('audio')
            audio.id = elId
            audio.autoplay = true
            audio.dataset.peer = peerId
            document.body.appendChild(audio)
          }
          audio.srcObject = remoteStream
          const tryPlay = () =>
            audio!.play().catch(() => document.addEventListener('click', tryPlay, { once: true }))
          tryPlay()

          // Register so the video ontrack can upgrade this to screen audio.
          pendingStreamAudio.current.set(streamId, { el: audio, peerId, stream: remoteStream, track })
          track.addEventListener('ended', () => {
            pendingStreamAudio.current.delete(streamId)
            audio?.remove()
          }, { once: true })
        }
      }

      if (track.kind === 'video') {
        // contentHint 'detail' is set by the sender on screen-share tracks;
        // '' or 'motion' means webcam. Route accordingly.
        const isScreen = track.contentHint === 'detail'
        if (isScreen) {
          setRemoteScreenStreams(prev => ({ ...prev, [peerId]: remoteStream }))
          track.addEventListener('ended', () => {
            setRemoteScreenStreams(prev => { const n = { ...prev }; delete n[peerId]; return n })
          }, { once: true })
        } else {
          setRemoteWebcamStreams(prev => ({ ...prev, [peerId]: remoteStream }))
          track.addEventListener('ended', () => {
            setRemoteWebcamStreams(prev => { const n = { ...prev }; delete n[peerId]; return n })
          }, { once: true })
        }

        // Check if an audio track for this same stream arrived earlier and was
        // tentatively routed as mic audio. If so, upgrade it to screen audio.
        const pending = pendingStreamAudio.current.get(streamId)
        if (pending && pending.peerId === peerId) {
          pendingStreamAudio.current.delete(streamId)
          // Remove the misrouted mic-audio element.
          pending.el.pause()
          pending.el.remove()
          // Now route correctly as screen audio.
          setRemoteScreenAudioStreams(prev => ({ ...prev, [peerId]: pending.stream }))
          pending.track.addEventListener('ended', () => {
            setRemoteScreenAudioStreams(prev => { const n = { ...prev }; delete n[peerId]; return n })
          }, { once: true })
        }
      }
    }

    peers.current.set(peerId, pc)
    return pc
  }, [send])

  const initiateCall = useCallback((peerId: string) => {
    const pc = createPeer(peerId)
    // If we're already sharing screen/webcam, add those tracks immediately so
    // the initial offer includes them instead of requiring a second renegotiation.
    if (screenStreamRef.current) {
      const senders = screenStreamRef.current.getTracks().map(t => pc.addTrack(t, screenStreamRef.current!))
      screenSenders.current.set(peerId, senders)
    }
    if (webcamStreamRef.current) {
      const [t] = webcamStreamRef.current.getVideoTracks()
      if (t) webcamSenders.current.set(peerId, pc.addTrack(t, webcamStreamRef.current))
    }
    // onnegotiationneeded fires automatically once tracks are added and sends the
    // initial offer. No explicit createOffer needed here.
  }, [createPeer])

  const handleOffer = useCallback(async (peerId: string, sdp: string) => {
    const existing = peers.current.get(peerId)
    // Perfect Negotiation: the polite side is the one with the higher userId.
    // When there's a collision (both sides tried to offer simultaneously), the
    // polite side rolls back its own pending offer and accepts the remote offer.
    // The impolite side simply ignores the incoming offer and keeps its own.
    const polite = userId > peerId
    const collision = (makingOffer.current.get(peerId) === true) ||
      (existing != null && existing.signalingState !== 'stable')

    if (collision) {
      if (!polite) return   // impolite: ignore the incoming offer, ours wins
      // polite: roll back our pending offer so we can accept theirs
      if (existing) {
        await existing.setLocalDescription({ type: 'rollback' })
        makingOffer.current.set(peerId, false)
      }
    }

    // No collision (or polite rollback complete): accept the offer normally.
    const isNewPeer = existing == null || collision
    const pc = existing ?? createPeer(peerId)
    await pc.setRemoteDescription({ type: 'offer', sdp })
    await flushIceCandidates(peerId)

    // If this is a brand-new peer (not a renegotiation) and we are currently
    // sharing our screen or webcam, add those tracks now so they are included
    // in the answer SDP.  Without this the polite side (which never calls
    // initiateCall) would omit screen/webcam tracks entirely for late joiners.
    if (isNewPeer) {
      if (screenStreamRef.current) {
        const senders = screenStreamRef.current.getTracks().map(t => pc.addTrack(t, screenStreamRef.current!))
        screenSenders.current.set(peerId, senders)
      }
      if (webcamStreamRef.current) {
        const [t] = webcamStreamRef.current.getVideoTracks()
        if (t) webcamSenders.current.set(peerId, pc.addTrack(t, webcamStreamRef.current))
      }
    }

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    send({ type: 'answer', to: peerId, sdp: answer.sdp })
  }, [createPeer, flushIceCandidates, send, userId])

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
    makingOffer.current.delete(peerId)
    screenSenders.current.delete(peerId)
    webcamSenders.current.delete(peerId)
    // Remove all audio elements for this peer (mic audio)
    document.querySelectorAll<HTMLAudioElement>(`audio[data-peer="${peerId}"]`)
      .forEach(el => el.remove())
    setRemoteScreenStreams(prev => { const next = { ...prev }; delete next[peerId]; return next })
    setRemoteWebcamStreams(prev => { const next = { ...prev }; delete next[peerId]; return next })
    setRemoteScreenAudioStreams(prev => { const next = { ...prev }; delete next[peerId]; return next })
    // Clean up any pending audio that hadn't been resolved for this peer
    pendingStreamAudio.current.forEach((entry, streamId) => {
      if (entry.peerId === peerId) {
        entry.el.pause(); entry.el.remove()
        pendingStreamAudio.current.delete(streamId)
      }
    })
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
      screenStreamRef.current?.getTracks().forEach((t) => t.stop())
      screenStreamRef.current = null
      webcamStreamRef.current?.getTracks().forEach((t) => t.stop())
      webcamStreamRef.current = null
      screenSenders.current.clear()
      webcamSenders.current.clear()
      makingOffer.current.clear()
      pendingStreamAudio.current.forEach(({ el }) => { el.pause(); el.remove() })
      pendingStreamAudio.current.clear()
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
      playSound(next ? 'muteSound' : 'unmuteSound')
      return { ...s, isMuted: next }
    })
  }, [send, playSound])

  const toggleDeafen = useCallback(() => {
    setState((s) => {
      const next = !s.isDeafened
      // Mute all remote audio when deafened
      document.querySelectorAll('audio[id^="audio-"]').forEach((el) => {
        (el as HTMLAudioElement).muted = next
      })
      send({ type: 'deafen', is_deafened: next })
      playSound(next ? 'deafenSound' : 'undeafenSound')
      return { ...s, isDeafened: next }
    })
  }, [send, playSound])

  const sendSpeaking = useCallback((isSpeaking: boolean) => {
    send({ type: 'speaking', is_speaking: isSpeaking })
  }, [send])

  const stopScreenShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach(t => t.stop())
    screenStreamRef.current = null
    setLocalScreenStream(null)
    // Remove all screen senders (video + optional audio) — onnegotiationneeded fires automatically.
    peers.current.forEach((pc, peerId) => {
      const senders = screenSenders.current.get(peerId) ?? []
      senders.forEach(s => { try { pc.removeTrack(s) } catch { /* ignore */ } })
      screenSenders.current.delete(peerId)
    })
    setState(s => ({ ...s, isSharingScreen: false }))
    send({ type: 'screen_share', enabled: false })
  }, [send])

  const toggleScreenShare = useCallback(async () => {
    if (state.isSharingScreen) {
      stopScreenShare()
      return
    }
    let screenStream: MediaStream
    try {
      // audio: true makes the browser show a "Share audio" / "Share tab audio" checkbox
      // in its native picker. If the user unchecks it the stream just has no audio tracks,
      // and the track-iteration below handles that gracefully (nothing extra is sent).
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    } catch {
      return  // user cancelled or permission denied
    }
    const [videoTrack] = screenStream.getVideoTracks()
    // Mark as screen content so receivers can distinguish from webcam
    videoTrack.contentHint = 'detail'
    screenStreamRef.current = screenStream
    setLocalScreenStream(screenStream)
    setState(s => ({ ...s, isSharingScreen: true }))
    send({ type: 'screen_share', enabled: true })
    // Add ALL tracks (video + any captured audio) to every existing peer connection.
    // onnegotiationneeded fires per peer and sends renegotiation offers automatically.
    peers.current.forEach((pc, peerId) => {
      const senders = screenStream.getTracks().map(t => pc.addTrack(t, screenStream))
      screenSenders.current.set(peerId, senders)
    })
    // Handle the browser's own "Stop sharing" button.
    videoTrack.addEventListener('ended', () => stopScreenShare(), { once: true })
  }, [state.isSharingScreen, stopScreenShare, send])

  const stopWebcam = useCallback(() => {
    webcamStreamRef.current?.getTracks().forEach(t => t.stop())
    webcamStreamRef.current = null
    setLocalWebcamStream(null)
    peers.current.forEach((pc, peerId) => {
      const sender = webcamSenders.current.get(peerId)
      if (sender) { try { pc.removeTrack(sender) } catch { /* ignore */ } }
      webcamSenders.current.delete(peerId)
    })
    setState(s => ({ ...s, isSharingWebcam: false }))
    send({ type: 'webcam', enabled: false })
  }, [send])

  const toggleWebcam = useCallback(async () => {
    if (state.isSharingWebcam) {
      stopWebcam()
      return
    }
    let camStream: MediaStream
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: true })
    } catch {
      return
    }
    const [videoTrack] = camStream.getVideoTracks()
    // Mark as motion/webcam content so receivers can distinguish from screen share
    videoTrack.contentHint = 'motion'
    webcamStreamRef.current = camStream
    setLocalWebcamStream(camStream)
    setState(s => ({ ...s, isSharingWebcam: true }))
    send({ type: 'webcam', enabled: true })
    peers.current.forEach((pc, peerId) => {
      const sender = pc.addTrack(videoTrack, camStream)
      webcamSenders.current.set(peerId, sender)
    })
    videoTrack.addEventListener('ended', () => stopWebcam(), { once: true })
  }, [state.isSharingWebcam, stopWebcam, send])

  return { state, toggleMute, toggleDeafen, toggleScreenShare, toggleWebcam, sendSpeaking, remoteScreenStreams, remoteWebcamStreams, remoteScreenAudioStreams, localScreenStream, localWebcamStream, localStream }
}
