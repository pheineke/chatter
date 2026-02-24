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

  if (!user) return null

  return (
    <>
    <div className="px-2 py-1.5 flex items-center gap-1 shrink-0">
      <div 
        className="flex items-center gap-2 flex-1 min-w-0 hover:bg-white/10 p-1 pl-0.5 rounded cursor-pointer transition-colors group"
        onClick={(e) => {
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
                await updateMe({ status: s.value as any })
                await refreshUser()
              },
            })),
          })
        }}
      >
        <AvatarWithStatus user={user} size={32} className="ml-1" />
        <div className="min-w-0 flex flex-col justify-center">
          <div className="text-sm font-semibold truncate leading-4 text-discord-text">{user.username}</div>
          <div className="text-xs text-discord-muted truncate capitalize leading-3 group-hover:text-discord-text/80 transition-colors">
            {user.status === 'dnd' ? 'Do Not Disturb' : user.status}
          </div>
        </div>
      </div>
      
      <div className="flex items-center">
        <button
          title="User Settings"
          onClick={() => navigate('/channels/settings')}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-discord-input/60 text-discord-muted hover:text-discord-text transition-colors"
        >
          <Icon name="settings" size={18} />
        </button>
      </div>
      
    </div>

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
