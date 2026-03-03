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
 * The ring around the status dot is rendered via `outline: transparent` so it
 * clips naturally against any parent background without needing a matching
 * background-color value.
 */
export function AvatarWithStatus({ user, size = 32, className = '' }: Props) {
  const dotSize = Math.max(6, Math.round(size * 0.3))
  const pad = size <= 24 ? 1.5 : size >= 60 ? 4 : 3

  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      <UserAvatar user={user} size={size} />
      {user && (
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full"
          style={{ outline: `${pad}px solid transparent` }}
        >
          <StatusIndicator status={user.status} size={dotSize} />
        </span>
      )}
    </div>
  )
}
