import { useAuth } from '../contexts/AuthContext'
import { useQuery } from '@tanstack/react-query'
import { useVoiceChannel } from '../hooks/useVoiceChannel'
import { getMembers } from '../api/servers'
import { Icon } from './Icon'
import { UserAvatar } from './UserAvatar'
import { StatusIndicator } from './StatusIndicator'
import type { VoiceSession } from '../pages/AppShell'
import type { User } from '../api/types'

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
  const { user } = useAuth()
  const { state, toggleMute, toggleDeafen, toggleScreenShare, toggleWebcam } = useVoiceChannel({
    channelId: session.channelId,
    userId: user?.id ?? '',
  })

  // Fetch server members to resolve participant user info
  const { data: members = [] } = useQuery({
    queryKey: ['members', session.serverId],
    queryFn: () => getMembers(session.serverId),
    staleTime: 30_000,
  })

  // Resolve participants to User objects
  const participantUsers: { user: User; isMuted: boolean; isDeafened: boolean }[] =
    state.participants
      .map((p) => {
        const m = members.find((m) => m.user_id === p.user_id)
        // Fallback for users not yet in the member list (e.g. joined before member list refreshed)
        const user: User = m?.user ?? {
          id: p.user_id,
          username: p.username ?? `User ${p.user_id.slice(0, 4)}`,
          avatar: p.avatar ?? null,
          description: null,
          status: 'offline',
          created_at: '',
        }
        return { user, isMuted: p.is_muted, isDeafened: p.is_deafened }
      })

  return (
    <div className="flex items-center justify-between px-3 py-2 bg-discord-bg/80 border-t border-black/20 shrink-0">
      {/* Left: connection info + participant list */}
      <div className="flex flex-col min-w-0 gap-1">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-discord-online animate-pulse" />
            <span className="text-discord-online text-xs font-semibold">Voice Connected</span>
          </div>
          <span className="text-discord-muted text-xs truncate"># {session.channelName}</span>
        </div>

        {/* Participant avatars + names */}
        {participantUsers.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {participantUsers.map(({ user: u, isMuted, isDeafened }) => (
              <div key={u.id} className="flex items-center gap-1.5 text-xs text-discord-muted">
                <div className="relative shrink-0">
                  <UserAvatar user={u} size={20} />
                  <span className="absolute -bottom-0.5 -right-0.5">
                    <StatusIndicator status={u.status} size={7} />
                  </span>
                </div>
                <span className="truncate">{u.username}</span>
                {isMuted && <Icon name="mic-off" size={12} className="text-discord-muted shrink-0 opacity-60" />}
                {isDeafened && <Icon name="bell-off" size={12} className="text-discord-muted shrink-0 opacity-60" />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-1">
        <VoiceBtn title={state.isMuted ? 'Unmute' : 'Mute'} active={state.isMuted} onClick={toggleMute}>
          <Icon name={state.isMuted ? 'mic-off' : 'mic'} size={18} />
        </VoiceBtn>
        <VoiceBtn title={state.isDeafened ? 'Undeafen' : 'Deafen'} active={state.isDeafened} onClick={toggleDeafen}>
          <Icon name={state.isDeafened ? 'bell-off' : 'bell'} size={18} />
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
