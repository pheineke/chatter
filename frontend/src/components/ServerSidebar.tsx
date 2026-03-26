import { PortalModal } from './PortalModal'
import { markDMRead, getConversations } from '../api/dms'
import { useNavigate, useParams, useLocation, useMatch } from 'react-router-dom'
import { getLastChannel } from '../utils/lastChannel'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getMyServers, createServer, leaveServer } from '../api/servers'
import { joinViaInvite } from '../api/invites'
import { Icon } from './Icon'
import { ContextMenu } from './ContextMenu'
import { InviteModal } from './InviteModal'
import type { Server, DMConversation } from '../api/types'
import { useUnreadChannels } from '../contexts/UnreadChannelsContext'
import { useNotificationSettings } from '../hooks/useNotificationSettings'
import { useAuth } from '../contexts/AuthContext'

function DMTab({ active, unreadCount = 0, onClick, onContextMenu }: { active: boolean; unreadCount?: number; onClick: () => void; onContextMenu: (e: React.MouseEvent) => void }) {
  const [hovered, setHovered] = useState(false)
  const [pressing, setPressing] = useState(false)

  const containerWidth = active ? '72px' : '52px'

  return (
    <div
      className="relative w-full py-0.5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressing(false) }}
    >
      <div
        className="h-12 overflow-hidden relative"
        style={{
          width: containerWidth,
          marginLeft: 'auto',
          borderRadius: active ? '12px 0px 0px 12px' : '8px 0px 0px 8px',
          transition: 'width 120ms ease-out, border-radius 120ms ease-out',
        }}
      >
        <button
          title="Direct Messages"
          onMouseDown={() => setPressing(true)}
          onMouseUp={() => setPressing(false)}
          onClick={onClick}
          onContextMenu={onContextMenu}
          style={{
            transform: pressing ? 'scale(0.92)' : 'scale(1)',
            transformOrigin: 'right center',
            transition: 'color 150ms ease-out, background-color 150ms ease-out, transform 80ms ease-out',
          }}
          className={`absolute inset-0 w-full h-full flex items-center justify-center select-none
            ${active
              ? 'bg-sp-bg border-2 border-r-0 border-sp-primary text-sp-primary rounded-l-xl'
              : hovered
                ? 'bg-sp-primary/15 text-sp-primary rounded-l-lg'
                : 'bg-sp-surface-variant/80 text-sp-muted rounded-l-lg'}`}
        >
          <Icon name="message-circle" size={24} />
        </button>
      </div>
      {/* Unread badge removed as requested — individual DMs now show as separate tabs */}
    </div>
  )
}

function ServerIcon({ server, active, hasUnread, isMuted, onContextMenu }: { server: Server; active: boolean; hasUnread: boolean; isMuted: boolean; onContextMenu: (e: React.MouseEvent) => void }) {
  const navigate = useNavigate()
  const [hovered, setHovered] = useState(false)
  const [pressing, setPressing] = useState(false)

  // Bookmark tab anchored to right wall: grows leftward on active
  const containerWidth = active ? '72px' : '52px'

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
      onMouseLeave={() => { setHovered(false); setPressing(false) }}
    >
      {/* Tab container — right-aligned, grows left */}
      <div
        className="h-12 overflow-hidden relative"
        style={{
          width: containerWidth,
          marginLeft: 'auto',
          borderRadius: active ? '12px 0px 0px 12px' : '8px 0px 0px 8px',
          transition: 'width 120ms ease-out, border-radius 120ms ease-out',
        }}
      >
        <button
          title={server.title}
          onMouseDown={() => setPressing(true)}
          onMouseUp={() => setPressing(false)}
          onClick={() => {
            const last = getLastChannel(server.id)
            navigate(last ? `/channels/${server.id}/${last}` : `/channels/${server.id}`)
          }}
          onContextMenu={onContextMenu}
          style={{
            transform: pressing ? 'scale(0.92)' : 'scale(1)',
            transformOrigin: 'right center',
            transition: 'color 150ms ease-out, background-color 150ms ease-out, transform 80ms ease-out',
          }}
          className={`absolute inset-0 w-full h-full flex items-center justify-center text-sm font-bold select-none relative overflow-hidden
            ${active
              ? 'bg-sp-bg border-2 border-r-0 border-sp-primary text-sp-primary rounded-l-xl'
              : hovered
                ? 'bg-sp-primary/15 text-sp-primary rounded-l-lg'
                : 'bg-sp-surface-variant/80 text-sp-on-surface rounded-l-lg'}`}
        >
          {server.image ? (
            <>
              <img
                src={`/api/static/${server.image}`}
                alt={server.title}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ opacity: (!active && hovered) ? 0.8 : 1, transition: 'opacity 150ms ease-out' }}
              />
            </>
          ) : (
            initials
          )}
        </button>
      </div>

      {hasUnread && !active && (
        <span className="absolute bottom-1 right-0.5 w-2.5 h-2.5 rounded-full bg-white border-2 border-sp-servers pointer-events-none" />
      )}
      {isMuted && (
        <span className="absolute top-1 right-0.5 w-4 h-4 rounded-full bg-sp-bg flex items-center justify-center pointer-events-none">
          <Icon name="bell-off" size={10} className="text-sp-muted" />
        </span>
      )}
    </div>
  )
}


function UnreadDMItem({ conversation, onContextMenu }: { conversation: DMConversation; onContextMenu: (e: React.MouseEvent) => void }) {
  const navigate = useNavigate()
  const [hovered, setHovered] = useState(false)
  const [pressing, setPressing] = useState(false)
  
  const user = conversation.other_user
  const initials = user.username.slice(0, 2).toUpperCase()
  const count = conversation.unread_count || 0

  return (
    <div
      className="relative w-full py-0.5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressing(false) }}
    >
      <div
        className="h-12 overflow-hidden relative"
        style={{
          width: '52px',
          marginLeft: 'auto',
          borderRadius: '8px 0px 0px 8px',
          transition: 'width 120ms ease-out, border-radius 120ms ease-out',
        }}
      >
        <button
          title={`${user.username} (${count} unread)`}
          onMouseDown={() => setPressing(true)}
          onMouseUp={() => setPressing(false)}
          onClick={() => navigate(`/channels/@me/${user.id}`)}
          onContextMenu={onContextMenu}
          style={{
            transform: pressing ? 'scale(0.92)' : 'scale(1)',
            transformOrigin: 'right center',
            transition: 'color 150ms ease-out, background-color 150ms ease-out, transform 80ms ease-out',
          }}
          className={`absolute inset-0 w-full h-full flex items-center justify-center select-none font-bold text-sm
            ${hovered
                ? 'bg-sp-primary/15 text-sp-primary'
                : 'bg-sp-surface-variant/80 text-sp-on-surface'}`}
        >
          {user.avatar ? (
             <img
               src={`/api/static/${user.avatar}`}
               alt={user.username}
               className="absolute inset-0 w-full h-full object-cover"
               style={{ opacity: hovered ? 0.8 : 1, transition: 'opacity 150ms ease-out' }}
             />
          ) : (
            initials
          )}
        </button>
      </div>
      {count > 0 && (
        <span className="absolute bottom-0 right-0 transform translate-x-1/4 translate-y-1/4 z-10 flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-full bg-red-500 border-2 border-sp-bg text-[10px] font-bold text-white shadow-sm pointer-events-none">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </div>
  )
}

interface ServerSidebarProps {
  unreadDMsCount?: number
  activeServerId: string | null
}

export function ServerSidebar({ unreadDMsCount = 0, activeServerId }: ServerSidebarProps) {
  const { user } = useAuth()
  const { serverId } = useParams<{ serverId: string }>()
  const effectiveServerId = activeServerId ?? serverId
  const location = useLocation()
  const isDMActive = location.pathname.startsWith('/channels/@me')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [name, setName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; serverId: string } | null>(null)
  const [inviteModalServerId, setInviteModalServerId] = useState<string | null>(null)
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null)

  const [dmContextMenu, setDmContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [unreadDMContextMenu, setUnreadDMContextMenu] = useState<{ x: number; y: number; conv: DMConversation } | null>(null)

  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: getMyServers })
  const { unreadServers, markAllServerRead } = useUnreadChannels()
  const { serverLevel, setServerLevel, channelLevel, setChannelLevel } = useNotificationSettings()

  const { data: conversations = [] } = useQuery({ queryKey: ['dmConversations'], queryFn: getConversations, staleTime: 30_000 })
  const dmMatch = useMatch('/channels/@me/:dmUserId')
  const activeDmUserId = dmMatch?.params.dmUserId

  const unreadDMs = conversations.filter(c => {
    // Only show unread
    if ((c.unread_count || 0) <= 0) return false
    // Don't show muted
    if (channelLevel(c.channel_id) === 'mute') return false
    // Don't show if active
    if (activeDmUserId === c.other_user.id) return false
    return true
  })

  function handleMarkServerRead(sId: string) {
    markAllServerRead(sId)
  }

  async function handleMarkAllDMsRead() {
    const convs = qc.getQueryData<{
      channel_id: string
      last_message_at: string | null
      last_read_at?: string | null
    }[]>(['dmConversations']) ?? []
    const unread = convs.filter(c => c.last_message_at && (!c.last_read_at || c.last_message_at > c.last_read_at))
    if (!unread.length) return

    await Promise.all(
      unread.map(c => markDMRead(c.channel_id, c.last_message_at ?? undefined).catch(() => null))
    )

    qc.setQueryData(['dmConversations'], (old: any[] | undefined) =>
      old?.map(c => {
        const target = unread.find(u => u.channel_id === c.channel_id)
        if (!target) return c
        return { ...c, last_read_at: target.last_message_at ?? c.last_read_at ?? new Date().toISOString() }
      })
    )
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

  const leaveMut = useMutation({
    mutationFn: (sId: string) => leaveServer(sId, user?.id ?? ''),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      setConfirmLeaveId(null)
      // If we were on that server, go home
      if (serverId === confirmLeaveId || effectiveServerId === confirmLeaveId) {
        navigate('/channels/@me')
      }
    },
  })

  return (
    <div className="flex flex-col items-center gap-2 py-3 w-[72px] overflow-y-auto scrollbar-none">
      {/* DMs — bookmark tab style */}
      <DMTab
        active={isDMActive}
        unreadCount={unreadDMsCount}
        onClick={() => navigate('/channels/@me')}
        onContextMenu={(e) => { e.preventDefault(); setDmContextMenu({ x: e.clientX, y: e.clientY }) }}
      />

      {/* Unread DMs */}
      {unreadDMs.map(c => (
        <UnreadDMItem 
          key={c.channel_id} 
          conversation={c} 
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setUnreadDMContextMenu({ x: e.clientX, y: e.clientY, conv: c })
          }}
        />
      ))}

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
            { separator: true },
            {
              label: 'Copy ID',
              icon: 'copy',
              onClick: () => navigator.clipboard.writeText(contextMenu.serverId).catch(console.error),
            },
            ...(servers.find(s => s.id === contextMenu.serverId)?.owner_id !== user?.id ? [
              {
                label: 'Leave Server',
                icon: 'log-out',
                danger: true,
                onClick: () => setConfirmLeaveId(contextMenu.serverId),
              },
            ] : []),
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
              onClick: () => { void handleMarkAllDMsRead() },
            },
          ]}
        />
      )}

      {/* Unread DM Context Menu */}
      {unreadDMContextMenu && (
        <ContextMenu
          x={unreadDMContextMenu.x}
          y={unreadDMContextMenu.y}
          onClose={() => setUnreadDMContextMenu(null)}
          items={[
            {
              label: 'Mark as Read',
              icon: 'check-circle',
              onClick: () => {
                const { conv } = unreadDMContextMenu
                markDMRead(conv.channel_id, conv.last_message_at ?? undefined).catch(console.error)
              },
            },
            { separator: true },
            {
              label: channelLevel(unreadDMContextMenu.conv.channel_id) === 'mute' ? 'Unmute' : 'Mute',
              icon: channelLevel(unreadDMContextMenu.conv.channel_id) === 'mute' ? 'bell' : 'bell-off',
              onClick: () => setChannelLevel(
                unreadDMContextMenu.conv.channel_id,
                 channelLevel(unreadDMContextMenu.conv.channel_id) === 'mute' ? 'all' : 'mute'
              ),
            },
            { separator: true },
            {
              label: 'Copy User ID',
              icon: 'copy',
              onClick: () => navigator.clipboard.writeText(unreadDMContextMenu.conv.other_user.id).catch(console.error),
            }
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

      {/* Confirm Leave Modal */}
      {confirmLeaveId && (
        <PortalModal title="Leave Server" onClose={() => setConfirmLeaveId(null)}>
          <p className="mb-4 text-sp-text/80">
            Are you sure you want to leave <span className="font-bold text-sp-text">{servers.find(s => s.id === confirmLeaveId)?.title ?? 'this server'}</span>?
            You won't be able to rejoin unless you are invited again.
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn bg-sp-input hover:bg-sp-hover text-sp-text" onClick={() => setConfirmLeaveId(null)}>
              Cancel
            </button>
            <button className="btn bg-red-500 hover:bg-red-600 text-white" onClick={() => { leaveMut.mutate(confirmLeaveId); setConfirmLeaveId(null) }}>
              Leave Server
            </button>
          </div>
        </PortalModal>
      )}

      {/* Create server modal */}
      {showCreate && (
        <PortalModal title="Create Server" onClose={() => setShowCreate(false)}>
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
        </PortalModal>
      )}

      {/* Join server modal */}
      {showJoin && (
        <PortalModal title="Join Server" onClose={() => setShowJoin(false)}>
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
        </PortalModal>
      )}
    </div>
  )
}

function Modal__old({ title, onClose, children, className = 'w-80' }: { title: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className={`bg-sp-popup border border-sp-divider/60 rounded-sp-xl p-6 ${className}`} style={{ boxShadow: 'var(--sp-shadow-3)' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  )
}
