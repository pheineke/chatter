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
  const [hovered, setHovered] = useState(false)
  const expanded = active || hovered
  const initials = server.title
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div
      className="relative w-full py-0.5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Animated shape container */}
      <div
        style={{
          width: expanded ? '100%' : '48px',
          borderRadius: expanded ? '8px' : '9999px',
          transition: 'width 220ms ease-out, border-radius 220ms ease-out',
        }}
        className="relative h-12 mx-auto overflow-hidden"
      >
        <button
          title={server.title}
          onClick={() => {
            const last = getLastChannel(server.id)
            navigate(last ? `/channels/${server.id}/${last}` : `/channels/${server.id}`)
          }}
          onContextMenu={onContextMenu}
          className={`absolute inset-0 w-full h-full flex items-center justify-center text-sm font-bold select-none transition-colors duration-150
            ${active
              ? 'bg-sp-primary/20 text-sp-on-primary'
              : hovered
                ? 'bg-sp-primary/15 text-sp-primary'
                : 'bg-sp-surface-variant/80 text-sp-on-surface'}`}
        >
          {server.image ? (
            <>
              <img
                src={`/api/static/${server.image}`}
                alt={server.title}
                className="absolute inset-0 w-full h-full object-cover transition-opacity duration-150"
                style={{ opacity: active ? 0.7 : hovered ? 0.6 : 1 }}
              />
              {active && <div className="absolute inset-0 bg-sp-primary/20 pointer-events-none" />}
            </>
          ) : (
            initials
          )}
        </button>
      </div>

      {hasUnread && !active && (
        <span className="absolute bottom-1 right-3 w-2.5 h-2.5 rounded-full bg-white border-2 border-sp-servers pointer-events-none" />
      )}
      {isMuted && (
        <span className="absolute top-1 left-3 w-4 h-4 rounded-full bg-sp-servers flex items-center justify-center pointer-events-none">
          <Icon name="bell-off" size={10} className="text-sp-muted" />
        </span>
      )}
    </div>
  )
}

interface ServerSidebarProps {
  hasUnreadDMs?: boolean
  activeServerId: string | null
}

export function ServerSidebar({ hasUnreadDMs = false, activeServerId }: ServerSidebarProps) {
  const { serverId } = useParams<{ serverId: string }>()
  const effectiveServerId = activeServerId ?? serverId
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [name, setName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; serverId: string } | null>(null)
  const [inviteModalServerId, setInviteModalServerId] = useState<string | null>(null)

  const [dmContextMenu, setDmContextMenu] = useState<{ x: number; y: number } | null>(null)

  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: getMyServers })
  const { unreadServers, markAllServerRead } = useUnreadChannels()
  const { serverLevel, setServerLevel } = useNotificationSettings()

  function handleMarkServerRead(sId: string) {
    markAllServerRead(sId)
  }

  function handleMarkAllDMsRead() {
    const convs = qc.getQueryData<{ channel_id: string; last_message_at: string | null }[]>(['dmConversations']) ?? []
    if (!convs.length) return
    const LAST_READ_KEY = 'dmLastRead'
    const existing: Record<string, string> = (() => {
      try { return JSON.parse(localStorage.getItem(LAST_READ_KEY) ?? '{}') } catch { return {} }
    })()
    const now = new Date().toISOString()
    const updated = { ...existing }
    convs.forEach(c => { updated[c.channel_id] = c.last_message_at ?? now })
    localStorage.setItem(LAST_READ_KEY, JSON.stringify(updated))
    window.dispatchEvent(new StorageEvent('storage', { key: LAST_READ_KEY }))
  }

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
    <div className="flex flex-col items-center gap-2 py-3 w-[72px] bg-sp-servers overflow-y-auto scrollbar-none border-r border-sp-divider/60">
      {/* DMs */}
      <div className="relative">
        <button
          title="Direct Messages"
          onClick={() => navigate('/channels/@me')}
          onContextMenu={(e) => { e.preventDefault(); setDmContextMenu({ x: e.clientX, y: e.clientY }) }}
          className={`w-12 h-12 rounded-full flex items-center justify-center bg-sp-input hover:bg-sp-hover transition-all shadow-sp-1 hover:shadow-sp-2 hover:scale-105 text-sp-mention text-xl font-bold`}
        >
          <Icon name="message-circle" size={24} />
        </button>
        {hasUnreadDMs && (
          <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-sp-online border-2 border-sp-servers" />
        )}
      </div>

      <div className="w-8 h-px bg-sp-divider/60" />

      {servers.map((s) => (
        <ServerIcon
          key={s.id}
          server={s}
          active={s.id === effectiveServerId}
          hasUnread={unreadServers.has(s.id)}
          isMuted={serverLevel(s.id) === 'mute'}
          onContextMenu={(e) => {
            e.preventDefault()
            setContextMenu({ x: e.clientX, y: e.clientY, serverId: s.id })
          }}
        />
      ))}

      <div className="w-8 h-px bg-sp-divider/60" />

      {/* Add / Join server */}
      <button
        title="Create or Join Server"
        onClick={() => setShowCreate(true)}
        className="w-12 h-12 rounded-full bg-sp-input hover:bg-sp-hover transition-all shadow-sp-1 hover:shadow-sp-2 hover:scale-105 flex items-center justify-center text-sp-mention"
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
            ...(unreadServers.has(contextMenu.serverId) ? [
              {
                label: 'Mark as Read',
                icon: 'check-circle',
                onClick: () => handleMarkServerRead(contextMenu.serverId),
              },
              { separator: true },
            ] : []),
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

      {/* DM nav context menu */}
      {dmContextMenu && (
        <ContextMenu
          x={dmContextMenu.x}
          y={dmContextMenu.y}
          onClose={() => setDmContextMenu(null)}
          items={[
            {
              label: 'Mark all as Read',
              icon: 'check-circle',
              onClick: handleMarkAllDMsRead,
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
          <p className="text-sm text-sp-muted mb-3">Paste an invite link or code below.</p>
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
      <div className={`bg-sp-popup border border-sp-divider/60 rounded-sp-xl p-6 ${className}`} style={{ boxShadow: 'var(--sp-shadow-3)' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  )
}
