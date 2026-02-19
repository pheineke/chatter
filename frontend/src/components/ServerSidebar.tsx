import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getMyServers, createServer, joinServer } from '../api/servers'
import { Icon } from './Icon'
import type { Server } from '../api/types'

function ServerIcon({ server, active }: { server: Server; active: boolean }) {
  const navigate = useNavigate()
  const initials = server.title
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <button
      title={server.title}
      onClick={() => navigate(`/channels/${server.id}`)}
      className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-150 select-none
        ${active ? 'rounded-2xl bg-discord-mention text-white' : 'bg-discord-input text-discord-text hover:rounded-2xl hover:bg-discord-mention hover:text-white'}`}
    >
      {server.image ? (
        <img src={server.image} alt={server.title} className="w-full h-full rounded-[inherit] object-cover" />
      ) : (
        initials
      )}
    </button>
  )
}

export function ServerSidebar() {
  const { serverId } = useParams<{ serverId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [name, setName] = useState('')
  const [inviteCode, setInviteCode] = useState('')

  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: getMyServers })

  const createMut = useMutation({
    mutationFn: () => createServer(name),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      setShowCreate(false)
      setName('')
      navigate(`/channels/${s.id}`)
    },
  })

  const joinMut = useMutation({
    mutationFn: () => joinServer(inviteCode),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      setShowJoin(false)
      setInviteCode('')
      navigate(`/channels/${m.server_id}`)
    },
  })

  return (
    <div className="flex flex-col items-center gap-2 py-3 w-[72px] bg-discord-servers overflow-y-auto scrollbar-none">
      {/* DMs */}
      <button
        title="Direct Messages"
        onClick={() => navigate('/channels/@me')}
        className={`w-12 h-12 rounded-full flex items-center justify-center bg-discord-sidebar hover:rounded-2xl hover:bg-discord-mention transition-all text-discord-mention hover:text-white text-xl font-bold`}
      >
        <Icon name="message-circle" size={24} />
      </button>

      <div className="w-8 h-px bg-discord-input" />

      {servers.map((s) => (
        <ServerIcon key={s.id} server={s} active={s.id === serverId} />
      ))}

      <div className="w-8 h-px bg-discord-input" />

      {/* Add / Join server */}
      <button
        title="Create or Join Server"
        onClick={() => setShowCreate(true)}
        className="w-12 h-12 rounded-full bg-discord-input hover:rounded-2xl hover:bg-green-500 transition-all flex items-center justify-center text-green-400 hover:text-white"
      >
        <Icon name="plus" size={24} />
      </button>

      {/* Create server modal */}
      {showCreate && (
        <Modal title="Create Server" onClose={() => setShowCreate(false)}>
          <input
            className="input w-full mb-3"
            placeholder="Server name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-2">
            <button className="btn flex-1" onClick={() => createMut.mutate()} disabled={!name.trim() || createMut.isPending}>
              Create
            </button>
            <button className="btn btn-ghost flex-1" onClick={() => { setShowCreate(false); setShowJoin(true) }}>
              Join Instead
            </button>
          </div>
        </Modal>
      )}

      {/* Join server modal */}
      {showJoin && (
        <Modal title="Join Server" onClose={() => setShowJoin(false)}>
          <input
            className="input w-full mb-3"
            placeholder="Invite code"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
          />
          <button className="btn w-full" onClick={() => joinMut.mutate()} disabled={!inviteCode.trim() || joinMut.isPending}>
            Join
          </button>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-discord-sidebar rounded-lg p-6 w-80" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  )
}
