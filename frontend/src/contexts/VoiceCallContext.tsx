import { createContext, useContext } from 'react'
import { useVoiceChannel } from '../hooks/useVoiceChannel'
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
  localVideoStream: MediaStream | null
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
  const { state, toggleMute, toggleDeafen, toggleScreenShare, toggleWebcam, remoteStreams, localVideoStream } =
    useVoiceChannel({ channelId: session?.channelId ?? null, userId })

  return (
    <VoiceCallContext.Provider value={{ state, toggleMute, toggleDeafen, toggleScreenShare, toggleWebcam, remoteStreams, localVideoStream }}>
      {children}
    </VoiceCallContext.Provider>
  )
}
