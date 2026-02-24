import { UserAvatar } from './UserAvatar'
import { StatusIndicator } from './StatusIndicator'
import type { User } from '../api/types'

interface Props {
  user: User | null
  size?: number
  /** Hex color matching the parent background — used for the "cutout" ring around the status dot. */
  ringColor?: string
  className?: string
}

/**
 * Avatar + status indicator badge as a single composable unit.
 *
 * The ring around the status dot uses an inline background-color so it always
 * matches the parent surface — including on hover.  Parent rows should set the
 * CSS variable `--avatar-ring` on hover so the cutout follows along:
 *
 *   style={{ '--avatar-ring': '#121214' } as React.CSSProperties}
 *   + a :hover rule (or Tailwind arbitrary) that changes the variable.
 *
 * If the variable isn't set, `ringColor` (prop) is used as fallback.
 */
export function AvatarWithStatus({ user, size = 32, ringColor = '#121214', className = '' }: Props) {
  const dotSize = Math.max(6, Math.round(size * 0.3))
  const pad = size <= 24 ? 1.5 : size >= 60 ? 4 : 3

  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      <UserAvatar user={user} size={size} />
      {user && (
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full flex items-center justify-center transition-[background-color] duration-150"
          style={{ padding: pad, backgroundColor: `var(--avatar-ring, ${ringColor})` }}
        >
          <StatusIndicator status={user.status} size={dotSize} />
        </span>
      )}
    </div>
  )
}
