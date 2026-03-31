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
      className={`w-full h-8 flex items-center justify-center text-lg transition-colors rounded
        ${danger ? 'hover:bg-red-500 text-sp-muted hover:text-white'
          : active ? 'bg-white/10 text-sp-text'
          : 'text-sp-muted hover:bg-white/5 hover:text-sp-text'}`}
    >
      {children}
    </button>
  )
}

export function VoiceChannelBar({ session, onLeave }: Props) {
  const { state, toggleMute, toggleDeafen, toggleScreenShare, toggleWebcam } = useVoiceCall()
  
  return (
    <div className="flex flex-col shrink-0 gap-0 border-b border-sp-divider/20">
      {/* Connection status bar */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-sp-user">
        <div className="flex flex-col min-w-0 pointer-events-none select-none">
          <div className="flex items-center gap-1.5 font-bold text-sp-online text-xs uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-sp-online" />
            Voice Connected
          </div>
          <span className="text-sp-muted text-xs truncate">
            {session.channelName} / {session.serverId ? 'Server' : 'DM'}
          </span>
        </div>
        
        <button 
          title="Disconnect" 
          onClick={onLeave}
          className="w-7 h-7 rounded flex items-center justify-center text-sp-muted hover:text-white hover:bg-sp-danger transition-colors"
        >
          <Icon name="phone-off" size={16} />
        </button>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-4 px-1 py-1 bg-sp-user gap-px">
        <VoiceBtn title={state.isMuted ? 'Unmute' : 'Mute'} active={state.isMuted} onClick={toggleMute}>
          <Icon name={state.isMuted ? 'mic-off' : 'mic'} size={18} />
        </VoiceBtn>
        <VoiceBtn title={state.isDeafened ? 'Undeafen' : 'Deafen'} active={state.isDeafened} onClick={toggleDeafen}>
          <Icon name={state.isDeafened ? 'headphones-off' : 'headphones'} size={18} />
        </VoiceBtn>
        <VoiceBtn title={state.isSharingWebcam ? 'Turn Off Camera' : 'Turn On Camera'} active={state.isSharingWebcam} onClick={toggleWebcam}>
          <Icon name="camera" size={18} />
        </VoiceBtn>
        <VoiceBtn title={state.isSharingScreen ? 'Stop Screen Share' : 'Share Screen'} active={state.isSharingScreen} onClick={toggleScreenShare}>
          <Icon name="monitor" size={18} />
        </VoiceBtn>
      </div>
    </div>
  )
}
