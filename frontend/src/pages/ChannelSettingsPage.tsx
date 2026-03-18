import { useNavigate, useParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getChannels, updateChannel, deleteChannel, getPermissions, setPermission } from '../api/channels'
import { getRoles } from '../api/servers'
import { getPermState, cyclePermState, applyPermState, type PermState } from '../utils/permissions'
import { SettingsLayout, type SettingsTab } from '../components/SettingsLayout'
import { Icon } from '../components/Icon'
import { useAuth } from '../contexts/AuthContext'
import { ChannelPerm, type Channel, type ChannelPermission } from '../api/types'

type Tab = 'overview' | 'permissions'

const TABS: SettingsTab[] = [
  { id: 'overview',    label: 'Overview',    icon: 'settings-2' },
  { id: 'permissions', label: 'Permissions', icon: 'shield' },
]

export function ChannelSettingsPage() {
  const { serverId, channelId } = useParams<{ serverId: string; channelId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<string>('overview')

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['channels', serverId],
    queryFn: () => getChannels(serverId!),
    enabled: !!serverId,
  })

  const channel = channels.find(c => c.id === channelId)

  if (!channel || !serverId) return null

  return (
    <SettingsLayout
      title={channel.title}
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      onClose={() => navigate(`/channels/${serverId}/${channelId}`)}
      sidebarFooter={
        <button
          className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
          onClick={async () => {
              if (!confirm(`Are you sure you want to delete #${channel.title}? This cannot be undone.`)) return
              await deleteChannel(serverId, channel.id)
              qc.invalidateQueries({ queryKey: ['channels', serverId] })
              navigate(`/channels/${serverId}`)
          }}
        >
          <Icon name="trash-2" size={16} className="shrink-0" />
          Delete Channel
        </button>
      }
    >
      {tab === 'overview' && (
        <OverviewTab serverId={serverId} channel={channel} />
      )}

      {tab === 'permissions' && (
        <PermissionsTab serverId={serverId} channel={channel} />
      )}
    </SettingsLayout>
  )
}


function OverviewTab({ serverId, channel }: { serverId: string; channel: Channel }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(channel.title)
  const [topic, setTopic] = useState(channel.description ?? '')
  const [slowmode, setSlowmode] = useState(channel.slowmode_delay ?? 0)
  const [nsfw, setNsfw] = useState(channel.nsfw ?? false)
  const [userLimit, setUserLimit] = useState(channel.user_limit ?? 0)
  const [bitrate, setBitrate] = useState(channel.bitrate ?? 64000)
  const [saving, setSaving] = useState(false)
  
  // Sync when channel prop updates
  useEffect(() => {
    setTitle(channel.title)
    setTopic(channel.description ?? '')
    setSlowmode(channel.slowmode_delay ?? 0)
    setNsfw(channel.nsfw ?? false)
    setUserLimit(channel.user_limit ?? 0)
    setBitrate(channel.bitrate ?? 64000)
  }, [channel])

  const hasChanges = 
    title !== channel.title ||
    topic !== (channel.description ?? '') ||
    slowmode !== (channel.slowmode_delay ?? 0) ||
    nsfw !== (channel.nsfw ?? false) ||
    (channel.type === 'voice' && userLimit !== (channel.user_limit ?? 0)) ||
    (channel.type === 'voice' && bitrate !== (channel.bitrate ?? 64000))

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true)
    try {
      await updateChannel(serverId, channel.id, {
        title,
        description: topic || null,
        slowmode_delay: slowmode,
        nsfw,
        user_limit: channel.type === 'voice' ? (userLimit || null) : undefined,
        bitrate: channel.type === 'voice' ? (bitrate || null) : undefined,
      })
      qc.invalidateQueries({ queryKey: ['channels', serverId] })
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    setTitle(channel.title)
    setTopic(channel.description ?? '')
    setSlowmode(channel.slowmode_delay ?? 0)
    setNsfw(channel.nsfw ?? false)
    setUserLimit(channel.user_limit ?? 0)
    setBitrate(channel.bitrate ?? 64000)
  }

  return (
    <div className="space-y-6 flex-1 flex flex-col">
      <div className="grid grid-cols-2 gap-6">
        <div className="col-span-2">
          <label className="text-xs font-bold text-sp-muted uppercase mb-2 block">Channel Name</label>
          <input
            className="input w-full"
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={100}
          />
        </div>
        
        <div className="col-span-2">
          <label className="text-xs font-bold text-sp-muted uppercase mb-2 block">Channel Topic</label>
          <textarea
            className="input w-full h-24 resize-none py-2"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="Let everyone know how to use this channel!"
            maxLength={1024}
          />
        </div>

        {channel.type === 'text' && (
          <div className="col-span-2">
            <label className="text-xs font-bold text-sp-muted uppercase mb-2 block">Slowmode</label>
            <div className="flex items-center gap-4">
               <input
                 type="range"
                 min="0"
                 max="21600"
                 step="5"
                 value={slowmode}
                 onChange={e => setSlowmode(Number(e.target.value))}
                 className="flex-1"
               />
               <span className="w-20 text-right text-sm font-mono text-sp-text">
                 {slowmode === 0 ? 'Off' : `${slowmode}s`}
               </span>
            </div>
            <p className="text-xs text-sp-muted mt-1">
              Members will be restricted to sending one message per this interval, unless they have Manage Channel or Manage Messages permissions.
            </p>
          </div>
        )}

        {channel.type === 'voice' && (
          <>
            <div className="col-span-2">
              <label className="text-xs font-bold text-sp-muted uppercase mb-2 block">Bitrate</label>
              <div className="flex items-center gap-4">
                 <input
                   type="range"
                   min="8000"
                   max="96000"
                   step="1000"
                   value={bitrate}
                   onChange={e => setBitrate(Number(e.target.value))}
                   className="flex-1"
                 />
                 <span className="w-20 text-right text-sm font-mono text-sp-text">
                   {Math.round(bitrate / 1000)}kbps
                 </span>
              </div>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-bold text-sp-muted uppercase mb-2 block">User Limit</label>
              <div className="flex items-center gap-4">
                 <input
                   type="range"
                   min="0"
                   max="99"
                   step="1"
                   value={userLimit}
                   onChange={e => setUserLimit(Number(e.target.value))}
                   className="flex-1"
                 />
                 <span className="w-20 text-right text-sm font-mono text-sp-text">
                   {userLimit === 0 ? 'No Limit' : `${userLimit} users`}
                 </span>
              </div>
              <p className="text-xs text-sp-muted mt-1">
                Limit the number of users that can connect to this voice channel. Users with the Move Members permission ignore this limit.
              </p>
            </div>
          </>
        )}

        <div className="col-span-2 flex items-center justify-between p-4 bg-sp-surface rounded border border-sp-divider/40">
           <div>
             <div className="font-medium text-sp-text">NSFW Channel</div>
             <div className="text-xs text-sp-muted">Users will need to confirm they contain 18+ content to view this channel.</div>
           </div>
           <input
             type="checkbox"
             className="toggle"
             checked={nsfw}
             onChange={e => setNsfw(e.target.checked)}
           />
        </div>
      </div>

      {/* Floating Save Bar */}
      {hasChanges && (
         <div className="sticky bottom-0 mt-auto pt-6 pb-2 bg-gradient-to-t from-sp-bg via-sp-bg to-transparent">
           <div className="bg-sp-surface-variant p-3 rounded flex items-center justify-between shadow-lg border border-sp-divider/20 animate-in fade-in slide-in-from-bottom-2">
             <span className="text-sm font-medium px-2">Careful — you have unsaved changes!</span>
             <div className="flex items-center gap-3">
               <button onClick={handleReset} className="text-sm font-medium hover:underline px-2">Reset</button>
               <button onClick={handleSave} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white px-5 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50">
                 {saving ? 'Saving...' : 'Save Changes'}
               </button>
             </div>
           </div>
         </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------
// Permissions Logic
// ---------------------------------------------------------------------------------------

const PERM_COLUMNS: { key: keyof typeof ChannelPerm; label: string }[] = [
  { key: 'VIEW_CHANNEL',     label: 'View Channel' },
  { key: 'SEND_MESSAGES',    label: 'Send Msgs' },
  { key: 'MANAGE_MESSAGES',  label: 'Manage Msgs' },
  { key: 'ATTACH_FILES',     label: 'Attach Files' },
  { key: 'ADD_REACTIONS',    label: 'Add Reactions' },
  { key: 'MENTION_EVERYONE', label: 'All / Here' },
]

function PermissionsTab({ serverId, channel }: { serverId: string; channel: Channel }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Record<string, { allow_bits: number; deny_bits: number }> | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const { data: roles = [] } = useQuery({
    queryKey: ['roles', serverId],
    queryFn: () => getRoles(serverId),
  })

  // We need to fetch channel-specific overrides
  const { data: existingPerms = [], isSuccess: permsLoaded } = useQuery<ChannelPermission[]>({
    queryKey: ['channelPerms', channel.id],
    queryFn: () => getPermissions(serverId, channel.id),
  })

  // Initialize draft
  useEffect(() => {
    if (!permsLoaded || roles.length === 0) return
    const init: Record<string, { allow_bits: number; deny_bits: number }> = {}
    // Fill with empty perms for all roles (inherit)
    roles.forEach(r => init[r.id] = { allow_bits: 0, deny_bits: 0 })
    // Override with existing
    existingPerms.forEach(p => {
      init[p.role_id] = { allow_bits: p.allow_bits, deny_bits: p.deny_bits }
    })
    setDraft(init)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoaded, channel.id, roles.length]) 

  function toggle(roleId: string, bit: number) {
    setDraft(prev => {
      if (!prev) return prev
      const cur = prev[roleId] ?? { allow_bits: 0, deny_bits: 0 }
      const current = getPermState(cur.allow_bits, cur.deny_bits, bit)
      const next = cyclePermState(current)
      return {
        ...prev,
        [roleId]: applyPermState(cur.allow_bits, cur.deny_bits, bit, next),
      }
    })
  }

  async function handleSave() {
    if (!draft) return
    setSaving(true)
    try {
      await Promise.all(
        Object.entries(draft).map(([roleId, bits]) =>
          setPermission(serverId, channel.id, roleId, bits)
        )
      )
      qc.invalidateQueries({ queryKey: ['channelPerms', channel.id] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  if (!permsLoaded || !draft) {
    return (
      <div className="flex items-center justify-center p-12">
        <span className="text-sp-muted animate-pulse">Loading permissions...</span>
      </div>
    )
  }

  return (
    <div>
      <div className="bg-sp-surface-variant/30 text-sm text-sp-muted p-4 rounded mb-6 border border-sp-divider/20">
        <div className="flex flex-col gap-2">
           <p>Permissions here override the server-wide role settings for this specific channel.</p>
           <div className="flex gap-4 text-xs font-semibold uppercase tracking-wide opacity-80">
             <span className="flex items-center gap-1.5 text-green-400"><Icon name="checkmark" size={14}/> Allow</span>
             <span className="flex items-center gap-1.5 text-red-400"><Icon name="close" size={14}/> Deny</span>
             <span className="flex items-center gap-1.5 text-sp-muted"><span className="w-3.5 h-3.5 flex items-center justify-center text-lg leading-none">/</span> Inherit (Default)</span>
           </div>
        </div>
      </div>

      <div className="overflow-x-auto border border-sp-divider/30 rounded-lg bg-sp-surface">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-sp-input/40 border-b border-sp-divider/20">
              <th className="px-4 py-3 text-left text-xs font-bold uppercase text-sp-muted tracking-wide w-48 sticky left-0 bg-inherit z-10">Role</th>
              {PERM_COLUMNS.map(col => (
                <th key={col.key} className="px-2 py-3 text-center text-xs font-bold uppercase text-sp-muted tracking-wide min-w-[80px]">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map((role, i) => {
              const bits = draft[role.id] ?? { allow_bits: 0, deny_bits: 0 }
              return (
                <tr key={role.id} className={`transition-colors hover:bg-white/5 ${i % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'}`}>
                  <td className="px-4 py-3 font-medium flex items-center gap-2 sticky left-0 bg-inherit z-10 backdrop-blur-md">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: role.color || '#999' }} />
                    <span className={role.is_admin ? 'text-sp-primary font-bold' : 'text-sp-text'}>{role.name}</span>
                    {role.is_admin && <Icon name="shield" size={12} className="text-sp-primary" />}
                  </td>
                  {PERM_COLUMNS.map(col => {
                    const bit = ChannelPerm[col.key]
                    const state = getPermState(bits.allow_bits, bits.deny_bits, bit)
                    return (
                      <td key={col.key} className="px-2 py-3 text-center">
                        <button
                          onClick={() => toggle(role.id, bit)}
                          className={`w-8 h-8 rounded inline-flex items-center justify-center transition-all duration-200
                            ${state === 'allow' ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30 ring-1 ring-inset ring-green-500/30'
                              : state === 'deny' ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 ring-1 ring-inset ring-red-500/30'
                              : 'bg-sp-dummy/20 text-sp-muted hover:bg-sp-dummy/40 hover:text-sp-text'}`}
                        >
                          {state === 'allow' ? <Icon name="checkmark" size={16} /> : state === 'deny' ? <Icon name="close" size={16} /> : <span className="text-lg leading-none opacity-50">/</span>}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {(saved || draft) && (
      <div className="mt-6 flex justify-end gap-3 sticky bottom-6 bg-sp-surface p-4 border border-sp-divider/20 rounded shadow-2xl z-20">
         {saved && <span className="flex items-center text-green-400 text-sm font-medium mr-auto animate-in fade-in slide-in-from-left-2 transition-opacity duration-1000"><Icon name="checkmark" size={16} className="mr-1.5"/> Permissions Saved!</span>}
         <button
           onClick={handleSave}
           disabled={saving}
           className="bg-sp-primary hover:bg-sp-primary/90 text-white font-semibold px-6 py-2 rounded shadow-sm disabled:opacity-50 transition-all active:scale-95"
         >
           {saving ? 'Saving...' : 'Save Permissions'}
         </button>
      </div>
      )}
      <div className="h-10"/> {/* Spacer */}
    </div>
  )
}