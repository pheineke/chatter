import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { getMembers } from '../api/servers'
import { UserAvatar } from './UserAvatar'
import { StatusIndicator } from './StatusIndicator'
import { Icon } from './Icon'
import { useVoiceCall } from '../contexts/VoiceCallContext'
import type { VoiceSession } from '../pages/AppShell'
import type { User } from '../api/types'

// ─── Types ─────────────────────────────────────────────────────────────────

interface ParticipantTile {
  kind: 'participant'
  id: string
  user: User
  isMuted: boolean
  isDeafened: boolean
  isSharingScreen: boolean
  isSharingWebcam: boolean
  isSelf: boolean
}

interface VideoTile {
  kind: 'video'
  id: string
  label: string
  stream: MediaStream
  tileType: 'screen' | 'webcam'
}

type Tile = ParticipantTile | VideoTile

// ─── Video element ──────────────────────────────────────────────────────────

function VideoEl({ stream, muted = false }: { stream: MediaStream; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  return <video ref={ref} autoPlay muted={muted} playsInline className="w-full h-full object-contain" />
}

// ─── Control button ─────────────────────────────────────────────────────────

function CtrlBtn({
  title, active, danger, onClick, children,
}: {
  title: string; active?: boolean; danger?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors
        ${danger
          ? 'bg-red-600 hover:bg-red-500 text-white'
          : active
            ? 'bg-discord-mention text-white hover:bg-discord-mention/80'
            : 'bg-discord-input text-discord-muted hover:bg-discord-input/60 hover:text-discord-text'
        }`}
    >
      {children}
    </button>
  )
}

// ─── Participant tile card ───────────────────────────────────────────────────

function ParticipantCard({
  tile, compact = false, onClick,
}: {
  tile: ParticipantTile; compact?: boolean; onClick?: () => void
}) {
  return (
    <div
      className={`relative flex flex-col items-center justify-center rounded-xl bg-discord-sidebar border border-white/5 transition-colors
        ${compact ? 'w-24 h-24 shrink-0' : 'w-full h-full min-h-[120px]'}`}
      onClick={onClick}
    >
      <div className="relative">
        <UserAvatar user={tile.user} size={compact ? 40 : 64} />
        <span className="absolute -bottom-1 -right-1">
          <StatusIndicator status={tile.user.status} size={compact ? 9 : 13} />
        </span>
      </div>
      {!compact && (
        <span className="mt-2 text-sm font-semibold text-discord-text truncate max-w-full px-2">
          {tile.user.username}{tile.isSelf ? ' (You)' : ''}
        </span>
      )}
      {/* Muted / deafened badges */}
      <div className={`absolute flex gap-1 ${compact ? 'bottom-1 right-1' : 'bottom-2 right-2'}`}>
        {tile.isMuted && (
          <span className="w-5 h-5 rounded-full bg-discord-bg/80 flex items-center justify-center">
            <Icon name="mic-off" size={11} className="text-red-400" />
          </span>
        )}
        {tile.isDeafened && (
          <span className="w-5 h-5 rounded-full bg-discord-bg/80 flex items-center justify-center">
            <Icon name="bell-off" size={11} className="text-red-400" />
          </span>
        )}
      </div>
      {compact && (
        <span className="mt-1 text-[10px] text-discord-muted truncate max-w-[88px] px-1 text-center leading-none">
          {tile.user.username}
        </span>
      )}
    </div>
  )
}

// ─── Video tile card ─────────────────────────────────────────────────────────

function VideoCard({
  tile, compact = false, focused = false, onClick,
}: {
  tile: VideoTile; compact?: boolean; focused?: boolean; onClick?: () => void
}) {
  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-black border border-white/10 cursor-pointer group
        ${compact ? 'w-24 h-24 shrink-0' : 'w-full h-full min-h-[120px]'}`}
      onClick={onClick}
    >
      <VideoEl stream={tile.stream} muted={tile.label.startsWith('Your')} />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
      {!focused && !compact && (
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-white text-xs font-semibold bg-black/60 px-3 py-1 rounded-full flex items-center gap-1.5">
            <Icon name="maximize-2" size={13} /> Theater Mode
          </span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 text-[11px] font-semibold text-white drop-shadow bg-black/50 px-2 py-0.5 rounded-full">
        {tile.label}
      </div>
      <div className="absolute top-2 right-2">
        <span className="text-[10px] uppercase font-bold text-white bg-discord-mention/80 px-1.5 py-0.5 rounded">
          {tile.tileType === 'screen' ? 'Screen' : 'Cam'}
        </span>
      </div>
    </div>
  )
}

// ─── Cols helper ─────────────────────────────────────────────────────────────

function gridCols(n: number) {
  if (n <= 1) return 'grid-cols-1'
  if (n <= 4) return 'grid-cols-2'
  if (n <= 9) return 'grid-cols-3'
  return 'grid-cols-4'
}

// ─── Main component ──────────────────────────────────────────────────────────

interface Props {
  session: VoiceSession
  onLeave: () => void
}

export function VoiceGridPane({ session, onLeave }: Props) {
  const { user: selfUser } = useAuth()
  const { state, remoteStreams, localVideoStream, toggleMute, toggleDeafen, toggleScreenShare, toggleWebcam } = useVoiceCall()
  const [focused, setFocused] = useState<string | null>(null)

  const { data: members = [] } = useQuery({
    queryKey: ['members', session.serverId],
    queryFn: () => getMembers(session.serverId),
    staleTime: 30_000,
  })

  // Build tile list ──────────────────────────────────────────────────────────

  const tiles: Tile[] = []

  // Self participant tile
  if (selfUser) {
    tiles.push({
      kind: 'participant',
      id: 'user-self',
      user: selfUser,
      isMuted: state.isMuted,
      isDeafened: state.isDeafened,
      isSharingScreen: state.isSharingScreen,
      isSharingWebcam: state.isSharingWebcam,
      isSelf: true,
    })
  }

  // Remote participant tiles
  state.participants.forEach(p => {
    const m = members.find(m => m.user_id === p.user_id)
    const user: User = m?.user ?? {
      id: p.user_id,
      username: p.username ?? `User ${p.user_id.slice(0, 4)}`,
      avatar: p.avatar ?? null,
      description: null,
      status: 'offline',
      created_at: '',
      banner: null,
      pronouns: null,
    }
    tiles.push({
      kind: 'participant',
      id: `user-${p.user_id}`,
      user,
      isMuted: p.is_muted,
      isDeafened: p.is_deafened,
      isSharingScreen: p.is_sharing_screen,
      isSharingWebcam: p.is_sharing_webcam,
      isSelf: false,
    })
    // Remote screen share tile
    if (p.is_sharing_screen && remoteStreams[p.user_id]) {
      tiles.push({
        kind: 'video',
        id: `screen-${p.user_id}`,
        label: `${user.username}'s Screen`,
        stream: remoteStreams[p.user_id],
        tileType: 'screen',
      })
    }
    // Remote webcam tile (separate from screen share)
    if (p.is_sharing_webcam && !p.is_sharing_screen && remoteStreams[p.user_id]) {
      tiles.push({
        kind: 'video',
        id: `webcam-${p.user_id}`,
        label: `${user.username}'s Camera`,
        stream: remoteStreams[p.user_id],
        tileType: 'webcam',
      })
    }
  })

  // Local screen share / webcam tile
  if (localVideoStream) {
    tiles.push({
      kind: 'video',
      id: state.isSharingScreen ? 'screen-local' : 'webcam-local',
      label: state.isSharingScreen ? 'Your Screen' : 'Your Camera',
      stream: localVideoStream,
      tileType: state.isSharingScreen ? 'screen' : 'webcam',
    })
  }

  // Theater mode helpers ─────────────────────────────────────────────────────

  const focusedTile = focused != null ? tiles.find(t => t.id === focused) : null
  // Only video tiles can be theaters
  const theaterTile = focusedTile?.kind === 'video' ? focusedTile : null
  const filmstripTiles = theaterTile ? tiles.filter(t => t.id !== theaterTile.id) : []

  // Validate focus — if the focused tile no longer exists (stream ended), clear
  useEffect(() => {
    if (focused && !tiles.find(t => t.id === focused)) setFocused(null)
  })

  // Participant count label ──────────────────────────────────────────────────
  const participantCount = state.participants.length + 1

  return (
    <div className="flex flex-col h-full bg-discord-bg select-none">
      {/* Header */}
      <div className="h-12 flex items-center gap-2 px-4 border-b border-black/20 shrink-0">
        <Icon name="headphones" size={16} className="text-discord-online shrink-0" />
        <span className="font-semibold truncate">{session.channelName}</span>
        <span className="text-discord-muted text-xs ml-1 shrink-0">
          {participantCount} participant{participantCount !== 1 ? 's' : ''}
        </span>
        {theaterTile && (
          <button
            onClick={() => setFocused(null)}
            className="ml-auto flex items-center gap-1 text-xs text-discord-muted hover:text-discord-text transition-colors"
          >
            <Icon name="minimize-2" size={13} /> Exit Theater
          </button>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 min-h-0 p-4 overflow-hidden">
        {theaterTile ? (
          // ── Theater mode ────────────────────────────────────────────────
          <div className="flex flex-col h-full gap-3">
            {/* Focused video */}
            <div className="flex-1 min-h-0 rounded-xl overflow-hidden bg-black border border-white/10">
              <VideoCard tile={theaterTile} focused onClick={() => setFocused(null)} />
            </div>
            {/* Filmstrip */}
            {filmstripTiles.length > 0 && (
              <div className="flex gap-3 overflow-x-auto shrink-0 py-1 scrollbar-none">
                {filmstripTiles.map(t =>
                  t.kind === 'video' ? (
                    <VideoCard
                      key={t.id}
                      tile={t}
                      compact
                      onClick={() => setFocused(t.id)}
                    />
                  ) : (
                    <ParticipantCard
                      key={t.id}
                      tile={t}
                      compact
                    />
                  )
                )}
              </div>
            )}
          </div>
        ) : (
          // ── Standard grid ────────────────────────────────────────────────
          <div className={`h-full grid ${gridCols(tiles.length)} gap-4 auto-rows-fr content-start`}>
            {tiles.map(t =>
              t.kind === 'video' ? (
                <VideoCard
                  key={t.id}
                  tile={t}
                  onClick={() => setFocused(t.id)}
                />
              ) : (
                <ParticipantCard key={t.id} tile={t} />
              )
            )}
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-center gap-3 px-4 py-4 border-t border-black/20 shrink-0">
        <CtrlBtn
          title={state.isMuted ? 'Unmute' : 'Mute'}
          active={state.isMuted}
          onClick={toggleMute}
        >
          <Icon name={state.isMuted ? 'mic-off' : 'mic'} size={20} />
        </CtrlBtn>
        <CtrlBtn
          title={state.isDeafened ? 'Undeafen' : 'Deafen'}
          active={state.isDeafened}
          onClick={toggleDeafen}
        >
          <Icon name={state.isDeafened ? 'bell-off' : 'bell'} size={20} />
        </CtrlBtn>
        <CtrlBtn
          title={state.isSharingScreen ? 'Stop Sharing' : 'Share Screen'}
          active={state.isSharingScreen}
          onClick={toggleScreenShare}
        >
          <Icon name="monitor" size={20} />
        </CtrlBtn>
        <CtrlBtn
          title={state.isSharingWebcam ? 'Turn Off Camera' : 'Turn On Camera'}
          active={state.isSharingWebcam}
          onClick={toggleWebcam}
        >
          <Icon name="camera" size={20} />
        </CtrlBtn>
        <CtrlBtn title="Leave Voice" danger onClick={onLeave}>
          <Icon name="phone-off" size={20} />
        </CtrlBtn>
      </div>
    </div>
  )
}
