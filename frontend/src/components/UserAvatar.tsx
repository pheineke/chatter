import { useState, useEffect, useRef } from 'react'
import type { User } from '../api/types'
import { AVATAR_FRAMES } from '../utils/avatarFrames'

interface Props {
  user: User | null
  size?: number
  className?: string
  /** Hide the decoration overlay (e.g. in tiny contexts) */
  hideDecoration?: boolean
}

const COLORS = [
  'bg-blue-500', 'bg-green-500', 'bg-yellow-500',
  'bg-purple-500', 'bg-pink-500', 'bg-red-500', 'bg-indigo-500',
]

function colorFor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

/** For GIF avatars: shows the first frame as a static canvas, animates on hover. */
function GifAvatar({ src, alt, size, className }: { src: string; alt: string; size: number; className: string }) {
  const px = `${size}px`
  const style = { width: px, height: px, minWidth: px }
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hovered, setHovered] = useState(false)
  const [frameReady, setFrameReady] = useState(false)

  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(img, 0, 0, size, size)
      setFrameReady(true)
    }
    img.src = src
  }, [src, size])

  return (
    <div
      style={style}
      className={`rounded-full overflow-hidden relative shrink-0 ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Animated GIF — always in DOM so it loads, visible only on hover */}
      <img
        src={src}
        alt={alt}
        style={{ ...style, position: 'absolute', inset: 0, display: hovered ? 'block' : 'none' }}
        className="rounded-full object-cover"
      />
      {/* First-frame canvas shown when not hovering */}
      <canvas
        ref={canvasRef}
        style={{ ...style, display: (!hovered && frameReady) ? 'block' : hovered ? 'none' : 'block', opacity: frameReady ? 1 : 0 }}
        className="rounded-full"
      />
    </div>
  )
}

export function UserAvatar({ user, size = 40, className = '', hideDecoration = false }: Props) {
  const px = `${size}px`
  const style = { width: px, height: px, minWidth: px, fontSize: size * 0.4 }

  // Resolve the decoration SVG src (if any)
  const decorationSrc = (!hideDecoration && user?.avatar_decoration)
    ? AVATAR_FRAMES.find(f => f.id === user.avatar_decoration)?.src ?? null
    : null

  // The decoration overlay extends ~25% outside the avatar circle on each side
  const decoScale = 1.45
  const decoPx = `${size * decoScale}px`
  const decoOffset = `${-(size * (decoScale - 1)) / 2}px`

  if (!user) {
    return (
      <div style={{ position: 'relative', width: px, height: px, minWidth: px }} className={`shrink-0 ${className}`}>
        <div
          style={style}
          className="rounded-full bg-discord-input flex items-center justify-center"
        />
      </div>
    )
  }

  let avatarEl: React.ReactNode

  if (user.avatar) {
    const src = `/api/static/${user.avatar}`
    if (user.avatar.toLowerCase().endsWith('.gif')) {
      avatarEl = <GifAvatar src={src} alt={user.username} size={size} className="" />
    } else {
      avatarEl = (
        <img
          src={src}
          alt={user.username}
          style={style}
          className="rounded-full object-cover"
        />
      )
    }
  } else {
    avatarEl = (
      <div
        style={style}
        className={`rounded-full flex items-center justify-center text-white font-bold select-none ${colorFor(user.username)}`}
      >
        {user.username[0].toUpperCase()}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: px, height: px, minWidth: px }} className={`shrink-0 ${className}`}>
      {avatarEl}
      {decorationSrc && (
        <img
          src={decorationSrc}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none select-none"
          style={{
            position: 'absolute',
            width: decoPx,
            height: decoPx,
            top: decoOffset,
            left: decoOffset,
          }}
        />
      )}
    </div>
  )
}
