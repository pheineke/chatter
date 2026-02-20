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
    return (
      <img
        src={`/api/static/${user.avatar}`}
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
