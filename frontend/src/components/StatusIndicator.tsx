import type { UserStatus } from '../api/types'

interface Props {
  status: UserStatus
  size?: number
  className?: string
}

const STATUS_COLORS: Record<UserStatus, string> = {
  online: 'bg-discord-online',
  away: 'bg-discord-idle',
  dnd: 'bg-discord-dnd',
  offline: 'bg-discord-offline',
}

export function StatusIndicator({ status, size = 10, className = '' }: Props) {
  const px = `${size}px`
  
  return (
    <span
      className={`inline-block rounded-full ${STATUS_COLORS[status]} ${className}`}
      style={{ width: px, height: px }}
    />
  )
}
