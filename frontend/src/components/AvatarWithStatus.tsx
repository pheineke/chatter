import { UserAvatar } from './UserAvatar'
import { StatusIndicator } from './StatusIndicator'
import type { User } from '../api/types'

interface Props {
  user: User | null
  size?: number
  /** Tailwind bg class matching the parent background — used to render the "cutout" ring around the status dot. */
  bg?: string
  className?: string
}

/**
 * Avatar + status indicator badge as a single composable unit.
 * Use this everywhere a user avatar is displayed alongside their presence status.
 * Do NOT use in message lists — those render bare <UserAvatar> without status.
 */
export function AvatarWithStatus({ user, size = 32, bg = 'bg-discord-sidebar', className = '' }: Props) {
  // Scale the dot and its padding ring proportionally to the avatar size.
  const dotSize = Math.max(6, Math.round(size * 0.3))
  const pad = size <= 24 ? 1.5 : size >= 60 ? 4 : 3

  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      <UserAvatar user={user} size={size} />
      {user && (
        <span
          className={`absolute -bottom-1 -right-1 rounded-full ${bg} flex items-center justify-center`}
          style={{ padding: pad }}
        >
          <StatusIndicator status={user.status} size={dotSize} />
        </span>
      )}
    </div>
  )
}
