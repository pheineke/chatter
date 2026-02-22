import { useNavigate } from 'react-router-dom'
import { UserAvatar } from './UserAvatar'
import { StatusIndicator } from './StatusIndicator'
import { Icon } from './Icon'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getUser } from '../api/users'
import { getNote, setNote } from '../api/users'
import { getDMChannel } from '../api/dms'
import { sendMessage } from '../api/messages'
import { useState, useEffect, useRef, useCallback } from 'react'
import type { User } from '../api/types'
import { useAuth } from '../contexts/AuthContext'
import { useBlocks } from '../hooks/useBlocks'
import { Linkified } from '../utils/linkify'

function UserTag({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    navigator.clipboard.writeText(userId).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [userId])
  const short = userId.split('-')[0]
  return (
    <button
      onClick={copy}
      title="Click to copy user ID"
      className="flex items-center gap-1 text-xs text-discord-muted hover:text-discord-text transition mt-0.5 group"
    >
      <span className="font-mono">{short}…</span>
      <span className="opacity-0 group-hover:opacity-100 transition text-[10px]">
        {copied ? '✓ Copied!' : 'Copy ID'}
      </span>
    </button>
  )
}

interface Props {
  userId: string
  onClose: () => void
  position: { x: number; y: number }
}

export function ProfileCard({ userId, onClose, position }: Props) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const ref = useRef<HTMLDivElement>(null)
  const [msg, setMsg] = useState('')
  const [noteText, setNoteText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { user: currentUser } = useAuth()
  const isSelf = !!currentUser && currentUser.id === userId
  const { blockedIds, block, unblock, isPending: blockPending } = useBlocks()
  const isBlocked = blockedIds.has(userId)

  const { data: user } = useQuery({ queryKey: ['user', userId], queryFn: () => getUser(userId) })

  const { data: savedNote } = useQuery({
    queryKey: ['note', userId],
    queryFn: () => getNote(userId),
    enabled: !isSelf,
  })

  // Sync textarea when note data loads
  useEffect(() => {
    if (savedNote !== undefined) setNoteText(savedNote)
  }, [savedNote])

  const noteMut = useMutation({
    mutationFn: (content: string) => setNote(userId, content),
    onSuccess: () => {
      setNoteSaving(false)
      qc.invalidateQueries({ queryKey: ['note', userId] })
    },
  })

  function handleNoteChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setNoteText(e.target.value)
    setNoteSaving(true)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      noteMut.mutate(e.target.value)
    }, 800)
  }

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
    const { channel_id } = await getDMChannel(user.id)
    await sendMessage(channel_id, msg.trim())
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
             <UserTag userId={user.id} />
             <div className="text-sm text-discord-muted">{user.pronouns}</div>
             
             <div className="mt-4 border-t border-discord-input pt-2">
                 <div className="text-xs font-bold text-discord-muted uppercase mb-1">About Me</div>
                 <div className="text-sm text-discord-text/90 whitespace-pre-wrap leading-relaxed">
                    {user.description
                      ? <Linkified text={user.description} noMentions />
                      : <span className="italic text-discord-muted">No bio yet.</span>}
                 </div>
             </div>

             <div className="mt-4 border-t border-discord-input pt-2">
                 <div className="flex items-center justify-between mb-1">
                   <div className="text-xs font-bold text-discord-muted uppercase">Note</div>
                   {noteSaving && <span className="text-[10px] text-discord-muted">Saving…</span>}
                 </div>
                 {isSelf ? null : (
                   <textarea
                     className="input w-full text-xs bg-black/20 border-0 px-2 py-1.5 placeholder:text-discord-muted resize-none"
                     rows={2}
                     value={noteText}
                     onChange={handleNoteChange}
                     placeholder="Click to add a note"
                   />
                 )}
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

             {!isSelf && (
               <div className="mt-3 pt-3 border-t border-discord-input">
                 <button
                   onClick={() => isBlocked ? unblock(userId) : block(userId)}
                   disabled={blockPending}
                   className={`w-full text-sm py-1.5 px-3 rounded transition-colors font-medium
                     ${ isBlocked
                       ? 'bg-discord-input hover:bg-green-500/20 hover:text-green-400'
                       : 'bg-discord-input hover:bg-red-500/20 hover:text-red-400 text-discord-muted'
                     }`}
                 >
                   {isBlocked ? 'Unblock User' : 'Block User'}
                 </button>
               </div>
             )}
          </div>
       </div>
    </div>
  )
}
