import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { getMembers } from '../api/servers'
import { UserAvatar } from './UserAvatar'
import { StatusIndicator } from './StatusIndicator'
import { Icon } from './Icon'
import { useVoiceCall } from '../contexts/VoiceCallContext'
import { useSpeaking } from '../hooks/useSpeaking'
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
  /** Live webcam stream — when present, replaces the avatar with video. */
  webcamStream?: MediaStream
}

interface VideoTile {
  kind: 'video'
  id: string
  label: string
  stream: MediaStream
  /** Optional audio stream to play alongside the video (e.g. screen-share system audio). */
  audioStream?: MediaStream
  tileType: 'screen' | 'webcam'
  /** Local tiles are always active; remote tiles start as a placeholder. */
  isLocal: boolean
}

type Tile = ParticipantTile | VideoTile

// ─── Video element ──────────────────────────────────────────────────────────

function VideoEl({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  return <video ref={ref} autoPlay muted playsInline className="w-full h-full object-contain" />
}

function AudioEl({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    const tryPlay = () => el.play().catch(() => document.addEventListener('click', tryPlay, { once: true }))
    tryPlay()
  }, [stream])
  return <audio ref={ref} autoPlay />
}

// ─── Control button ─────────────────────────────────────────────────────────

// ─── Participant tile card ───────────────────────────────────────────────────

function ParticipantCard({
  tile, compact = false, isSpeaking = false, onClick, onStopCamera,
}: {
  tile: ParticipantTile; compact?: boolean; isSpeaking?: boolean
  onClick?: () => void; onStopCamera?: () => void
}) {
  const hasVideo = !!tile.webcamStream

  return (
    <div
      className={`relative flex flex-col items-center justify-center rounded-xl overflow-hidden transition-all group
        ${hasVideo ? 'bg-black' : 'bg-discord-sidebar'}
        ${isSpeaking ? 'border-2 border-blue-500 shadow-[0_0_0_2px_rgba(59,130,246,0.25)]' : 'border border-white/5'}
        ${compact ? 'w-24 h-24 shrink-0' : 'w-full h-full min-h-[120px]'}`}
      onClick={onClick}
    >
      {hasVideo ? (
        <>
          {/* Live webcam fills the tile */}
          <VideoEl stream={tile.webcamStream!} />
          {/* Stop camera button — top-right corner, appears on hover */}
          {onStopCamera && (
            <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                title="Stop camera"
                className="text-[10px] font-bold text-white bg-red-600/80 hover:bg-red-600 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors"
                onClick={e => { e.stopPropagation(); onStopCamera() }}
              >
                <Icon name="x" size={10} /> Stop
              </button>
            </div>
          )}
          {/* Name + avatar overlay at the bottom */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent">
            {!compact && (
              <>
                <UserAvatar user={tile.user} size={20} />
                <span className="text-xs font-semibold text-white truncate">
                  {tile.user.username}{tile.isSelf ? ' (You)' : ''}
                </span>
              </>
            )}
            {/* Badges */}
            <div className="flex gap-1 ml-auto">
              {tile.isMuted && (
                <span className="w-4 h-4 rounded-full bg-black/60 flex items-center justify-center">
                  <Icon name="mic-off" size={9} className="text-red-400" />
                </span>
              )}
              {tile.isDeafened && (
                <span className="w-4 h-4 rounded-full bg-black/60 flex items-center justify-center">
                  <Icon name="headphones-off" size={9} className="text-red-400" />
                </span>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
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
                <Icon name="headphones-off" size={11} className="text-red-400" />
              </span>
            )}
          </div>
          {compact && (
            <span className="mt-1 text-[10px] text-discord-muted truncate max-w-[88px] px-1 text-center leading-none">
              {tile.user.username}
            </span>
          )}
        </>
      )}
    </div>
  )
}

// ─── Video tile card ─────────────────────────────────────────────────────────

function VideoCard({
  tile, compact = false, focused = false, active = false, onActivate, onDeactivate, onClick,
}: {
  tile: VideoTile; compact?: boolean; focused?: boolean
  active?: boolean; onActivate?: () => void; onDeactivate?: () => void; onClick?: () => void
}) {
  // Inactive placeholder — shown for remote tiles until the user clicks to watch.
  if (!active) {
    return (
      <div
        className={`relative flex flex-col items-center justify-center rounded-xl bg-black border border-white/10 cursor-pointer group
          ${compact ? 'w-24 h-24 shrink-0' : 'w-full h-full min-h-[120px]'}`}
        onClick={onActivate}
      >
        <div className="flex flex-col items-center gap-2 text-white/40 group-hover:text-white/70 transition-colors">
          <Icon name={tile.tileType === 'screen' ? 'monitor' : 'video'} size={compact ? 20 : 36} />
          {!compact && <span className="text-xs font-semibold">{tile.label}</span>}
        </div>
        {!compact && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="text-white text-xs font-semibold bg-black/70 px-3 py-1.5 rounded-full flex items-center gap-1.5">
              <Icon name="play" size={12} /> Click to watch
            </span>
          </div>
        )}
        <div className="absolute top-2 right-2">
          <span className="text-[10px] uppercase font-bold text-white/40 bg-white/10 px-1.5 py-0.5 rounded">
            {tile.tileType === 'screen' ? 'Screen' : 'Cam'}
          </span>
        </div>
        {compact && (
          <span className="mt-1 text-[10px] text-discord-muted truncate max-w-[88px] px-1 text-center leading-none">
            {tile.label}
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-black border border-white/10 cursor-pointer group
        ${compact ? 'w-24 h-24 shrink-0' : 'w-full h-full min-h-[120px]'}`}
      onClick={onClick}
    >
      <VideoEl stream={tile.stream} />
      {/* Play screen-share system audio alongside the video when present */}
      {tile.audioStream && <AudioEl stream={tile.audioStream} />}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
      {/* Theater Mode hint — center overlay */}
      {!focused && !compact && (
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <span className="text-white text-xs font-semibold bg-black/60 px-3 py-1 rounded-full flex items-center gap-1.5">
            <Icon name="maximize-2" size={13} /> Theater Mode
          </span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 text-[11px] font-semibold text-white drop-shadow bg-black/50 px-2 py-0.5 rounded-full">
        {tile.label}
      </div>
      <div className="absolute top-2 right-2 flex items-center gap-1.5">
        {onDeactivate && (
          <button
            title="Stop watching"
            className="opacity-0 group-hover:opacity-100 transition text-[10px] font-bold text-white bg-red-600/80 hover:bg-red-600 px-1.5 py-0.5 rounded flex items-center gap-1"
            onClick={e => { e.stopPropagation(); onDeactivate() }}
          >
            <Icon name="x" size={10} />{!compact && 'Exit'}
          </button>
        )}
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
  const { state, remoteStreams, remoteScreenAudioStreams, localVideoStream, localStream, sendSpeaking, toggleWebcam } = useVoiceCall()
  const isSelfSpeaking = useSpeaking(localStream, sendSpeaking)
  const [focused, setFocused] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  // Tile IDs the user has explicitly activated (clicked to watch/listen).
  // Local tiles are pre-seeded so the user always sees their own streams.
  const [activeTiles, setActiveTiles] = useState<Set<string>>(
    () => new Set(['screen-local'])
  )
  const activateTile   = (id: string) => setActiveTiles(prev => new Set([...prev, id]))
  const deactivateTile = (id: string) => {
    if (focused === id) setFocused(null)
    setActiveTiles(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  // Exit fullscreen when theater mode ends
  function clearFocused() {
    setFocused(null)
    setFullscreen(false)
  }

  // ESC exits fullscreen first, then theater
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (fullscreen) { setFullscreen(false) }
      else { clearFocused() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

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
      // Show local webcam preview inside the tile (only when not screen-sharing,
      // since screen-share uses its own VideoTile)
      webcamStream: state.isSharingWebcam && !state.isSharingScreen && localVideoStream
        ? localVideoStream : undefined,
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
      // Embed webcam directly in the participant tile (not a separate VideoTile)
      webcamStream: p.is_sharing_webcam && !p.is_sharing_screen && remoteStreams[p.user_id]
        ? remoteStreams[p.user_id] : undefined,
    })
    // Remote screen share tile — audioStream carries system audio if the user shared it
    if (p.is_sharing_screen && remoteStreams[p.user_id]) {
      tiles.push({
        kind: 'video',
        id: `screen-${p.user_id}`,
        label: `${user.username}'s Screen`,
        stream: remoteStreams[p.user_id],
        audioStream: remoteScreenAudioStreams[p.user_id],
        tileType: 'screen',
        isLocal: false,
      })
    }
    // Webcam is now embedded in the participant tile — no separate VideoTile needed
  })

  // Local screen share tile — always active (user sees their own preview)
  if (localVideoStream && state.isSharingScreen && state.isSharingScreen) {
    tiles.push({
      kind: 'video',
      id: 'screen-local',
      label: 'Your Screen',
      stream: localVideoStream,
      tileType: 'screen',
      isLocal: true,
    })
  }

  // Theater mode helpers ─────────────────────────────────────────────────────

  const focusedTile = focused != null ? tiles.find(t => t.id === focused) : null
  // Only video tiles can be theaters
  const theaterTile = focusedTile?.kind === 'video' ? focusedTile : null
  const filmstripTiles = theaterTile ? tiles.filter(t => t.id !== theaterTile.id) : []

  // Validate focus — if the focused tile no longer exists (stream ended), clear
  useEffect(() => {
    if (focused && !tiles.find(t => t.id === focused)) clearFocused()
  })

  // When a stream disappears (share stopped), remove it from activeTiles so that
  // if the same user starts sharing again it shows the click-to-watch placeholder.
  useEffect(() => {
    const tileIds = new Set(tiles.map(t => t.id))
    setActiveTiles(prev => {
      const pruned = new Set([...prev].filter(id => tileIds.has(id) || id === 'screen-local'))
      return pruned.size === prev.size ? prev : pruned
    })
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
            onClick={clearFocused}
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
            <div className="relative flex-1 min-h-0 rounded-xl overflow-hidden bg-black border border-white/10">
              <VideoCard
                tile={theaterTile} focused active
                onDeactivate={theaterTile.isLocal ? undefined : () => deactivateTile(theaterTile.id)}
                onClick={clearFocused}
              />
              {/* Fullscreen button — bottom right */}
              <button
                onClick={() => setFullscreen(true)}
                title="Fullscreen (Esc to exit)"
                className="absolute bottom-3 right-3 w-8 h-8 rounded-lg bg-black/60 hover:bg-black/90 flex items-center justify-center text-white/70 hover:text-white transition-colors z-10"
              >
                <Icon name="maximize" size={16} />
              </button>
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
                      active={t.isLocal || activeTiles.has(t.id)}
                      onActivate={() => activateTile(t.id)}
                      onDeactivate={t.isLocal ? undefined : () => deactivateTile(t.id)}
                      onClick={() => setFocused(t.id)}
                    />
                  ) : (
                    <ParticipantCard
                      key={t.id}
                      tile={t}
                      compact
                      isSpeaking={t.isSelf ? isSelfSpeaking : state.participants.find(p => p.user_id === t.user.id)?.is_speaking ?? false}
                      onStopCamera={t.isSelf && t.webcamStream ? toggleWebcam : undefined}
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
                  active={t.isLocal || activeTiles.has(t.id)}
                  onActivate={() => activateTile(t.id)}
                  onDeactivate={t.isLocal ? undefined : () => deactivateTile(t.id)}
                  onClick={() => setFocused(t.id)}
                />
              ) : (
                <ParticipantCard
                  key={t.id}
                  tile={t}
                  isSpeaking={t.isSelf ? isSelfSpeaking : state.participants.find(p => p.user_id === t.user.id)?.is_speaking ?? false}
                  onStopCamera={t.isSelf && t.webcamStream ? toggleWebcam : undefined}
                />
              )
            )}
          </div>
        )}
      </div>

      {/* Fullscreen overlay — rendered in a portal so it covers the entire viewport */}
      {fullscreen && theaterTile && createPortal(
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          {/* Top bar */}
          <div className="flex items-center gap-3 px-4 py-3 shrink-0">
            <span className="text-white/80 text-sm font-semibold truncate">{theaterTile.label}</span>
            <span className="text-[10px] uppercase font-bold text-white/50 bg-white/10 px-2 py-0.5 rounded-full">
              {theaterTile.tileType === 'screen' ? 'Screen' : 'Cam'}
            </span>
            <button
              onClick={() => setFullscreen(false)}
              title="Exit fullscreen (Esc)"
              className="ml-auto w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors"
            >
              <Icon name="minimize-2" size={18} />
            </button>
          </div>

          {/* Video */}
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <VideoEl stream={theaterTile.stream} />
          </div>

          {/* Bottom bar */}
          <div className="flex items-center justify-end px-4 py-3 shrink-0">
            <button
              onClick={() => setFullscreen(false)}
              className="flex items-center gap-2 text-sm text-white/60 hover:text-white border border-white/20 hover:border-white/40 px-4 py-2 rounded-lg transition-colors"
            >
              <Icon name="minimize-2" size={15} /> Exit Fullscreen
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
