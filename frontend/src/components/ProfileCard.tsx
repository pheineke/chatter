import { useNavigate } from 'react-router-dom'
import { AvatarWithStatus } from './AvatarWithStatus'
import { Icon } from './Icon'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getUser } from '../api/users'
import { getDMChannel } from '../api/dms'
import { sendMessage } from '../api/messages'
import { getMyServers } from '../api/servers'
import { createInvite } from '../api/invites'
import { useState, useEffect, useRef, useCallback } from 'react'
import type { User } from '../api/types'
import { useAuth } from '../contexts/AuthContext'
import { useBlocks } from '../hooks/useBlocks'
import { Linkified } from '../utils/linkify'
import { ProfileFullModal } from './ProfileFullModal'

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
  const [menuOpen, setMenuOpen] = useState(false)
  const [showInviteSubmenu, setShowInviteSubmenu] = useState(false)
  const [showFullProfile, setShowFullProfile] = useState(false)
  const [focusNote, setFocusNote] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const devMode = localStorage.getItem('devMode') === 'true'
  const { user: currentUser } = useAuth()
  const isSelf = !!currentUser && currentUser.id === userId
  const { blockedIds, block, unblock, isPending: blockPending } = useBlocks()
  const isBlocked = blockedIds.has(userId)

  const { data: user } = useQuery({ queryKey: ['user', userId], queryFn: () => getUser(userId) })

  const { data: myServers } = useQuery({
    queryKey: ['myServers'],
    queryFn: getMyServers,
    enabled: menuOpen && showInviteSubmenu,
  })

  async function handleInviteToServer(serverId: string) {
    if (!user) return
    try {
      const invite = await createInvite(serverId)
      // Send the invite link via DM
      const { channel_id } = await getDMChannel(user.id)
      await sendMessage(channel_id, `${window.location.origin}/invite/${invite.code}`)
      setMenuOpen(false)
    } catch { /* ignore */ }
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

  return (
    <div ref={ref} style={style} className="group/card w-80 bg-discord-sidebar rounded-lg shadow-2xl overflow-hidden flex flex-col text-discord-text animate-fade-in-up">
       {/* Banner */}
       <div 
         className="h-24 bg-discord-mention relative"
         style={{ backgroundColor: user.banner ? undefined : '#5865F2', backgroundImage: user.banner ? `url(/api/static/${user.banner})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}
       >
         {/* More options button */}
         <div className="absolute top-2 right-2" ref={menuRef}>
           <button
             onClick={() => { setMenuOpen(v => !v); setShowInviteSubmenu(false) }}
             className="w-7 h-7 flex items-center justify-center rounded-full bg-black/40 text-white/80 hover:text-white hover:bg-black/60 transition-colors"
             title="More options"
           >
             <Icon name="more-horizontal" size={18} />
           </button>

           {menuOpen && (
             <div className="absolute right-0 top-full mt-1 w-52 bg-[#111214] border border-white/[0.07] rounded-md shadow-2xl z-[110] overflow-visible py-1 text-sm">
               {/* View Full Profile */}
               <button
                 onClick={() => { setShowFullProfile(true); setMenuOpen(false) }}
                 className="w-full text-left px-3 py-2 hover:bg-white/10 text-discord-text transition-colors"
               >View Full Profile</button>

               {isSelf ? (
                 <>
                   {/* Edit Profile — self only */}
                   <button
                     onClick={() => { navigate('/channels/settings?tab=profile'); setMenuOpen(false); onClose() }}
                     className="w-full text-left px-3 py-2 hover:bg-white/10 text-discord-text transition-colors"
                   >Edit Profile</button>
                 </>
               ) : (
                 <>
                   {/* Invite to Server submenu */}
                   <div
                     className="relative"
                     onMouseEnter={() => setShowInviteSubmenu(true)}
                     onMouseLeave={() => setShowInviteSubmenu(false)}
                   >
                     <button className="w-full text-left px-3 py-2 hover:bg-white/10 text-discord-text transition-colors flex items-center justify-between">
                       <span>Invite to Server</span>
                       <Icon name="chevron-right" size={14} className="text-discord-muted" />
                     </button>
                     {showInviteSubmenu && (
                       <div className="absolute left-full top-0 ml-1 w-48 bg-[#111214] border border-white/[0.07] rounded-md shadow-2xl py-1">
                         {!myServers && <div className="px-3 py-2 text-xs text-discord-muted">Loading…</div>}
                         {myServers && myServers.length === 0 && <div className="px-3 py-2 text-xs text-discord-muted">No servers</div>}
                         {myServers?.map(s => (
                           <button
                             key={s.id}
                             onClick={() => handleInviteToServer(s.id)}
                             className="w-full text-left px-3 py-2 hover:bg-white/10 text-discord-text text-sm transition-colors truncate"
                           >{s.title}</button>
                         ))}
                       </div>
                     )}
                   </div>

                   {/* Separator */}
                   <div className="my-1 border-t border-white/[0.08]" />

                   {/* Ignore */}
                   <button className="w-full text-left px-3 py-2 hover:bg-white/10 text-discord-text transition-colors"
                     onClick={() => setMenuOpen(false)}
                   >Ignore</button>

                   {/* Block */}
                   <button
                     onClick={() => { isBlocked ? unblock(userId) : block(userId); setMenuOpen(false) }}
                     disabled={blockPending}
                     className="w-full text-left px-3 py-2 hover:bg-red-500/20 text-red-400 transition-colors"
                   >{isBlocked ? 'Unblock' : 'Block'}</button>
                 </>
               )}

               {/* Separator + Copy User ID (dev mode only) */}
               {devMode && (
                 <>
                   <div className="my-1 border-t border-white/[0.08]" />
                   <button
                     onClick={() => { navigator.clipboard.writeText(userId); setMenuOpen(false) }}
                     className="w-full text-left px-3 py-2 hover:bg-white/10 text-discord-muted hover:text-discord-text transition-colors"
                   >Copy User ID</button>
                 </>
               )}
             </div>
           )}
         </div>
       </div>

       <div className="px-4 pb-4 relative">
          {/* Avatar */}
          <div className="absolute -top-10 left-4 rounded-full p-1.5 bg-discord-sidebar">
             <AvatarWithStatus user={user} size={80} ringColor="#121214" />
          </div>
          
          <div className="mt-12">
             <div className="flex items-center gap-2">
               <div className="text-xl font-bold leading-tight">{user.username}</div>
               {!isSelf && (
                 <span
                   title="Add Note"
                   onClick={() => { setShowFullProfile(true); setFocusNote(true) }}
                   className="cursor-pointer text-discord-muted hover:text-discord-text transition-colors leading-none opacity-0 group-hover/card:opacity-100 translate-y-px"
                 >
                   <Icon name="file-text" size={14} />
                 </span>
               )}
             </div>
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

       {/* Full profile modal */}
       {showFullProfile && <ProfileFullModal user={user} onClose={() => { setShowFullProfile(false); setFocusNote(false) }} focusNote={focusNote} />}
    </div>
  )
}
