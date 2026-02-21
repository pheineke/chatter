import { useVoiceCall } from '../contexts/VoiceCallContext'
import { Icon } from './Icon'
import type { VoiceSession } from '../pages/AppShell'

interface Props {
  session: VoiceSession
  onLeave: () => void
}

function VoiceBtn({
  title, active, danger, onClick, children,
}: {
  title: string
  active?: boolean
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`w-9 h-9 rounded flex items-center justify-center text-lg transition-colors
        ${danger ? 'hover:bg-red-500 text-discord-muted hover:text-white'
          : active ? 'bg-discord-input text-discord-text'
          : 'text-discord-muted hover:bg-discord-input hover:text-discord-text'}`}
    >
      {children}
    </button>
  )
}

export function VoiceChannelBar({ session, onLeave }: Props) {
  const { state, toggleMute, toggleDeafen, toggleScreenShare, toggleWebcam } = useVoiceCall()
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-discord-bg/80 border-t border-black/20 shrink-0" style={{ minHeight: '3.5rem' }}>
      {/* Left: connection info */}
      <div className="flex flex-col min-w-0 gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-discord-online animate-pulse" />
          <span className="text-discord-online text-xs font-semibold">Voice Connected</span>
        </div>
        <span className="text-discord-muted text-xs truncate"># {session.channelName}</span>
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-1">
        <VoiceBtn title={state.isMuted ? 'Unmute' : 'Mute'} active={state.isMuted} onClick={toggleMute}>
          <Icon name={state.isMuted ? 'mic-off' : 'mic'} size={18} />
        </VoiceBtn>
        <VoiceBtn title={state.isDeafened ? 'Undeafen' : 'Deafen'} active={state.isDeafened} onClick={toggleDeafen}>
          <Icon name={state.isDeafened ? 'headphones-off' : 'headphones'} size={18} />
        </VoiceBtn>
        <VoiceBtn title={state.isSharingScreen ? 'Stop Screen Share' : 'Share Screen'} active={state.isSharingScreen} onClick={toggleScreenShare}>
          <Icon name="monitor" size={18} />
        </VoiceBtn>
        <VoiceBtn title={state.isSharingWebcam ? 'Turn Off Camera' : 'Turn On Camera'} active={state.isSharingWebcam} onClick={toggleWebcam}>
          <Icon name="camera" size={18} />
        </VoiceBtn>
        <VoiceBtn title="Leave Voice" danger onClick={onLeave}>
          <Icon name="phone-off" size={18} />
        </VoiceBtn>
      </div>
    </div>
  )
}
