import { useNavigate, useParams } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getServer, updateServer, deleteServer, leaveServer,
  getMembers, kickMember, getRoles, createRole, updateRole, deleteRole,
  uploadServerIcon, uploadServerBanner, assignRole, removeRole,
} from '../api/servers'
import { listInvites, revokeInvite } from '../api/invites'
import { UserAvatar } from '../components/UserAvatar'
import { Icon } from '../components/Icon'
import { useAuth } from '../contexts/AuthContext'
import type { Member, Role } from '../api/types'
import type { ServerInvite } from '../api/invites'

type Tab = 'overview' | 'members' | 'roles' | 'invites'

// ─── Nav sidebar ─────────────────────────────────────────────────────────────

const NAV: { tab: Tab; label: string; icon: string; adminOnly?: boolean }[] = [
  { tab: 'overview',  label: 'Overview',  icon: 'settings-2' },
  { tab: 'members',   label: 'Members',   icon: 'people',     adminOnly: true },
  { tab: 'roles',     label: 'Roles',     icon: 'shield',     adminOnly: true },
  { tab: 'invites',   label: 'Invites',   icon: 'link-2',     adminOnly: true },
]

// ─── Main page ────────────────────────────────────────────────────────────────

export function ServerSettingsPage() {
  const { serverId } = useParams<{ serverId: string }>()
  const navigate = useNavigate()
  const { user: currentUser } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')

  const { data: server } = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer(serverId!),
    enabled: !!serverId,
  })

  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', serverId],
    queryFn: () => getMembers(serverId!),
    enabled: !!serverId,
  })

  const isOwner = !!currentUser && server?.owner_id === currentUser.id
  const isAdmin = isOwner ||
    members.some(m => m.user.id === currentUser?.id && m.roles.some(r => r.is_admin))

  function close() {
    navigate(`/channels/${serverId}`)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [serverId])

  if (!server || !serverId) return null

  const visibleTabs = NAV.filter(n => !n.adminOnly || isAdmin)

  return (
    <div className="flex h-screen w-full bg-discord-bg text-discord-text overflow-hidden">
      {/* Left nav */}
      <div className="w-[218px] shrink-0 bg-discord-sidebar flex flex-col items-end overflow-y-auto py-4">
        <div className="w-[172px]">
          <div className="text-xs font-bold uppercase text-discord-muted tracking-wider px-2 mb-1 truncate">
            {server.title}
          </div>
          {visibleTabs.map(n => (
            <button
              key={n.tab}
              onClick={() => setTab(n.tab)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm font-medium transition-colors
                ${tab === n.tab ? 'bg-discord-input text-white' : 'text-discord-muted hover:bg-discord-input/50 hover:text-discord-text'}`}
            >
              <Icon name={n.icon} size={16} className="shrink-0" />
              {n.label}
            </button>
          ))}

          <div className="my-2 border-t border-white/5" />

          {isOwner && (
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
              onClick={async () => {
                if (!confirm(`Delete "${server.title}"? This cannot be undone.`)) return
                await deleteServer(serverId)
                qc.invalidateQueries({ queryKey: ['servers'] })
                navigate('/channels/@me')
              }}
            >
              <Icon name="trash-2" size={16} className="shrink-0" />
              Delete Server
            </button>
          )}
          {!isOwner && (
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
              onClick={async () => {
                if (!currentUser) return
                if (!confirm(`Leave "${server.title}"?`)) return
                await leaveServer(serverId, currentUser.id)
                qc.invalidateQueries({ queryKey: ['servers'] })
                navigate('/channels/@me')
              }}
            >
              <Icon name="log-out" size={16} className="shrink-0" />
              Leave Server
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 min-w-0">
        <div className="flex-1 overflow-y-auto px-10 py-8 max-w-3xl">
          {tab === 'overview'  && <OverviewTab serverId={serverId} server={server} onSaved={() => qc.invalidateQueries({ queryKey: ['server', serverId] })} />}
          {tab === 'members'   && <MembersTab  serverId={serverId} members={members} roles={[]} ownerId={server.owner_id} currentUserId={currentUser?.id ?? ''} onChanged={() => qc.invalidateQueries({ queryKey: ['members', serverId] })} />}
          {tab === 'roles'     && <RolesTab    serverId={serverId} />}
          {tab === 'invites'   && <InvitesTab  serverId={serverId} />}
        </div>

        {/* Close button */}
        <div className="px-6 py-4 flex flex-col items-center gap-2 shrink-0">
          <button
            onClick={close}
            className="w-9 h-9 rounded-full bg-discord-input hover:bg-discord-input/60 flex items-center justify-center transition-colors text-discord-muted hover:text-discord-text"
            title="Close (Esc)"
          >
            <Icon name="close" size={18} />
          </button>
          <span className="text-[10px] text-discord-muted">ESC</span>
        </div>
      </div>
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ serverId, server, onSaved }: { serverId: string; server: { title: string; description: string | null; image: string | null; banner: string | null; owner_id: string }; onSaved: () => void }) {
  const [name, setName] = useState(server.title)
  const [desc, setDesc] = useState(server.description ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const iconRef  = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)

  const isDirty = name !== server.title || desc !== (server.description ?? '')

  async function handleSave() {
    setSaving(true)
    await updateServer(serverId, { title: name.trim() || server.title, description: desc.trim() || undefined })
    onSaved()
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadServerIcon(serverId, file)
    onSaved()
  }

  async function handleBanner(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadServerBanner(serverId, file)
    onSaved()
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Server Overview</h2>

      {/* Banner */}
      <div className="bg-discord-sidebar rounded-lg overflow-hidden">
        <div
          className="h-28 relative bg-cover bg-center group cursor-pointer"
          style={{
            backgroundColor: server.banner ? undefined : '#5865F2',
            backgroundImage: server.banner ? `url(/api/static/${server.banner})` : undefined,
          }}
          onClick={() => bannerRef.current?.click()}
        >
          <div className="absolute inset-0 bg-black/20 group-hover:bg-black/50 transition-colors flex items-center justify-center">
            <span className="text-white text-sm font-semibold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
              <Icon name="image" size={16} /> Change Banner
            </span>
          </div>
          <input ref={bannerRef} type="file" className="hidden" accept="image/*" onChange={handleBanner} />
        </div>

        {/* Icon row */}
        <div className="px-4 pb-4">
          <div className="flex items-end gap-4 -mt-10">
            <div
              className="relative group rounded-2xl overflow-hidden cursor-pointer shrink-0 ring-4 ring-discord-sidebar"
              style={{ width: 80, height: 80 }}
              onClick={() => iconRef.current?.click()}
            >
              {server.image
                ? <img src={`/api/static/${server.image}`} className="w-full h-full object-cover" alt="icon" />
                : <div className="w-full h-full bg-discord-mention flex items-center justify-center text-white text-2xl font-bold">{server.title[0].toUpperCase()}</div>
              }
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <span className="text-[10px] font-bold text-white text-center leading-tight">CHANGE{'\n'}ICON</span>
              </div>
              <input ref={iconRef} type="file" className="hidden" accept="image/*" onChange={handleIcon} />
            </div>
            <div className="mb-1">
              <div className="font-bold text-lg">{server.title}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Name & Description */}
      <div className="bg-discord-sidebar rounded-lg p-4 space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase text-discord-muted mb-1.5">Server Name</label>
          <input
            className="input w-full"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={100}
          />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase text-discord-muted mb-1.5">Description</label>
          <textarea
            className="input w-full resize-none"
            rows={3}
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="What's this server about?"
          />
        </div>
      </div>

      {isDirty && (
        <div className="sticky bottom-0 flex items-center justify-between bg-discord-servers border border-white/10 rounded-lg px-4 py-3 shadow-xl">
          <span className="text-sm text-discord-muted">You have unsaved changes</span>
          <button className="btn" onClick={handleSave} disabled={saving}>
            {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Members Tab ──────────────────────────────────────────────────────────────

function MembersTab({ serverId, members, ownerId, currentUserId, onChanged }: {
  serverId: string
  members: Member[]
  roles: Role[]
  ownerId: string
  currentUserId: string
  onChanged: () => void
}) {
  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ['roles', serverId],
    queryFn: () => getRoles(serverId),
  })
  const [search, setSearch] = useState('')
  const [confirmKick, setConfirmKick] = useState<Member | null>(null)

  const filtered = members.filter(m =>
    m.user.username.toLowerCase().includes(search.toLowerCase())
  )

  async function handleKick(member: Member) {
    await kickMember(serverId, member.user.id)
    onChanged()
    setConfirmKick(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Members — {members.length}</h2>
        <input
          className="input w-48 text-sm"
          placeholder="Search members…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="bg-discord-sidebar rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/20 text-discord-muted text-xs uppercase">
              <th className="px-4 py-2.5 text-left font-bold tracking-wider">User</th>
              <th className="px-4 py-2.5 text-left font-bold tracking-wider">Roles</th>
              <th className="px-4 py-2.5 text-left font-bold tracking-wider">Joined</th>
              <th className="px-4 py-2.5 text-right font-bold tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(m => (
              <tr key={m.user.id} className="border-b border-black/10 hover:bg-discord-input/20 transition-colors">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <UserAvatar user={m.user} size={32} />
                    <div>
                      <div className="font-medium text-discord-text">{m.user.username}</div>
                      {m.user.id === ownerId && (
                        <div className="text-[10px] text-yellow-400 font-bold uppercase">Owner</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <MemberRolePicker serverId={serverId} member={m} allRoles={roles} />
                </td>
                <td className="px-4 py-2.5 text-discord-muted text-xs">
                  {new Date(m.joined_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {m.user.id !== ownerId && m.user.id !== currentUserId && (
                    <button
                      onClick={() => setConfirmKick(m)}
                      className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2 py-1 rounded transition-colors"
                    >
                      Kick
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Kick confirm */}
      {confirmKick && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-discord-sidebar rounded-lg p-6 w-80 shadow-2xl">
            <h3 className="font-bold text-lg mb-2">Kick {confirmKick.user.username}?</h3>
            <p className="text-discord-muted text-sm mb-4">They will be removed from the server but can rejoin via invite.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmKick(null)} className="px-4 py-2 rounded bg-discord-input text-sm font-semibold">Cancel</button>
              <button onClick={() => handleKick(confirmKick)} className="px-4 py-2 rounded bg-red-600 hover:bg-red-500 text-white text-sm font-semibold">Kick</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MemberRolePicker({ serverId, member, allRoles }: { serverId: string; member: Member; allRoles: Role[] }) {
  const qc = useQueryClient()
  if (allRoles.length === 0) return <span className="text-discord-muted text-xs">—</span>
  const assignedIds = new Set(member.roles.map(r => r.id))
  return (
    <div className="flex flex-wrap gap-1">
      {allRoles.map(role => {
        const assigned = assignedIds.has(role.id)
        const color = role.color ?? '#99aab5'
        return (
          <button
            key={role.id}
            className="px-2 py-0.5 rounded text-[11px] font-bold border transition-colors"
            style={assigned
              ? { backgroundColor: `${color}30`, color, borderColor: color }
              : { color: '#72767d', borderColor: '#72767d50' }
            }
            title={assigned ? `Remove role ${role.name}` : `Assign role ${role.name}`}
            onClick={async () => {
              if (assigned) {
                await removeRole(serverId, member.user.id, role.id)
              } else {
                await assignRole(serverId, member.user.id, role.id)
              }
              qc.invalidateQueries({ queryKey: ['members', serverId] })
            }}
          >
            {assigned ? '✓ ' : ''}{role.name}
          </button>
        )
      })}
    </div>
  )
}

// ─── Roles Tab ────────────────────────────────────────────────────────────────

function RolesTab({ serverId }: { serverId: string }) {
  const qc = useQueryClient()
  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ['roles', serverId],
    queryFn: () => getRoles(serverId),
  })

  const [selected, setSelected] = useState<Role | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('#99aab5')
  const [editAdmin, setEditAdmin] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  function selectRole(role: Role) {
    setSelected(role)
    setEditName(role.name)
    setEditColor(role.color ?? '#99aab5')
    setEditAdmin(role.is_admin)
  }

  async function handleSaveRole() {
    if (!selected) return
    await updateRole(serverId, selected.id, { name: editName.trim() || selected.name, color: editColor, is_admin: editAdmin })
    qc.invalidateQueries({ queryKey: ['roles', serverId] })
    setSelected(s => s ? { ...s, name: editName, color: editColor, is_admin: editAdmin } : s)
  }

  async function handleDeleteRole(role: Role) {
    if (!confirm(`Delete role "${role.name}"?`)) return
    await deleteRole(serverId, role.id)
    qc.invalidateQueries({ queryKey: ['roles', serverId] })
    if (selected?.id === role.id) setSelected(null)
  }

  async function handleCreateRole() {
    if (!newName.trim()) return
    await createRole(serverId, { name: newName.trim() })
    qc.invalidateQueries({ queryKey: ['roles', serverId] })
    setCreating(false)
    setNewName('')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Roles</h2>
        <button className="btn text-sm" onClick={() => setCreating(true)}>+ Create Role</button>
      </div>

      <div className="flex gap-4">
        {/* Role list */}
        <div className="w-48 shrink-0 space-y-1">
          {roles.map(role => (
            <div
              key={role.id}
              className={`flex items-center justify-between px-3 py-2 rounded cursor-pointer transition-colors
                ${selected?.id === role.id ? 'bg-discord-input' : 'hover:bg-discord-input/50'}`}
              onClick={() => selectRole(role)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: role.color ?? '#99aab5' }} />
                <span className="text-sm font-medium truncate">{role.name}</span>
              </div>
              {role.is_admin && <Icon name="shield" size={12} className="text-yellow-400 shrink-0" />}
            </div>
          ))}
          {roles.length === 0 && <p className="text-discord-muted text-xs px-2">No roles yet.</p>}
        </div>

        {/* Role editor */}
        {selected ? (
          <div className="flex-1 bg-discord-sidebar rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Edit Role</h3>
              <button
                onClick={() => handleDeleteRole(selected)}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
              >
                <Icon name="trash-2" size={13} /> Delete
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-discord-muted mb-1.5">Role Name</label>
              <input className="input w-full" value={editName} onChange={e => setEditName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-discord-muted mb-1.5">Color</label>
              <div className="flex items-center gap-3">
                <label className="relative w-10 h-10 rounded-lg cursor-pointer ring-2 ring-white/10 hover:ring-white/30 overflow-hidden">
                  <div className="w-full h-full" style={{ backgroundColor: editColor }} />
                  <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                </label>
                <span className="text-sm text-discord-muted font-mono">{editColor}</span>
              </div>
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div
                  onClick={() => setEditAdmin(v => !v)}
                  className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${editAdmin ? 'bg-discord-mention' : 'bg-discord-input'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${editAdmin ? 'translate-x-5' : 'translate-x-0'}`} />
                </div>
                <span className="text-sm font-medium">Administrator</span>
              </label>
              <p className="text-xs text-discord-muted mt-1 ml-12">Members with this role can manage the server.</p>
            </div>
            <button className="btn" onClick={handleSaveRole}>Save Role</button>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-discord-muted text-sm">
            Select a role to edit
          </div>
        )}
      </div>

      {/* Create role modal */}
      {creating && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-discord-sidebar rounded-lg p-6 w-72 shadow-2xl">
            <h3 className="font-bold text-lg mb-3">Create Role</h3>
            <input
              className="input w-full mb-3"
              placeholder="Role name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateRole()}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setCreating(false)} className="px-4 py-2 rounded bg-discord-input text-sm font-semibold">Cancel</button>
              <button onClick={handleCreateRole} className="btn text-sm" disabled={!newName.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Invites Tab ──────────────────────────────────────────────────────────────

function InvitesTab({ serverId }: { serverId: string }) {
  const qc = useQueryClient()
  const { data: invites = [] } = useQuery<ServerInvite[]>({
    queryKey: ['invites', serverId],
    queryFn: () => listInvites(serverId),
  })

  async function handleRevoke(code: string) {
    await revokeInvite(code)
    qc.invalidateQueries({ queryKey: ['invites', serverId] })
  }

  function formatExpiry(expires: string | null) {
    if (!expires) return 'Never'
    const d = new Date(expires)
    if (d < new Date()) return <span className="text-red-400">Expired</span>
    return d.toLocaleDateString()
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Invites</h2>

      {invites.length === 0 ? (
        <div className="text-discord-muted text-center py-10">No invites created yet.</div>
      ) : (
        <div className="bg-discord-sidebar rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/20 text-discord-muted text-xs uppercase">
                <th className="px-4 py-2.5 text-left font-bold tracking-wider">Code</th>
                <th className="px-4 py-2.5 text-left font-bold tracking-wider">Uses</th>
                <th className="px-4 py-2.5 text-left font-bold tracking-wider">Expires</th>
                <th className="px-4 py-2.5 text-left font-bold tracking-wider">Created</th>
                <th className="px-4 py-2.5 text-right font-bold tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invites.map(inv => (
                <tr key={inv.code} className="border-b border-black/10 hover:bg-discord-input/20 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs text-discord-text">
                    <div className="flex items-center gap-2">
                      <span>{inv.code}</span>
                      <button
                        className="text-discord-muted hover:text-discord-text transition-colors"
                        title="Copy link"
                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}/invite/${inv.code}`)}
                      >
                        <Icon name="copy" size={12} />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-discord-muted">
                    {inv.uses}{inv.max_uses ? ` / ${inv.max_uses}` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-discord-muted text-xs">{formatExpiry(inv.expires_at)}</td>
                  <td className="px-4 py-2.5 text-discord-muted text-xs">{new Date(inv.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => handleRevoke(inv.code)}
                      className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2 py-1 rounded transition-colors"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
