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
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null)

  /**
   * Tie-breaking: the peer with the lexicographically smaller user ID is the
   * "impolite" side and always initiates calls. The other side only answers.
   * This eliminates the WebRTC glare condition (both sides sending offers
   * simultaneously).
   */
  const isImpolite = useCallback((peerId: string) => userId < peerId, [userId])

  const { send } = useWebSocket(
    channelId ? `/ws/voice/${channelId}` : '',
    {
      enabled: channelId !== null,
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

  function createPeer(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })

    // Add local tracks
    localStream.current?.getTracks().forEach((t) => pc.addTrack(t, localStream.current!))

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        send({ type: 'ice_candidate', to: peerId, candidate: e.candidate.toJSON() })
      }
    }

    pc.ontrack = (e) => {
      const stream = e.streams[0]
      if (e.track.kind === 'audio') {
        // Attach audio to a hidden element
        const existing = document.getElementById(`audio-${peerId}`) as HTMLAudioElement | null
        const audio = existing ?? document.createElement('audio')
        audio.id = `audio-${peerId}`
        audio.autoplay = true
        audio.srcObject = stream
        if (!existing) document.body.appendChild(audio)
      }
      // Always store the full stream so video tracks are accessible
      setRemoteStreams(prev => ({ ...prev, [peerId]: stream }))
    }

    peers.current.set(peerId, pc)
    return pc
  }

  const initiateCall = useCallback(async (peerId: string) => {
    const pc = createPeer(peerId)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    send({ type: 'offer', to: peerId, sdp: offer.sdp })
  }, [send])

  const handleOffer = useCallback(async (peerId: string, sdp: string) => {
    // If we already have a peer for this ID (e.g. from a previous session),
    // tear it down before renegotiating.
    if (peers.current.has(peerId)) {
      peers.current.get(peerId)!.close()
      peers.current.delete(peerId)
    }
    const pc = createPeer(peerId)
    await pc.setRemoteDescription({ type: 'offer', sdp })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    send({ type: 'answer', to: peerId, sdp: answer.sdp })
  }, [send])

  const handleAnswer = useCallback(async (peerId: string, sdp: string) => {
    const pc = peers.current.get(peerId)
    if (!pc) return
    // Only apply the answer when we are in the right state
    if (pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription({ type: 'answer', sdp })
    }
  }, [])

  const handleIce = useCallback(async (peerId: string, candidate: RTCIceCandidateInit) => {
    const pc = peers.current.get(peerId)
    if (!pc || pc.remoteDescription == null) return
    try {
      await pc.addIceCandidate(candidate)
    } catch {
      // Silently ignore stale / out-of-order ICE candidates
    }
  }, [])

  function cleanupPeer(peerId: string) {
    peers.current.get(peerId)?.close()
    peers.current.delete(peerId)
    const audio = document.getElementById(`audio-${peerId}`)
    audio?.remove()
    setRemoteStreams(prev => { const next = { ...prev }; delete next[peerId]; return next })
  }

  // --- Local media ----------------------------------------------------------

  const acquireMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      localStream.current = stream
    } catch {
      console.warn('Microphone access denied')
    }
  }, [])

  useEffect(() => {
    if (channelId) acquireMedia()
    return () => {
      localStream.current?.getTracks().forEach((t) => t.stop())
      peers.current.forEach((pc) => pc.close())
      peers.current.clear()
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

  return { state, toggleMute, toggleDeafen, toggleScreenShare, toggleWebcam, remoteStreams, localVideoStream, localStream }
}
