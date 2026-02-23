import { useNavigate, useParams } from 'react-router-dom'
import { getLastChannel } from '../utils/lastChannel'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getMyServers, createServer } from '../api/servers'
import { joinViaInvite } from '../api/invites'
import { Icon } from './Icon'
import { ContextMenu } from './ContextMenu'
import { InviteModal } from './InviteModal'
import type { Server } from '../api/types'
import { useUnreadChannels } from '../contexts/UnreadChannelsContext'
import { useNotificationSettings } from '../hooks/useNotificationSettings'

function ServerIcon({ server, active, hasUnread, isMuted, onContextMenu }: { server: Server; active: boolean; hasUnread: boolean; isMuted: boolean; onContextMenu: (e: React.MouseEvent) => void }) {
  const navigate = useNavigate()
  const initials = server.title
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="relative">
      <button
        title={server.title}
        onClick={() => {
          const last = getLastChannel(server.id)
          navigate(last ? `/channels/${server.id}/${last}` : `/channels/${server.id}`)
        }}
        onContextMenu={onContextMenu}
        className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-150 select-none
          ${active ? 'rounded-2xl bg-discord-mention text-white' : 'bg-discord-input text-discord-text hover:rounded-2xl hover:bg-discord-mention hover:text-white'}`}
      >
        {server.image ? (
          <img src={`/api/static/${server.image}`} alt={server.title} className="w-full h-full rounded-[inherit] object-cover" />
        ) : (
          initials
        )}
      </button>
      {hasUnread && !active && (
        <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-white border-2 border-discord-servers pointer-events-none" />
      )}
      {isMuted && (
        <span className="absolute -bottom-0.5 -left-0.5 w-4 h-4 rounded-full bg-discord-servers flex items-center justify-center pointer-events-none">
          <Icon name="bell-off" size={10} className="text-discord-muted" />
        </span>
      )}
    </div>
  )
}

interface ServerSidebarProps {
  hasUnreadDMs?: boolean
}

export function ServerSidebar({ hasUnreadDMs = false }: ServerSidebarProps) {
  const { serverId } = useParams<{ serverId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [name, setName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; serverId: string } | null>(null)
  const [inviteModalServerId, setInviteModalServerId] = useState<string | null>(null)

  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: getMyServers })
  const { unreadServers } = useUnreadChannels()
  const { serverLevel, setServerLevel } = useNotificationSettings()

  const handleCreateInvite = (sId: string) => {
    setInviteModalServerId(sId)
  }

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
    mutationFn: () => {
      // Accept either a bare code or a full invite URL
      const code = inviteCode.trim().split('/invite/').pop()!.trim()
      return joinViaInvite(code)
    },
    onSuccess: ({ server_id }) => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      setShowJoin(false)
      setInviteCode('')
      navigate(`/channels/${server_id}`)
    },
  })

  return (
    <div className="flex flex-col items-center gap-2 py-3 w-[72px] bg-discord-servers overflow-y-auto scrollbar-none">
      {/* DMs */}
      <div className="relative">
        <button
          title="Direct Messages"
          onClick={() => navigate('/channels/@me')}
          className={`w-12 h-12 rounded-full flex items-center justify-center bg-discord-sidebar hover:rounded-2xl hover:bg-discord-mention transition-all text-discord-mention hover:text-white text-xl font-bold`}
        >
          <Icon name="message-circle" size={24} />
        </button>
        {hasUnreadDMs && (
          <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-discord-online border-2 border-discord-servers" />
        )}
      </div>

      <div className="w-8 h-px bg-discord-input" />

      {servers.map((s) => (
        <ServerIcon
          key={s.id}
          server={s}
          active={s.id === serverId}
          hasUnread={unreadServers.has(s.id)}
          isMuted={serverLevel(s.id) === 'mute'}
          onContextMenu={(e) => {
            e.preventDefault()
            setContextMenu({ x: e.clientX, y: e.clientY, serverId: s.id })
          }}
        />
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

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'Server Settings',
              icon: 'settings',
              onClick: () => navigate(`/channels/${contextMenu.serverId}/settings`),
            },
            {
              label: 'Invite to Server',
              icon: 'person-add',
              onClick: () => handleCreateInvite(contextMenu.serverId),
            },
            { separator: true },
            {
              label: serverLevel(contextMenu.serverId) === 'mute' ? 'Unmute Server' : 'Mute Server',
              icon: serverLevel(contextMenu.serverId) === 'mute' ? 'bell' : 'bell-off',
              onClick: () => setServerLevel(
                contextMenu.serverId,
                serverLevel(contextMenu.serverId) === 'mute' ? 'all' : 'mute',
              ),
            },
          ]}
        />
      )}

      {/* Invite Modal */}
      {inviteModalServerId && (
        <InviteModal
          serverId={inviteModalServerId}
          serverName={servers.find((s) => s.id === inviteModalServerId)?.title ?? 'Server'}
          onClose={() => setInviteModalServerId(null)}
        />
      )}

      {/* Create server modal */}
      {showCreate && (
        <Modal title="Create Server" onClose={() => setShowCreate(false)}>
          <input
            autoFocus
            className="input w-full mb-3"
            placeholder="Server name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) createMut.mutate() }}
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
          <p className="text-sm text-discord-muted mb-3">Paste an invite link or code below.</p>
          <input
            autoFocus
            className="input w-full mb-2"
            placeholder="https://…/invite/abc123  or  abc123"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && inviteCode.trim()) joinMut.mutate() }}
          />
          {joinMut.isError && <p className="text-red-400 text-xs mb-2">Invalid or expired invite.</p>}
          <button className="btn w-full" onClick={() => joinMut.mutate()} disabled={!inviteCode.trim() || joinMut.isPending}>
            {joinMut.isPending ? 'Joining…' : 'Join Server'}
          </button>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, onClose, children, className = 'w-80' }: { title: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className={`bg-discord-sidebar rounded-lg p-6 ${className}`} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  )
}
