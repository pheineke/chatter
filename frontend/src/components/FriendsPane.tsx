import { useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  getFriends, getFriendRequests,
  sendFriendRequest, acceptFriendRequest,
  declineFriendRequest, cancelFriendRequest, removeFriend,
} from '../api/friends'
import { getUserByUsername } from '../api/users'
import { UserAvatar } from './UserAvatar'
import { AvatarWithStatus } from './AvatarWithStatus'

type Tab = 'online' | 'all' | 'pending' | 'add'

export function FriendsPane({ onOpenNav }: { onOpenNav?: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user: currentUser } = useAuth()
  const [tab, setTab] = useState<Tab>('online')
  const [addUsername, setAddUsername] = useState('')
  const [addError, setAddError] = useState('')
  const [addSuccess, setAddSuccess] = useState('')
  const listViewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  // Clear "Add Friend" form state when switching tabs
  useEffect(() => {
    if (tab !== 'add') {
      setAddUsername('')
      setAddSuccess('')
      setAddError('')
    }
  }, [tab])

  const { data: friends = [], isError: friendsError } = useQuery({ queryKey: ['friends'], queryFn: getFriends })
  const { data: requests = [], isError: requestsError } = useQuery({ queryKey: ['friendRequests'], queryFn: getFriendRequests })

  const acceptMut = useMutation({
    mutationFn: acceptFriendRequest,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['friends'] }); qc.invalidateQueries({ queryKey: ['friendRequests'] }) },
  })
  const declineMut = useMutation({
    mutationFn: declineFriendRequest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friendRequests'] }),
  })
  const cancelMut = useMutation({
    mutationFn: cancelFriendRequest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friendRequests'] }),
  })
  const removeMut = useMutation({
    mutationFn: removeFriend,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  })
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  const sendMut = useMutation({
    mutationFn: async () => {
      const input = addUsername.trim()
      const recipientId = UUID_RE.test(input)
        ? input
        : (await getUserByUsername(input)).id
      if (currentUser && recipientId === currentUser.id) {
        throw Object.assign(new Error(), { isSelf: true })
      }
      return sendFriendRequest(recipientId)
    },
    onSuccess: () => { 
      setAddSuccess(`Friend request sent!`)
      setAddUsername('')
      setAddError('')
      setTimeout(() => setAddSuccess(''), 3000)
    },
    onError: (err: any) => {
      if (err?.isSelf) { setAddError("You can't add yourself."); setAddSuccess(''); return }
      const detail = err?.response?.data?.detail
      if (detail === 'User not found') setAddError('No user with that username or ID.')
      else if (detail === 'Cannot send a friend request to yourself') setAddError("You can't add yourself.")
      else setAddError('Request already sent or you are already friends.')
      setAddSuccess('')
    },
  })

  const displayed = tab === 'online'
    ? friends.filter((f) => f.user.status === 'online' || f.user.status === 'away' || f.user.status === 'dnd')
    : friends

  const pending = requests.filter((r) => r.status === 'pending')
  const incoming = pending.filter((r) => r.recipient.id === currentUser?.id)
  const outgoing = pending.filter((r) => r.sender.id === currentUser?.id)

  const ROW_HEIGHT = 64
  const OVERSCAN = 8
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil((viewportHeight || 520) / ROW_HEIGHT) + OVERSCAN * 2
  const endIndex = Math.min(displayed.length, startIndex + visibleCount)
  const visibleFriends = displayed.slice(startIndex, endIndex)
  const padTop = startIndex * ROW_HEIGHT
  const padBottom = (displayed.length - endIndex) * ROW_HEIGHT

  useEffect(() => {
    const el = listViewportRef.current
    if (!el) return
    const measure = () => setViewportHeight(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-0 md:px-4 px-5 md:py-3 py-3.5 border-b border-black/20 shadow-sm shrink-0 space-x-1">
        {onOpenNav && (
          <button
            className="md:hidden p-1 -ml-1 mr-2 text-sp-muted hover:text-sp-text shrink-0 flex items-center justify-center pt-1.5"
            onClick={onOpenNav}
            aria-label="Open navigation"
          >
            <Icon name="menu" size={22} />
          </button>
        )}
        <span className="font-bold md:text-base text-[17px] mr-4">Friends</span>
        {(['online', 'all', 'pending', 'add'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`md:px-3 px-3.5 md:py-1 py-1.5 rounded md:text-sm text-[15px] capitalize transition-colors relative
              ${tab === t ? 'bg-sp-input text-sp-text' : 'text-sp-muted hover:bg-sp-input/60 hover:text-sp-text'}`}
          >
            {t}
            {t === 'pending' && incoming.length > 0 && (
              <span className="absolute -top-1 -right-1 md:w-4 md:h-4 w-5 h-5 bg-red-500 text-white md:text-[10px] text-xs rounded-full flex items-center justify-center">
                {incoming.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div
        ref={listViewportRef}
        className="flex-1 min-h-0 overflow-y-auto md:p-4 p-5"
        onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
      >
        {tab === 'add' ? (
          <div className="max-w-md">
            <h3 className="font-semibold md:text-base text-[17px] mb-1">Add Friend</h3>
            <p className="md:text-sm text-[15px] text-sp-muted mb-3">You can add friends with their username or user ID.</p>
            <div className="flex gap-2">
              <input
                autoFocus
                className="input flex-1 md:text-sm text-[15px]"
                placeholder="Enter a username or user ID"
                value={addUsername}
                onChange={(e) => setAddUsername(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && addUsername.trim()) sendMut.mutate() }}
              />
              <button className="btn md:text-sm text-[15px] md:px-3 px-4 md:py-1.5 py-2.5" onClick={() => sendMut.mutate()} disabled={!addUsername.trim() || sendMut.isPending}>
                Send
              </button>
            </div>
            {addError && <p className="text-red-400 md:text-sm text-[15px] mt-2">{addError}</p>}
            {addSuccess && <p className="text-green-400 md:text-sm text-[15px] mt-2">{addSuccess}</p>}
          </div>
        ) : tab === 'pending' ? (
          <div className="space-y-2">
            {requestsError && (
              <p className="md:text-sm text-[15px] text-red-400">Could not load friend requests. Please try again.</p>
            )}
            {incoming.length > 0 && (
              <>
                <p className="md:text-xs text-[13px] uppercase font-semibold text-sp-muted mb-2">Incoming — {incoming.length}</p>
                {incoming.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 md:p-2 p-2.5 rounded hover:bg-sp-input/40 group select-none">
                    <UserAvatar user={r.sender} size={40} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold md:text-sm text-[15px]">{r.sender.username}</p>
                      <p className="md:text-xs text-[13px] text-sp-muted">Incoming Friend Request</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => acceptMut.mutate(r.id)} className="btn md:text-sm text-[15px] md:py-1 py-1.5 md:px-3 px-3.5" title="Accept"><Icon name="checkmark-circle" size={18} /></button>
                      <button onClick={() => declineMut.mutate(r.id)} className="btn md:text-sm text-[15px] md:py-1 py-1.5 md:px-3 px-3.5 bg-sp-input hover:bg-red-500" title="Decline"><Icon name="close-circle" size={18} /></button>
                    </div>
                  </div>
                ))}
              </>
            )}
            {outgoing.length > 0 && (
              <>
                <p className="md:text-xs text-[13px] uppercase font-semibold text-sp-muted mt-4 mb-2">Outgoing — {outgoing.length}</p>
                {outgoing.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 md:p-2 p-2.5 rounded hover:bg-sp-input/40 group select-none">
                    <UserAvatar user={r.recipient} size={40} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold md:text-sm text-[15px]">{r.recipient.username}</p>
                      <p className="md:text-xs text-[13px] text-sp-muted">Outgoing Friend Request</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => cancelMut.mutate(r.id)} className="btn md:text-sm text-[15px] md:py-1 py-1.5 md:px-3 px-3.5 bg-sp-input hover:bg-red-500" title="Cancel"><Icon name="close-circle" size={18} /></button>
                    </div>
                  </div>
                ))}
              </>
            )}
            {incoming.length === 0 && outgoing.length === 0 && (
              <p className="md:text-sm text-[15px] text-sp-muted">No pending friend requests.</p>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {friendsError && (
              <p className="md:text-sm text-[15px] text-red-400 mb-2">Could not load friends list. Please try again.</p>
            )}
            <p className="md:text-xs text-[13px] uppercase font-semibold text-sp-muted mb-2">
              {tab === 'online' ? 'Online' : 'All Friends'} — {displayed.length}
            </p>
            <div style={{ paddingTop: padTop, paddingBottom: padBottom }}>
            {visibleFriends.map((f) => (
              <div key={f.user.id} data-avatar-ring className="flex items-center gap-3 md:p-2 p-2.5 rounded hover:bg-sp-input/40 group cursor-pointer select-none"
                style={{ '--avatar-ring': '#1a1a1e', '--avatar-ring-hover': '#26272c' } as React.CSSProperties}
                onClick={() => navigate(`/channels/@me/${f.user.id}`)}>
                <AvatarWithStatus user={f.user} size={40} ringColor="#1a1a1e" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold md:text-sm text-[15px]">{f.user.username}</p>
                  <p className="md:text-xs text-[13px] text-sp-muted capitalize">{
                    f.user.status === 'away' ? 'Away' :
                    f.user.status === 'dnd' ? 'Do Not Disturb' :
                    f.user.status === 'online' ? 'Online' : 'Offline'
                  }</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={(e) => { e.stopPropagation(); navigate(`/channels/@me/${f.user.id}`) }} className="btn md:text-sm text-[15px] md:py-1 py-1.5 md:px-3 px-3.5" title="Message"><Icon name="message-circle" size={18} /></button>
                  <button onClick={(e) => { e.stopPropagation(); removeMut.mutate(f.user.id) }} className="btn md:text-sm text-[15px] md:py-1 py-1.5 md:px-2 px-2.5 bg-sp-input hover:bg-red-500" title="Remove"><Icon name="close" size={18} /></button>
                </div>
              </div>
            ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
