import { useNavigate } from 'react-router-dom'
import { UserAvatar } from './UserAvatar'
import { StatusIndicator } from './StatusIndicator'
import { Icon } from './Icon'
import { useQuery } from '@tanstack/react-query'
import { getUser } from '../api/users'
import { getDMs, sendDM } from '../api/dms'
import { useState, useEffect, useRef } from 'react'
import type { User } from '../api/types'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  userId: string
  onClose: () => void
  position: { x: number; y: number }
}

export function ProfileCard({ userId, onClose, position }: Props) {
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  const [msg, setMsg] = useState('')
  const { user: currentUser } = useAuth()
  const isSelf = !!currentUser && currentUser.id === userId

  const { data: user } = useQuery({ queryKey: ['user', userId], queryFn: () => getUser(userId) })

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  // Adjust position to stay in viewport
  // Simple clamping for now or just absolute positioning
  // Ideally use floating-ui but that's a dependency. We'll simulate.
  const style: React.CSSProperties = {
     position: 'fixed',
     left: Math.min(window.innerWidth - 320, Math.max(10, position.x)),
     top: Math.min(window.innerHeight - 400, Math.max(10, position.y)),
     zIndex: 100,
  }

  async function handleMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !msg.trim()) return
    await sendDM(user.id, msg)
    setMsg('')
    onClose()
    navigate(`/channels/@me/${user.id}`)
  }

  if (!user) return null

  const statusColors: Record<string, string> = {
    online: 'bg-green-500',
    idle: 'bg-yellow-500', 
    dnd: 'bg-red-500',
    offline: 'bg-gray-500',
  }

  return (
    <div ref={ref} style={style} className="w-80 bg-discord-sidebar rounded-lg shadow-2xl overflow-hidden flex flex-col text-discord-text animate-fade-in-up">
       {/* Banner */}
       <div 
         className="h-24 bg-discord-mention"
         style={{ backgroundColor: user.banner ? undefined : '#5865F2', backgroundImage: user.banner ? `url(/api/static/${user.banner})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}
       />

       <div className="px-4 pb-4 relative">
          {/* Avatar */}
          <div className="absolute -top-10 left-4 rounded-full p-1.5 bg-discord-sidebar">
             <div className="relative">
                <UserAvatar user={user} size={80} className="rounded-full" />
                <div className={`absolute bottom-1 right-1 w-6 h-6 rounded-full border-4 border-discord-sidebar ${statusColors[user.status]}`} />
             </div>
          </div>
          
          <div className="mt-12">
             <div className="text-xl font-bold leading-tight">{user.username}</div>
             <div className="text-sm text-discord-muted">{user.pronouns}</div>
             
             <div className="mt-4 border-t border-discord-input pt-2">
                 <div className="text-xs font-bold text-discord-muted uppercase mb-1">About Me</div>
                 <div className="text-sm text-discord-text/90 whitespace-pre-wrap text-sm leading-relaxed">
                    {user.description || <span className="italic text-discord-muted">No bio yet.</span>}
                 </div>
             </div>

             <div className="mt-4 border-t border-discord-input pt-2">
                 <div className="text-xs font-bold text-discord-muted uppercase mb-1">Note</div>
                 <input className="input w-full text-xs h-8 bg-transparent border-0 px-0 placeholder:text-discord-muted" placeholder="Click to add a note" />
             </div>

             <form onSubmit={handleMessage} className="mt-4">
                 {!isSelf && (
                   <input 
                      className="input w-full bg-discord-bg" 
                      placeholder={`Message @${user.username}`}
                      value={msg}
                      onChange={e => setMsg(e.target.value)}
                   />
                 )}
             </form>
          </div>
       </div>
    </div>
  )
}
