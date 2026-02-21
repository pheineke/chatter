import { createContext, useContext } from 'react'
import type { MutableRefObject } from 'react'
import { useVoiceChannel } from '../hooks/useVoiceChannel'
import { useSpeaking } from '../hooks/useSpeaking'
import type { VoiceState } from '../hooks/useVoiceChannel'
import type { VoiceSession } from '../pages/AppShell'

export type { VoiceState }

interface VoiceCallContextValue {
  state: VoiceState
  toggleMute: () => void
  toggleDeafen: () => void
  toggleScreenShare: () => Promise<void>
  toggleWebcam: () => Promise<void>
  remoteStreams: Record<string, MediaStream>
  remoteScreenAudioStreams: Record<string, MediaStream>
  localVideoStream: MediaStream | null
  localStream: MutableRefObject<MediaStream | null>
  sendSpeaking: (isSpeaking: boolean) => void
  /** Whether the local user is currently speaking (detected via Web Audio API). */
  isSelfSpeaking: boolean
}

const VoiceCallContext = createContext<VoiceCallContextValue | null>(null)

export function useVoiceCall() {
  const ctx = useContext(VoiceCallContext)
  if (!ctx) throw new Error('useVoiceCall must be used inside VoiceCallProvider')
  return ctx
}

interface ProviderProps {
  session: VoiceSession | null
  userId: string
  children: React.ReactNode
}

export function VoiceCallProvider({ session, userId, children }: ProviderProps) {
  const { state, toggleMute, toggleDeafen, toggleScreenShare, toggleWebcam, sendSpeaking, remoteStreams, remoteScreenAudioStreams, localVideoStream, localStream } =
    useVoiceChannel({ channelId: session?.channelId ?? null, userId })

  // Speaking detection lives here so it runs for the full voice session,
  // not just while VoiceGridPane is mounted.
  const isSelfSpeaking = useSpeaking(localStream, sendSpeaking)

  return (
    <VoiceCallContext.Provider value={{ state, toggleMute, toggleDeafen, toggleScreenShare, toggleWebcam, sendSpeaking, remoteStreams, remoteScreenAudioStreams, localVideoStream, localStream, isSelfSpeaking }}>
      {children}
    </VoiceCallContext.Provider>
  )
}
