import { useId } from 'react'
import { UserAvatar } from './UserAvatar'
import { StatusIndicator } from './StatusIndicator'
import type { User } from '../api/types'

interface Props {
  user: User | null
  size?: number
  /** @deprecated No longer needed — the ring is now a transparent CSS outline that clips against any background. */
  ringColor?: string
  className?: string
}

/**
 * Avatar + status indicator badge as a single composable unit.
 *
 * Uses an SVG mask to cut a "bite" out of the avatar for the status indicator,
 * ensuring the background shows through the gap between avatar and status dot.
 * This approach prevents sub-pixel drifting issues common with CSS masks.
 */
export function AvatarWithStatus({ user, size = 32, className = '' }: Props) {
  const maskId = useId()
  const dotSize = Math.max(6, Math.round(size * 0.3))
  const pad = size <= 24 ? 1.5 : size >= 60 ? 4 : 3

  // If no user, just render the avatar without bells and whistles
  if (!user) {
    return (
      <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
        <UserAvatar user={user} size={size} />
      </div>
    )
  }

  // Calculate position of the status dot center
  const offset = 0.5
  const center = size - (dotSize / 2) + offset
  const cutoutRadius = (dotSize / 2) + pad

  const statusColorClass = {
    online: 'text-sp-online',
    away: 'text-sp-idle',
    dnd: 'text-sp-dnd',
    offline: 'text-sp-offline'
  }[user.status]

  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ overflow: 'visible' }}
      >
        <defs>
          <mask id={maskId}>
            <rect x={-size} y={-size} width={size * 3} height={size * 3} fill="white" />
            <circle cx={center} cy={center} r={cutoutRadius} fill="black" />
          </mask>
        </defs>

        <foreignObject
          x={0}
          y={0}
          width={size}
          height={size}
          mask={`url(#${maskId})`}
          style={{ overflow: 'visible' }}
        >
          <div className="w-full h-full"> 
            <UserAvatar user={user} size={size} />
          </div>
        </foreignObject>

        {/* Status dot rendered as SVG circle to ensure perfect alignment with mask */}
        <circle 
          cx={center} 
          cy={center} 
          r={dotSize / 2} 
          className={`fill-current ${statusColorClass}`}
        />
      </svg>
    </div>
  )
}
