import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { updateMe } from '../api/users'
import { AvatarWithStatus } from './AvatarWithStatus'
import { Icon } from './Icon'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuItem } from './ContextMenu'

export function UserPanel() {
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  if (!user) return null

  return (
    <>
    <div className="px-3 py-2 flex items-center gap-2 shrink-0 h-16 bg-sp-user select-none">
      <button
        className="flex items-center gap-2 flex-1 min-w-0 hover:bg-white/5 rounded-md px-3 py-2 cursor-pointer transition-colors group text-left"
        onClick={(e) => {
          setStatusError(null)
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const statuses: { label: string; value: string; icon: string }[] = [
            { label: 'Online',  value: 'online',  icon: 'ellipse' },
            { label: 'Away',    value: 'away',    icon: 'time' },
            { label: 'Do Not Disturb', value: 'dnd',  icon: 'remove-circle' },
            { label: 'Offline', value: 'offline', icon: 'ellipse' },
          ]
          setContextMenu({
            x: rect.left,
            y: rect.top - 8, // slight offset upwards
            items: statuses.map(s => ({
              label: s.label,
              icon: s.icon,
              active: user.status === s.value,
              onClick: async () => {
                try {
                  await updateMe({ status: s.value as any })
                  await refreshUser()
                } catch {
                  setStatusError('Failed to update status. Please try again.')
                }
              },
            })),
          })
        }}
        aria-label="Open status menu"
      >
        <AvatarWithStatus user={user} size={36} />
        <div className="min-w-0 flex flex-col justify-center text-left">
          <div className="text-sm font-semibold truncate leading-5 text-sp-text">{user.username}</div>
          <div className="text-xs text-sp-muted truncate capitalize leading-4 group-hover:text-sp-text/80 transition-colors">
            {user.status === 'dnd' ? 'Do Not Disturb' : user.status}
          </div>
        </div>
      </button>
      
      <div className="flex items-center">
        <button
          title="User Settings"
          onClick={() => navigate('/channels/settings')}
          className="w-10 h-10 flex items-center justify-center rounded hover:bg-white/10 text-sp-muted hover:text-sp-text transition-all"
        >
          <Icon name="settings" size={22} />
        </button>
      </div>
      
    </div>

    {statusError && (
      <div className="px-3 pb-1 text-xs text-red-400">{statusError}</div>
    )}

    {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}
