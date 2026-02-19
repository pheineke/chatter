import type { UserStatus } from '../api/types'

interface Props {
  status: UserStatus
  size?: number
}

const STATUS_COLORS: Record<UserStatus, string> = {
  online: 'bg-discord-online',
  away: 'bg-discord-idle',
  busy: 'bg-discord-dnd',
  offline: 'bg-discord-offline',
}

export function StatusIndicator({ status, size = 10 }: Props) {
  const px = `${size}px`
  return (
    <span
      className={`inline-block rounded-full border-2 border-discord-sidebar ${STATUS_COLORS[status]}`}
      style={{ width: px, height: px }}
    />
  )
}
