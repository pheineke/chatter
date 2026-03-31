import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { getMembers } from '../api/servers'
import { UserAvatar } from './UserAvatar'
import { AvatarWithStatus } from './AvatarWithStatus'
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
  /** Live webcam stream — when present, replaces the avatar with video. */
  webcamStream?: MediaStream
}

interface VideoTile {
  kind: 'video'
  id: string
  label: string
  stream: MediaStream | null
  /** Optional audio stream to play alongside the video (e.g. screen-share system audio). */
  audioStream?: MediaStream
  tileType: 'screen' | 'webcam'
  /** Local tiles are always active; remote tiles start as a placeholder. */
  isLocal: boolean
}

type DetachMode = 'separate' | 'shared'

type Tile = ParticipantTile | VideoTile

// ─── Video element ──────────────────────────────────────────────────────────

function VideoEl({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (!ref.current) return
    ref.current.srcObject = stream
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
        ${hasVideo ? 'bg-black' : 'bg-sp-sidebar'}
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
                <span className="inline-flex items-center justify-center" title="Muted">
                  <Icon name="mic-off" size={12} className="text-white/85 drop-shadow" />
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
          <AvatarWithStatus user={tile.user} size={compact ? 40 : 64} />
          {!compact && (
            <span className="mt-2 text-sm font-semibold text-sp-text truncate max-w-full px-2">
              {tile.user.username}{tile.isSelf ? ' (You)' : ''}
            </span>
          )}
          {/* Muted / deafened badges */}
          <div className={`absolute flex gap-1 ${compact ? 'bottom-1 right-1' : 'bottom-2 right-2'}`}>
            {tile.isMuted && (
              <span className="inline-flex items-center justify-center" title="Muted">
                <Icon name="mic-off" size={14} className="text-sp-muted" />
              </span>
            )}
            {tile.isDeafened && (
              <span className="w-5 h-5 rounded-full bg-sp-bg/80 flex items-center justify-center">
                <Icon name="headphones-off" size={11} className="text-red-400" />
              </span>
            )}
          </div>
          {compact && (
            <span className="mt-1 text-[10px] text-sp-muted truncate max-w-[88px] px-1 text-center leading-none">
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
  tile, compact = false, focused = false, active = false, isDetached = false, detachMode, onActivate, onDeactivate, onClick, onDetach, onFocusDetached,
}: {
  tile: VideoTile; compact?: boolean; focused?: boolean
  active?: boolean; isDetached?: boolean; detachMode?: DetachMode
  onActivate?: () => void; onDeactivate?: () => void; onClick?: () => void
  onDetach?: (mode: DetachMode) => void; onFocusDetached?: () => void
}) {
  // Detached placeholder — shown when stream is popped out
  if (isDetached) {
    return (
      <div
        className={`relative flex flex-col items-center justify-center rounded-xl bg-gradient-to-br from-blue-600/20 to-blue-900/20 border-2 border-blue-500/50 cursor-pointer group
          ${compact ? 'w-24 h-24 shrink-0' : 'w-full h-full min-h-[120px]'}`}
        onClick={onFocusDetached}
      >
        <div className="flex flex-col items-center gap-2 text-blue-300 group-hover:text-blue-200 transition-colors">
          <Icon name={detachMode === 'shared' ? 'monitor' : 'external-link'} size={compact ? 20 : 36} />
          {!compact && <span className="text-xs font-semibold">Stream Popped Out</span>}
        </div>
        {!compact && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <span className="text-white text-xs font-semibold bg-black/70 px-3 py-1.5 rounded-full flex items-center gap-1.5">
              <Icon name="arrow-up-right" size={12} /> Focus Window
            </span>
          </div>
        )}
        <div className="absolute top-2 right-2">
          <span className="text-[10px] uppercase font-bold text-blue-300 bg-blue-500/30 px-1.5 py-0.5 rounded">
            {detachMode === 'shared' ? 'Shared' : 'Separate'}
          </span>
        </div>
        {compact && (
          <span className="mt-1 text-[10px] text-blue-300 truncate max-w-[88px] px-1 text-center leading-none">
            {tile.label}
          </span>
        )}
      </div>
    )
  }

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
          <span className="mt-1 text-[10px] text-sp-muted truncate max-w-[88px] px-1 text-center leading-none">
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
      {tile.stream ? (
        <>
          <VideoEl stream={tile.stream} />
          {/* Play screen-share system audio alongside the video when present */}
          {tile.audioStream && <AudioEl stream={tile.audioStream} />}
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70">
          <Icon name="loader" size={26} className="animate-spin" />
          <span className="text-xs font-semibold">Waiting for stream…</span>
        </div>
      )}
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
        {onDetach && (
          <>
            <button
              title="Open this stream in its own window"
              className="opacity-0 group-hover:opacity-100 transition text-[10px] font-bold text-white bg-black/65 hover:bg-black/90 px-1.5 py-0.5 rounded flex items-center gap-1"
              onClick={e => { e.stopPropagation(); onDetach('separate') }}
            >
              <Icon name="external-link" size={10} />{!compact && 'Separate Window'}
            </button>
            <button
              title="Open this stream in the combined streams window"
              className="opacity-0 group-hover:opacity-100 transition text-[10px] font-bold text-white bg-black/65 hover:bg-black/90 px-1.5 py-0.5 rounded flex items-center gap-1"
              onClick={e => { e.stopPropagation(); onDetach('shared') }}
            >
              <Icon name="monitor" size={10} />{!compact && 'Combined Window'}
            </button>
          </>
        )}
        {onDeactivate && (
          <button
            title="Stop watching"
            className="opacity-0 group-hover:opacity-100 transition text-[10px] font-bold text-white bg-red-600/80 hover:bg-red-600 px-1.5 py-0.5 rounded flex items-center gap-1"
            onClick={e => { e.stopPropagation(); onDeactivate() }}
          >
            <Icon name="x" size={10} />{!compact && 'Exit'}
          </button>
        )}
        <span className="text-[10px] uppercase font-bold text-white bg-sp-mention/80 px-1.5 py-0.5 rounded">
          {tile.tileType === 'screen' ? 'Screen' : 'Cam'}
        </span>
      </div>
    </div>
  )
}

function DetachedStreamCard({
  tile,
  onReturn,
}: {
  tile: VideoTile
  onReturn: () => void
}) {
  return (
    <div className="w-full h-full bg-black text-white flex flex-col">
      <div className="h-11 shrink-0 px-3 flex items-center gap-2 border-b border-white/15 bg-black/70">
        <span className="text-sm font-semibold truncate">{tile.label}</span>
        <span className="text-[10px] uppercase font-bold text-white/80 bg-white/15 px-1.5 py-0.5 rounded">
          {tile.tileType === 'screen' ? 'Screen' : 'Cam'}
        </span>
        <button
          onClick={onReturn}
          className="ml-auto text-xs rounded bg-white/10 hover:bg-white/20 px-2.5 py-1 flex items-center gap-1.5"
        >
          <Icon name="arrow-back" size={12} /> Return to grid
        </button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center">
        {tile.stream ? (
          <>
            <VideoEl stream={tile.stream} />
            {tile.audioStream && <AudioEl stream={tile.audioStream} />}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 text-white/70">
            <Icon name="loader" size={26} className="animate-spin" />
            <span className="text-xs font-semibold">Waiting for stream…</span>
          </div>
        )}
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
  const { state, remoteScreenStreams, remoteWebcamStreams, remoteScreenAudioStreams, localScreenStream, localWebcamStream, toggleWebcam, isSelfSpeaking } = useVoiceCall()
  const [focused, setFocused] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  // Tile IDs the user has explicitly activated (clicked to watch/listen).
  // Local tiles are pre-seeded so the user always sees their own streams.
  const [activeTiles, setActiveTiles] = useState<Set<string>>(
    () => new Set(['screen-local'])
  )
  const [detachedTiles, setDetachedTiles] = useState<Record<string, DetachMode>>({})
  const [detachedContainers, setDetachedContainers] = useState<Record<string, HTMLElement>>({})
  const [sharedContainer, setSharedContainer] = useState<HTMLElement | null>(null)
  const detachedWindowsRef = useRef<Record<string, Window | null>>({})
  const sharedWindowRef = useRef<Window | null>(null)

  const activateTile   = (id: string) => setActiveTiles(prev => new Set([...prev, id]))
  const deactivateTile = (id: string) => {
    if (focused === id) setFocused(null)
    setActiveTiles(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  function cloneStylesToWindow(targetDoc: Document) {
    targetDoc.head.innerHTML = ''
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      targetDoc.head.appendChild(node.cloneNode(true))
    })
  }

  function createWindowContainer(win: Window, title: string): HTMLElement {
    const doc = win.document
    doc.title = title
    cloneStylesToWindow(doc)
    doc.body.className = 'm-0 p-0 bg-sp-bg'
    doc.body.innerHTML = ''
    const container = doc.createElement('div')
    container.style.width = '100%'
    container.style.height = '100vh'
    doc.body.appendChild(container)
    return container
  }

  function detachTile(tileId: string, mode: DetachMode) {
    activateTile(tileId)

    if (mode === 'shared') {
      let win = sharedWindowRef.current
      if (!win || win.closed) {
        win = window.open('', 'chatter-shared-streams', 'width=1280,height=760')
        if (!win) return
        const container = createWindowContainer(win, 'Chatter Streams')
        sharedWindowRef.current = win
        setSharedContainer(container)
        win.addEventListener('beforeunload', () => {
          sharedWindowRef.current = null
          setSharedContainer(null)
          setDetachedTiles(prev => {
            const next: Record<string, DetachMode> = {}
            Object.entries(prev).forEach(([k, v]) => {
              if (v !== 'shared') next[k] = v
            })
            return next
          })
        })
      }
      setDetachedTiles(prev => ({ ...prev, [tileId]: 'shared' }))
      win.focus()
      return
    }

    let win = detachedWindowsRef.current[tileId]
    if (!win || win.closed) {
      win = window.open('', `chatter-stream-${tileId}`, 'width=1100,height=700')
      if (!win) return
      const container = createWindowContainer(win, 'Chatter Stream')
      detachedWindowsRef.current[tileId] = win
      setDetachedContainers(prev => ({ ...prev, [tileId]: container }))
      win.addEventListener('beforeunload', () => {
        detachedWindowsRef.current[tileId] = null
        setDetachedContainers(prev => {
          const next = { ...prev }
          delete next[tileId]
          return next
        })
        setDetachedTiles(prev => {
          const next = { ...prev }
          delete next[tileId]
          return next
        })
      })
    }
    setDetachedTiles(prev => ({ ...prev, [tileId]: 'separate' }))
    win.focus()
  }

  function reattachTile(tileId: string) {
    const mode = detachedTiles[tileId]

    setDetachedTiles(prev => {
      const next = { ...prev }
      delete next[tileId]
      return next
    })

    if (focused === tileId) clearFocused()

    const win = detachedWindowsRef.current[tileId]
    if (win && !win.closed) win.close()
    detachedWindowsRef.current[tileId] = null
    setDetachedContainers(prev => {
      const next = { ...prev }
      delete next[tileId]
      return next
    })

    // If this was the last shared stream, close the shared popout too.
    if (mode === 'shared') {
      const hasAnotherShared = Object.entries(detachedTiles).some(([id, m]) => id !== tileId && m === 'shared')
      if (!hasAnotherShared) {
        if (sharedWindowRef.current && !sharedWindowRef.current.closed) {
          sharedWindowRef.current.close()
        }
        sharedWindowRef.current = null
        setSharedContainer(null)
      }
    }
  }

  // Exit fullscreen when theater mode ends
  function clearFocused() {
    setFocused(null)
    setFullscreen(false)
  }

  // Focus a detached window
  function focusDetachedWindow(tileId: string) {
    const mode = detachedTiles[tileId]
    if (mode === 'shared') {
      if (sharedWindowRef.current && !sharedWindowRef.current.closed) {
        sharedWindowRef.current.focus()
      }
    } else if (mode === 'separate') {
      const win = detachedWindowsRef.current[tileId]
      if (win && !win.closed) {
        win.focus()
      }
    }
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
      // Always show webcam in the participant tile, regardless of screen-sharing state
      webcamStream: state.isSharingWebcam ? localWebcamStream ?? undefined : undefined,
    })
  }

  // Remote participant tiles
  state.participants.forEach(p => {
    const m = members.find(m => m.user_id === p.user_id)
    const user: User = m?.user ?? {
      id: p.user_id,
      username: p.username ?? `User ${p.user_id.slice(0, 4)}`,
      avatar: p.avatar ?? null,
      avatar_decoration: null,
      description: null,
      status: 'offline' as const,
      preferred_status: 'offline' as const,
      created_at: '',
      banner: null,
      pronouns: null,
      dm_permission: 'everyone' as const,
      hide_status: false,
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
      // Webcam always goes in the participant tile — independent of screen-sharing state
      webcamStream: p.is_sharing_webcam && remoteWebcamStreams[p.user_id]
        ? remoteWebcamStreams[p.user_id] : undefined,
    })
    // Remote screen share tile — audioStream carries system audio if the user shared it
    if (p.is_sharing_screen) {
      tiles.push({
        kind: 'video',
        id: `screen-${p.user_id}`,
        label: `${user.username}'s Screen`,
        // Firefox and some WebRTC paths may not set `contentHint=detail`,
        // so the incoming screen video can land in the webcam stream map.
        stream: remoteScreenStreams[p.user_id] ?? remoteWebcamStreams[p.user_id] ?? null,
        audioStream: remoteScreenAudioStreams[p.user_id],
        tileType: 'screen',
        isLocal: false,
      })
    }
    // Webcam is now embedded in the participant tile — no separate VideoTile needed
  })

  // Local screen share tile — always active (user sees their own preview)
  if (localScreenStream && state.isSharingScreen) {
    tiles.push({
      kind: 'video',
      id: 'screen-local',
      label: 'Your Screen',
      stream: localScreenStream,
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

  // Cleanup detached windows for streams that ended.
  useEffect(() => {
    const alive = new Set(tiles.filter((t): t is VideoTile => t.kind === 'video').map(t => t.id))
    Object.keys(detachedTiles).forEach((tileId) => {
      if (!alive.has(tileId)) {
        reattachTile(tileId)
      }
    })
  }, [tiles, detachedTiles])

  // Close child windows when leaving voice pane.
  useEffect(() => {
    return () => {
      Object.values(detachedWindowsRef.current).forEach((win) => {
        if (win && !win.closed) win.close()
      })
      if (sharedWindowRef.current && !sharedWindowRef.current.closed) {
        sharedWindowRef.current.close()
      }
    }
  }, [])

  // Participant count label ──────────────────────────────────────────────────
  const participantCount = state.participants.length + 1
  const sharedDetachedIds = Object.entries(detachedTiles)
    .filter(([, mode]) => mode === 'shared')
    .map(([tileId]) => tileId)
  const isSingleSharedTile = sharedDetachedIds.length === 1

  return (
    <div className="flex flex-col h-full bg-sp-bg select-none">
      {/* Header */}
      <div className="h-12 flex items-center gap-2 px-4 border-b border-black/20 shrink-0">
        <Icon name="headphones" size={16} className="text-sp-online shrink-0" />
        <span className="font-semibold truncate">{session.channelName}</span>
        <span className="text-sp-muted text-xs ml-1 shrink-0">
          {participantCount} participant{participantCount !== 1 ? 's' : ''}
        </span>
        {theaterTile && (
          <button
            onClick={clearFocused}
            className="ml-auto flex items-center gap-1 text-xs text-sp-muted hover:text-sp-text transition-colors"
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
                tile={theaterTile}
                focused
                isDetached={!!detachedTiles[theaterTile.id]}
                detachMode={detachedTiles[theaterTile.id]}
                active
                onDeactivate={theaterTile.isLocal ? undefined : () => deactivateTile(theaterTile.id)}
                onClick={clearFocused}
                onDetach={!theaterTile.isLocal ? (mode) => detachTile(theaterTile.id, mode) : undefined}
                onFocusDetached={() => focusDetachedWindow(theaterTile.id)}
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
                      isDetached={!!detachedTiles[t.id]}
                      detachMode={detachedTiles[t.id]}
                      active={t.isLocal || activeTiles.has(t.id)}
                      onActivate={() => activateTile(t.id)}
                      onDeactivate={t.isLocal ? undefined : () => deactivateTile(t.id)}
                      onClick={() => setFocused(t.id)}
                      onDetach={!t.isLocal ? (mode) => detachTile(t.id, mode) : undefined}
                      onFocusDetached={() => focusDetachedWindow(t.id)}
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
          <div className={`h-full grid ${gridCols(tiles.filter(t => t.kind === 'video').length)} gap-4 auto-rows-fr content-start`}>
            {tiles.map(t =>
              t.kind === 'video' ? (
                <VideoCard
                  key={t.id}
                  tile={t}
                  isDetached={!!detachedTiles[t.id]}
                  detachMode={detachedTiles[t.id]}
                  active={t.isLocal || activeTiles.has(t.id)}
                  onActivate={() => activateTile(t.id)}
                  onDeactivate={t.isLocal ? undefined : () => deactivateTile(t.id)}
                  onClick={() => setFocused(t.id)}
                  onDetach={!t.isLocal ? (mode) => detachTile(t.id, mode) : undefined}
                  onFocusDetached={() => focusDetachedWindow(t.id)}
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
            {theaterTile.stream ? (
              <VideoEl stream={theaterTile.stream} />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 text-white/70">
                <Icon name="loader" size={30} className="animate-spin" />
                <span className="text-sm font-semibold">Waiting for stream…</span>
              </div>
            )}
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

      {/* Detached windows: per-stream */}
      {Object.entries(detachedTiles).map(([tileId, mode]) => {
        if (mode !== 'separate') return null
        const tile = tiles.find((t): t is VideoTile => t.kind === 'video' && t.id === tileId)
        const container = detachedContainers[tileId]
        if (!tile || !container) return null
        return createPortal(
          <DetachedStreamCard tile={tile} onReturn={() => reattachTile(tileId)} />,
          container,
        )
      })}

      {/* Detached window: shared */}
      {sharedContainer && createPortal(
        <div className="w-full h-full bg-sp-bg text-sp-text p-3 flex flex-col gap-3">
          <div className="shrink-0 flex items-center gap-2 border-b border-sp-divider/50 pb-2">
            <Icon name="monitor" size={16} className="text-sp-mention" />
            <span className="font-semibold text-sm">Shared Detached Streams</span>
          </div>
          <div className={`flex-1 min-h-0 grid ${isSingleSharedTile ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'} gap-3 auto-rows-fr content-start`}>
            {sharedDetachedIds.map((tileId) => {
                const tile = tiles.find((t): t is VideoTile => t.kind === 'video' && t.id === tileId)
                if (!tile) return null
                return (
                  <div
                    key={tileId}
                    className={`rounded-xl overflow-hidden border border-sp-divider/50 bg-black ${isSingleSharedTile ? 'h-full min-h-0' : 'min-h-[220px]'}`}
                  >
                    <DetachedStreamCard tile={tile} onReturn={() => reattachTile(tileId)} />
                  </div>
                )
              })}
          </div>
        </div>,
        sharedContainer,
      )}
    </div>
  )
}
