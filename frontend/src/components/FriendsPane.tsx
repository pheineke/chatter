import { useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  getFriends, getFriendRequests,
  sendFriendRequest, acceptFriendRequest,
  declineFriendRequest, removeFriend,
} from '../api/friends'
import { UserAvatar } from './UserAvatar'
import { StatusIndicator } from './StatusIndicator'
import { getDMs } from '../api/dms'

type Tab = 'online' | 'all' | 'pending' | 'add'

export function FriendsPane() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('online')
  const [addUsername, setAddUsername] = useState('')
  const [addError, setAddError] = useState('')
  const [addSuccess, setAddSuccess] = useState('')

  const { data: friends = [] } = useQuery({ queryKey: ['friends'], queryFn: getFriends })
  const { data: requests = [] } = useQuery({ queryKey: ['friendRequests'], queryFn: getFriendRequests })

  const acceptMut = useMutation({
    mutationFn: acceptFriendRequest,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['friends'] }); qc.invalidateQueries({ queryKey: ['friendRequests'] }) },
  })
  const declineMut = useMutation({
    mutationFn: declineFriendRequest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friendRequests'] }),
  })
  const removeMut = useMutation({
    mutationFn: removeFriend,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  })
  const sendMut = useMutation({
    mutationFn: () => sendFriendRequest(addUsername),
    onSuccess: () => { setAddSuccess(`Friend request sent to ${addUsername}!`); setAddUsername(''); setAddError('') },
    onError: () => { setAddError('User not found or request already sent.'); setAddSuccess('') },
  })

  const displayed = tab === 'online'
    ? friends.filter((f) => f.user.status === 'online')
    : friends

  const pending = requests.filter((r) => r.status === 'pending')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-0 px-4 py-3 border-b border-black/20 shadow-sm shrink-0 space-x-1">
        <span className="font-bold mr-4">Friends</span>
        {(['online', 'all', 'pending', 'add'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1 rounded text-sm capitalize transition-colors relative
              ${tab === t ? 'bg-discord-input text-discord-text' : 'text-discord-muted hover:bg-discord-input/60 hover:text-discord-text'}`}
          >
            {t}
            {t === 'pending' && pending.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
                {pending.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'add' ? (
          <div className="max-w-md">
            <h3 className="font-semibold mb-1">Add Friend</h3>
            <p className="text-sm text-discord-muted mb-3">You can add friends with their username.</p>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="Enter a username"
                value={addUsername}
                onChange={(e) => setAddUsername(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && addUsername.trim()) sendMut.mutate() }}
              />
              <button className="btn" onClick={() => sendMut.mutate()} disabled={!addUsername.trim() || sendMut.isPending}>
                Send
              </button>
            </div>
            {addError && <p className="text-red-400 text-sm mt-2">{addError}</p>}
            {addSuccess && <p className="text-green-400 text-sm mt-2">{addSuccess}</p>}
          </div>
        ) : tab === 'pending' ? (
          <div className="space-y-2">
            <p className="text-xs uppercase font-semibold text-discord-muted mb-2">Pending — {pending.length}</p>
            {pending.map((r) => (
              <div key={r.id} className="flex items-center gap-3 p-2 rounded hover:bg-discord-input/40 group">
                <UserAvatar user={r.sender} size={40} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{r.sender.username}</p>
                  <p className="text-xs text-discord-muted">Incoming Friend Request</p>
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => acceptMut.mutate(r.id)} className="btn text-sm py-1 px-3" title="Accept"><Icon name="checkmark-circle" size={16} /></button>
                  <button onClick={() => declineMut.mutate(r.id)} className="btn text-sm py-1 px-3 bg-discord-input hover:bg-red-500" title="Decline"><Icon name="close-circle" size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-xs uppercase font-semibold text-discord-muted mb-2">
              {tab === 'online' ? 'Online' : 'All Friends'} — {displayed.length}
            </p>
            {displayed.map((f) => (
              <div key={f.user.id} className="flex items-center gap-3 p-2 rounded hover:bg-discord-input/40 group cursor-pointer"
                onClick={() => navigate(`/channels/@me/${f.user.id}`)}>
                <div className="relative">
                  <UserAvatar user={f.user} size={40} />
                  <span className="absolute -bottom-0.5 -right-0.5">
                    <StatusIndicator status={f.user.status} size={12} />
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{f.user.username}</p>
                  <p className="text-xs text-discord-muted capitalize">{f.user.status}</p>
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => { e.stopPropagation(); navigate(`/channels/@me/${f.user.id}`) }} className="btn text-sm py-1 px-3" title="Message"><Icon name="message-circle" size={16} /></button>
                  <button onClick={(e) => { e.stopPropagation(); removeMut.mutate(f.user.id) }} className="btn text-sm py-1 px-2 bg-discord-input hover:bg-red-500" title="Remove"><Icon name="close" size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
