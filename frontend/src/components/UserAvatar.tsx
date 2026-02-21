import { useState, useEffect, useRef } from 'react'
import type { User } from '../api/types'

interface Props {
  user: User | null
  size?: number
  className?: string
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

export function UserAvatar({ user, size = 40, className = '' }: Props) {
  const px = `${size}px`
  const style = { width: px, height: px, minWidth: px, fontSize: size * 0.4 }

  if (!user) {
    return (
      <div
        style={style}
        className={`rounded-full bg-discord-input flex items-center justify-center ${className}`}
      />
    )
  }

  if (user.avatar) {
    const src = `/api/static/${user.avatar}`
    if (user.avatar.toLowerCase().endsWith('.gif')) {
      return <GifAvatar src={src} alt={user.username} size={size} className={className} />
    }
    return (
      <img
        src={src}
        alt={user.username}
        style={style}
        className={`rounded-full object-cover ${className}`}
      />
    )
  }

  return (
    <div
      style={style}
      className={`rounded-full flex items-center justify-center text-white font-bold select-none ${colorFor(user.username)} ${className}`}
    >
      {user.username[0].toUpperCase()}
    </div>
  )
}
