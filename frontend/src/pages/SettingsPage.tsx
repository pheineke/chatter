import { useNavigate } from 'react-router-dom'
import { useRef, useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Icon } from '../components/Icon'
import { UserAvatar } from '../components/UserAvatar'
import { updateMe, uploadAvatar, uploadBanner, changePassword } from '../api/users'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { User, UserStatus, DMPermission } from '../api/types'
import { COLOR_SWATCHES, loadColorOverrides, applyColorOverrides } from '../utils/colorOverrides'
import { useSoundManager } from '../hooks/useSoundManager'
import { useBlocks } from '../hooks/useBlocks'
import { useDesktopNotificationsContext } from '../contexts/DesktopNotificationsContext'
import { getSessions, revokeSession, revokeAllOtherSessions, type Session } from '../api/sessions'
import { getTokens, createToken, revokeToken, type ApiToken, type ApiTokenCreated } from '../api/tokens'
import { AVATAR_FRAMES } from '../utils/avatarFrames'
import { getMyDecorations, redeemDecorationCode } from '../api/decorations'
import { useE2EE } from '../contexts/E2EEContext'
import { QRScanner } from '../components/QRScanner'
import { clearDMCache } from '../db/dmCache'
import { SettingsLayout, type SettingsGroup } from '../components/SettingsLayout'

type Tab = 'account' | 'appearance' | 'voice' | 'privacy' | 'notifications' | 'tokens'

// ─── Sidebar nav ─────────────────────────────────────────────────────────────

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: 'user',
    label: 'User Settings',
    items: [
      { id: 'account', label: 'My Account', icon: 'person' },
      { id: 'privacy', label: 'Privacy & Safety', icon: 'lock-closed' },
      { id: 'tokens', label: 'API Tokens', icon: 'key' },
    ],
  },
  {
    id: 'app',
    label: 'App Settings',
    items: [
      { id: 'appearance', label: 'Appearance', icon: 'color-palette' },
      { id: 'voice', label: 'Voice & Video', icon: 'mic' },
      { id: 'notifications', label: 'Notifications', icon: 'notifications' },
    ],
  },
]

export function SettingsPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('account')
  const { logout } = useAuth()

  return (
    <SettingsLayout
      groups={SETTINGS_GROUPS}
      activeTab={tab}
      onTabChange={setTab}
      onClose={() => navigate(-1)}
      sidebarFooter={(
        <button
          className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
          onClick={() => {
            if (confirm('Are you sure you want to log out?')) {
              logout()
              navigate('/login')
            }
          }}
        >
          <Icon name="log-out" size={16} className="shrink-0" />
          Log Out
        </button>
      )}
    >
      {tab === 'account' && <AccountTab />}
      {tab === 'privacy' && <PrivacyTab />}
      {tab === 'tokens' && <TokensTab />}
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'voice' && <VoiceTab />}
      {tab === 'notifications' && <NotificationsTab />}
    </SettingsLayout>
  )
}

// ─── My Account tab ───────────────────────────────────────────────────────────

function AccountTab() {
  const { user, refreshUser } = useAuth()
  const qc = useQueryClient()
  const avatarInput = useRef<HTMLInputElement>(null)
  const bannerInput = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  // Change-password form state
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)

  const updateMut = useMutation({
    mutationFn: (patch: any) => updateMe(patch),
    onSuccess: async () => {
      await refreshUser()
      qc.invalidateQueries({ queryKey: ['me'] })
      setEditing(null)
      setIsSubmitting(false)
      setProfileError(null)
    },
    onError: (err: any) => {
      setIsSubmitting(false)
      const detail = err?.response?.data?.detail
      setProfileError(typeof detail === 'string' ? detail : 'Failed to save changes')
    },
  })

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'banner') {
    if (!e.target.files?.[0]) return
    setIsSubmitting(true)
    setProfileError(null)
    try {
      if (type === 'avatar') await uploadAvatar(e.target.files[0])
      else await uploadBanner(e.target.files[0])
      await refreshUser()
      qc.invalidateQueries({ queryKey: ['me'] })
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      setProfileError(typeof detail === 'string' ? detail : 'Upload failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  function startEdit(field: string, value: string | null) {
    setEditing(field)
    setEditValue(value ?? '')
  }

  async function saveEdit() {
    setIsSubmitting(true)
    if (editing) updateMut.mutate({ [editing]: editValue })
  }

  async function handleChangePassword() {
    setPwError(null)
    setPwSuccess(false)
    if (!pwCurrent) { setPwError('Please enter your current password'); return }
    if (pwNew.length < 8) { setPwError('New password must be at least 8 characters'); return }
    if (pwNew !== pwConfirm) { setPwError('New passwords do not match'); return }
    setPwLoading(true)
    try {
      await changePassword(pwCurrent, pwNew)
      setPwCurrent(''); setPwNew(''); setPwConfirm('')
      setPwSuccess(true)
      setTimeout(() => setPwSuccess(false), 4000)
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      setPwError(typeof detail === 'string' ? detail : 'Failed to update password')
    } finally {
      setPwLoading(false)
    }
  }

  const statusColors: Record<string, string> = {
    online: 'bg-sp-online',
    away: 'bg-sp-idle',
    dnd: 'bg-sp-dnd',
    offline: 'bg-sp-offline',
  }
  const statusLabels: Record<string, string> = {
    online: 'Online', away: 'Away', dnd: 'Do Not Disturb', offline: 'Offline',
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">My Account</h2>

      {/* Profile preview */}
      <div className="bg-sp-sidebar rounded-lg mb-6">
        {/* Banner */}
        <div
          className="h-24 rounded-t-lg relative bg-cover bg-center group cursor-pointer"
          style={{
            backgroundColor: user?.banner ? undefined : '#3F51B5',
            backgroundImage: user?.banner ? `url(/api/static/${user.banner})` : undefined,
          }}
          onClick={() => bannerInput.current?.click()}
        >
          <div className="absolute inset-0 rounded-t-lg bg-black/20 group-hover:bg-black/50 transition-colors flex items-center justify-center">
            <span className="text-white text-sm font-semibold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
              <Icon name="image" size={16} /> Change Banner
            </span>
          </div>
          <input ref={bannerInput} type="file" className="hidden" accept="image/*" onChange={e => handleFile(e, 'banner')} />
        </div>
        {/* Avatar row — negative margin pulls it up over the banner */}
        <div className="px-4 pb-4">
          <div className="flex items-end gap-4 -mt-9">
            <div className="rounded-full p-1.5 bg-sp-sidebar shrink-0">
              <div className="relative group rounded-full">
                <UserAvatar user={user} size={72} className="rounded-full" />
                <div
                  className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity"
                  onClick={() => avatarInput.current?.click()}
                >
                  <span className="text-[10px] font-bold text-white text-center leading-tight">CHANGE{'\n'}AVATAR</span>
                </div>
                <input ref={avatarInput} type="file" className="hidden" accept="image/*" onChange={e => handleFile(e, 'avatar')} />
                <div className={`absolute bottom-1 right-1 w-5 h-5 rounded-full border-[3px] border-sp-sidebar ${statusColors[user?.status ?? 'offline']}`} />
              </div>
            </div>
            {/* Name sits at the bottom of the avatar row */}
            <div className="pb-1">
              <p className="font-bold text-lg leading-tight">{user?.username}</p>
              {user?.pronouns && <p className="text-sp-muted text-sm">{user.pronouns}</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Status selector */}
      <div className="bg-sp-sidebar rounded-lg p-4 mb-6">
        <div className="text-xs font-bold text-sp-muted uppercase mb-3">Online Status</div>
        <div className="grid grid-cols-2 gap-2">
          {(['online', 'away', 'dnd', 'offline'] as const).map(s => (
            <button
              key={s}
              onClick={() => updateMut.mutate({ status: s as UserStatus })}
              className={`py-2 px-3 rounded text-sm font-medium flex items-center gap-2 transition-colors
                ${user?.status === s
                  ? 'bg-sp-mention/20 text-sp-mention ring-1 ring-sp-mention/50'
                  : 'bg-sp-bg hover:bg-sp-input text-sp-text'}`}
            >
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusColors[s]}`} />
              {statusLabels[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Avatar Decoration */}
      <AvatarDecorationSection user={user} updateMut={updateMut} />

      {/* Editable fields */}
      <div className="bg-sp-sidebar rounded-lg p-4 space-y-2 divide-y divide-sp-input">
        <div className="text-xs font-bold text-sp-muted uppercase pb-2">Account Information</div>
        <EditableField label="Username" value={user?.username} readOnly />
        <div className="pt-2">
          <EditableField
            label="Pronouns" value={user?.pronouns} placeholder="e.g. he/him"
            isEditing={editing === 'pronouns'} editValue={editValue} setEditValue={setEditValue}
            onEdit={() => startEdit('pronouns', user?.pronouns ?? null)}
            onSave={saveEdit} onCancel={() => setEditing(null)} disabled={isSubmitting}
          />
        </div>
        <div className="pt-2">
          <EditableField
            label="About Me" value={user?.description} placeholder="Tell the world about yourself…" multiline
            isEditing={editing === 'description'} editValue={editValue} setEditValue={setEditValue}
            onEdit={() => startEdit('description', user?.description ?? null)}
            onSave={saveEdit} onCancel={() => setEditing(null)} disabled={isSubmitting}
          />
        </div>
      </div>

      {/* Profile error banner */}
      {profileError && (
        <div className="mt-4 px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {profileError}
        </div>
      )}

      {/* Change Password */}
      <div className="bg-sp-sidebar rounded-lg p-4 mt-6">
        <div className="text-xs font-bold text-sp-muted uppercase mb-4">Change Password</div>
        <div className="space-y-2">
          <input
            type="password" className="input w-full" placeholder="Current password"
            value={pwCurrent} onChange={e => setPwCurrent(e.target.value)}
          />
          <input
            type="password" className="input w-full" placeholder="New password (min. 8 characters)"
            value={pwNew} onChange={e => setPwNew(e.target.value)}
          />
          <input
            type="password" className="input w-full" placeholder="Confirm new password"
            value={pwConfirm} onChange={e => setPwConfirm(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleChangePassword() }}
          />
          {pwError && <p className="text-red-400 text-sm">{pwError}</p>}
          {pwSuccess && <p className="text-green-400 text-sm">Password updated successfully!</p>}
          <div className="flex justify-end pt-1">
            <button onClick={handleChangePassword} disabled={pwLoading} className="btn py-1.5">
              {pwLoading ? 'Saving…' : 'Update Password'}
            </button>
          </div>
        </div>
      </div>

      {/* Active sessions */}
      <SessionsSection />
    </div>
  )
}

// ─── Avatar Decoration section (used inside AccountTab) ────────────────────

function AvatarDecorationSection({ user, updateMut }: { user: User | null; updateMut: ReturnType<typeof useMutation<any, any, any>> }) {
  const qc = useQueryClient()
  const [redeemCode, setRedeemCode] = useState('')
  const [redeemError, setRedeemError] = useState<string | null>(null)
  const [redeemSuccess, setRedeemSuccess] = useState<string | null>(null)

  const { data: owned = [] } = useQuery({
    queryKey: ['myDecorations'],
    queryFn: getMyDecorations,
  })

  const ownedFrameIds = new Set(owned.map(o => o.frame_id))
  const unlockedFrames = AVATAR_FRAMES.filter(f => ownedFrameIds.has(f.id))

  const redeemMut = useMutation({
    mutationFn: (code: string) => redeemDecorationCode(code),
    onSuccess: (entry) => {
      const frame = AVATAR_FRAMES.find(f => f.id === entry.frame_id)
      setRedeemSuccess(`Unlocked: ${frame?.label ?? entry.frame_id}!`)
      setRedeemError(null)
      setRedeemCode('')
      qc.invalidateQueries({ queryKey: ['myDecorations'] })
      setTimeout(() => setRedeemSuccess(null), 4000)
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      setRedeemError(typeof detail === 'string' ? detail : 'Failed to redeem code')
      setRedeemSuccess(null)
    },
  })

  function handleRedeem() {
    if (!redeemCode.trim()) return
    redeemMut.mutate(redeemCode.trim())
  }

  return (
    <div className="bg-sp-sidebar rounded-lg p-4 mb-6">
      <div className="text-xs font-bold text-sp-muted uppercase mb-3">Avatar Decoration</div>

      {/* Frame selector — only unlocked frames */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        {/* "None" option */}
        <button
          onClick={() => updateMut.mutate({ avatar_decoration: '' } as any)}
          className={`w-16 h-16 rounded-lg flex items-center justify-center border-2 transition-colors ${
            !user?.avatar_decoration
              ? 'border-sp-mention bg-sp-mention/10'
              : 'border-sp-input bg-sp-bg hover:border-sp-muted'
          }`}
          title="None"
        >
          <Icon name="close" size={20} className="text-sp-muted" />
        </button>
        {unlockedFrames.map(frame => {
          const active = user?.avatar_decoration === frame.id
          return (
            <button
              key={frame.id}
              onClick={() => updateMut.mutate({ avatar_decoration: frame.id } as any)}
              className={`relative w-16 h-16 rounded-lg flex items-center justify-center border-2 transition-colors ${
                active
                  ? 'border-sp-mention bg-sp-mention/10'
                  : 'border-sp-input bg-sp-bg hover:border-sp-muted'
              }`}
              title={frame.label}
            >
              <div className="relative w-10 h-10">
                <UserAvatar user={user} size={28} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" hideDecoration />
                <img src={frame.src} alt={frame.label} className="absolute inset-0 w-full h-full pointer-events-none" />
              </div>
            </button>
          )
        })}
        {unlockedFrames.length === 0 && (
          <span className="text-xs text-sp-muted italic">No decorations unlocked yet</span>
        )}
      </div>

      {/* Redeem code input */}
      <div className="flex items-center gap-2">
        <input
          className="input flex-1"
          placeholder="Enter decoration code…"
          value={redeemCode}
          onChange={e => setRedeemCode(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleRedeem() }}
        />
        <button
          onClick={handleRedeem}
          disabled={redeemMut.isPending || !redeemCode.trim()}
          className="btn py-1.5 px-4"
        >
          {redeemMut.isPending ? 'Redeeming…' : 'Redeem'}
        </button>
      </div>
      {redeemError && <p className="text-red-400 text-sm mt-2">{redeemError}</p>}
      {redeemSuccess && <p className="text-green-400 text-sm mt-2">{redeemSuccess}</p>}
    </div>
  )
}

// ─── Sessions section (used inside AccountTab) ─────────────────────────────

function SessionsSection() {
  const qc = useQueryClient()

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: getSessions,
    staleTime: 30_000,
  })

  const revokeMut = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  })

  const revokeAllMut = useMutation({
    mutationFn: revokeAllOtherSessions,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  })

  function formatUA(ua: string | null): string {
    if (!ua) return 'Unknown device'
    // Extract a readable browser / OS summary from the UA string
    const browser =
      ua.includes('Firefox') ? 'Firefox' :
      ua.includes('Edg/') ? 'Edge' :
      ua.includes('Chrome') ? 'Chrome' :
      ua.includes('Safari') ? 'Safari' :
      ua.includes('curl') ? 'curl' :
      'Unknown browser'
    const os =
      ua.includes('Windows') ? 'Windows' :
      ua.includes('Mac') ? 'macOS' :
      ua.includes('Linux') ? 'Linux' :
      ua.includes('Android') ? 'Android' :
      ua.includes('iPhone') || ua.includes('iPad') ? 'iOS' :
      'Unknown OS'
    return `${browser} on ${os}`
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' at ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="bg-sp-sidebar rounded-lg p-4 mt-6">
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs font-bold text-sp-muted uppercase">Active Sessions</div>
        {sessions.length > 1 && (
          <button
            onClick={() => revokeAllMut.mutate()}
            disabled={revokeAllMut.isPending}
            className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
          >
            {revokeAllMut.isPending ? 'Logging out…' : 'Log out all other sessions'}
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-sp-muted">Loading sessions…</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-sp-muted">No active sessions found.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s: Session) => {
            const isCurrent = s.is_current
            return (
              <div
                key={s.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-sp-bg"
              >
                <Icon name="monitor" size={20} className="shrink-0 text-sp-muted" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{formatUA(s.user_agent)}</span>
                    {isCurrent && (
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 shrink-0">
                        This device
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-sp-muted">
                    Last active: {formatDate(s.last_used_at)}
                  </div>
                </div>
                {!isCurrent && (
                  <button
                    onClick={() => revokeMut.mutate(s.id)}
                    disabled={revokeMut.isPending}
                    className="shrink-0 text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 px-2 py-1 rounded hover:bg-red-500/10"
                    title="Revoke this session"
                  >
                    Revoke
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Appearance tab ──────────────────────────────────────────────────────────

const PRESETS: { id: string; label: string; accent: string; bg: string; sidebar: string; servers: string; input: string; text: string; muted: string }[] = [
  { id: 'default', label: 'Default Dark', accent: '#a78bfa', bg: '#1c1c22', sidebar: '#141418', servers: '#0e0e12', input: '#28282f', text: '#e4e3eb', muted: '#7e7d91' },
  { id: 'softpop', label: 'Soft Pop',     accent: '#7C4DFF', bg: '#fbf8fb', sidebar: '#f0eef4', servers: '#e6e3ec', input: '#e1dce8', text: '#211e26', muted: '#7a7682' },
  { id: 'swiss',   label: 'Swiss Intl.',  accent: '#FF3B00', bg: '#FFFFFF', sidebar: '#f0f0f0', servers: '#e0e0e0', input: '#f7f7f7', text: '#000000', muted: '#666666' },
  { id: 'android', label: 'Material 5',   accent: '#006A60', bg: '#FAFDFB', sidebar: '#EAEFEA', servers: '#DBE5E0', input: '#F0F5F1', text: '#191C1B', muted: '#707975' },
  { id: 'midnight',label: 'Midnight',     accent: '#9b59b6', bg: '#120518', sidebar: '#1a0b24', servers: '#100517', input: '#2a1538', text: '#f0e6f5', muted: '#8d789e' },
]


function AppearanceTab() {
  const { user, refreshUser } = useAuth()
  const qc = useQueryClient()

  const initSaved   = loadColorOverrides
  const initPreset  = () => localStorage.getItem('appPreset') ?? 'softpop'

  const [saved,        setSaved]        = useState<Record<string, string>>(initSaved)
  const [savedPreset,  setSavedPreset]  = useState<string>(initPreset)
  const [pending,      setPending]      = useState<Record<string, string>>(initSaved)
  const [pendingPreset,setPendingPreset]= useState<string>(initPreset)
  const [customCss, setCustomCss] = useState(() => localStorage.getItem('customCss') ?? '')
  const [cssApplied, setCssApplied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const isDirty = JSON.stringify(pending) !== JSON.stringify(saved) || pendingPreset !== savedPreset

  const updateMut = useMutation({
    mutationFn: (patch: any) => updateMe(patch),
    onSuccess: async () => {
      await refreshUser()
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })

  useEffect(() => {
    applyColorOverrides(loadColorOverrides())
    const stored = localStorage.getItem('customCss')
    if (stored) applyStyleTag(stored)
  }, [])

  function handlePreset(preset: typeof PRESETS[0]) {
    setPendingPreset(preset.id)
    setPending({ ...pending, accent: preset.accent, bg: preset.bg, sidebar: preset.sidebar, servers: preset.servers, input: preset.input, text: preset.text, muted: preset.muted })
  }

  function handleColorChange(key: string, value: string) {
    setPendingPreset('custom')
    setPending({ ...pending, [key]: value })
  }

  function handleSave() {
    setSaved(pending)
    setSavedPreset(pendingPreset)
    localStorage.setItem('colorOverrides', JSON.stringify(pending))
    localStorage.setItem('appPreset', pendingPreset)
    applyColorOverrides(pending)
    updateMut.mutate({ theme_preset: pendingPreset, theme_colors: JSON.stringify(pending) })
  }

  function handleDiscard() {
    setPending(saved)
    setPendingPreset(savedPreset)
  }

  function resetColors() {
    setSaved({})
    setSavedPreset('softpop')
    setPending({})
    setPendingPreset('softpop')
    localStorage.removeItem('colorOverrides')
    localStorage.setItem('appPreset', 'softpop')
    applyColorOverrides({})
    updateMut.mutate({ theme_preset: 'softpop', theme_colors: null })
  }

  function applyStyleTag(css: string) {
    let tag = document.getElementById('custom-css') as HTMLStyleElement | null
    if (!tag) { tag = document.createElement('style'); tag.id = 'custom-css'; document.head.appendChild(tag) }
    tag.textContent = css
  }

  function applyCSS() {
    applyStyleTag(customCss)
    localStorage.setItem('customCss', customCss)
    setCssApplied(true)
    setTimeout(() => setCssApplied(false), 1800)
  }

  function resetCSS() {
    const tag = document.getElementById('custom-css')
    if (tag) tag.textContent = ''
    localStorage.removeItem('customCss')
    setCustomCss('')
  }

  function loadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setCustomCss(ev.target?.result as string ?? '')
    reader.readAsText(file)
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Appearance</h2>

      {/* Preset themes */}
      <div className="bg-sp-sidebar rounded-xl p-6 shadow-sm">
        <h3 className="text-sm font-bold text-sp-muted uppercase tracking-wider mb-4">Preset Themes</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {PRESETS.map(preset => (
            <button
              key={preset.id}
              onClick={() => handlePreset(preset)}
              className={`group flex flex-col gap-3 p-3 rounded-2xl border-2 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg
                ${pendingPreset === preset.id 
                  ? 'border-sp-mention bg-sp-bg shadow-md' 
                  : 'border-transparent bg-sp-input hover:bg-sp-hover'}`}
            >
              {/* Theme Preview Card */}
              <div 
                className="w-full h-24 rounded-xl flex overflow-hidden shadow-inner ring-1 ring-black/5 relative isolation-isolate" 
                style={{ backgroundColor: preset.bg }}
              >
                {/* Sidebar */}
                <div className="w-[20%] h-full shrink-0 flex flex-col items-center py-2 gap-1.5" style={{ backgroundColor: preset.servers }}>
                  <div className="w-5 h-5 rounded-[4px]" style={{ backgroundColor: preset.accent }} />
                  <div className="w-5 h-5 rounded-[5px] opacity-40" style={{ backgroundColor: preset.muted }} />
                  <div className="w-5 h-5 rounded-[5px] opacity-40" style={{ backgroundColor: preset.muted }} />
                </div>
                {/* Channel List */}
                <div className="w-[25%] h-full shrink-0 flex flex-col py-3 px-1.5 gap-2" style={{ backgroundColor: preset.sidebar }}>
                   <div className="h-1.5 w-12 rounded-full opacity-30" style={{ backgroundColor: preset.text }} />
                   <div className="h-1.5 w-16 rounded-full opacity-30" style={{ backgroundColor: preset.text }} />
                   <div className="h-3 w-full rounded-md opacity-20" style={{ backgroundColor: preset.accent }} />
                </div>
                {/* Chat Area */}
                <div className="flex-1 flex flex-col p-3 gap-2" style={{ backgroundColor: preset.bg }}>
                  <div className="flex gap-2 items-end">
                    <div className="w-6 h-6 rounded-lg shrink-0 opacity-20" style={{ backgroundColor: preset.text }} />
                    <div className="h-8 rounded-2xl rounded-bl-sm flex-1 opacity-10" style={{ backgroundColor: preset.text }} />
                  </div>
                  <div className="flex gap-2 items-end flex-row-reverse mt-auto">
                    <div className="h-8 rounded-2xl rounded-br-sm w-3/4" style={{ backgroundColor: preset.accent, opacity: 0.2 }} />
                  </div>
                </div>
                
                {/* Active Checkmark */}
                {pendingPreset === preset.id && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/10 transition-opacity">
                    <div className="bg-white text-sp-mention rounded-full p-1 shadow-lg transform scale-125">
                      <Icon name="check" size={24} className="stroke-[3]" />
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex items-center justify-between px-1">
                <span className={`font-semibold text-sm ${pendingPreset === preset.id ? 'text-sp-mention' : 'text-sp-text'}`}>
                  {preset.label}
                </span>
                <div className="w-3 h-3 rounded-full ring-2 ring-black/5" style={{ backgroundColor: preset.accent }} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Color swatches */}
      <div className="bg-sp-sidebar rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs font-bold text-sp-muted uppercase">Custom Colors</div>
          <button onClick={resetColors} className="text-xs text-sp-muted hover:text-sp-text transition-colors">
            Reset all
          </button>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {COLOR_SWATCHES.map(swatch => {
            const current = pending[swatch.key] ?? swatch.default
            return (
              <div key={swatch.key} className="flex flex-col items-center gap-2">
                <label className="relative w-12 h-12 rounded-full cursor-pointer ring-2 ring-white/10 hover:ring-white/30 transition-all overflow-hidden shadow-md">
                  <div className="w-full h-full rounded-full" style={{ backgroundColor: current }} />
                  <input
                    type="color"
                    value={current}
                    onChange={e => handleColorChange(swatch.key, e.target.value)}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                  />
                </label>
                <span className="text-[11px] text-sp-muted text-center leading-tight">{swatch.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Advanced: Custom CSS */}
      <div className="bg-sp-sidebar rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-bold text-sp-muted uppercase">Advanced — Custom CSS</div>
          <button onClick={() => fileRef.current?.click()} className="text-xs text-sp-muted hover:text-sp-text flex items-center gap-1">
            <Icon name="document" size={13} /> Upload .css file
          </button>
          <input ref={fileRef} type="file" accept=".css,text/css" className="hidden" onChange={loadFile} />
        </div>
        <div className="bg-yellow-900/30 border border-yellow-700/50 text-yellow-400 text-xs rounded p-2.5 mb-3 flex items-start gap-2">
          <span className="shrink-0 mt-0.5">⚠</span>
          <span>Custom CSS can break the app or expose you to attacks. Only paste code you fully trust.</span>
        </div>
        <textarea
          className="input w-full font-mono text-xs min-h-[180px] resize-y leading-relaxed"
          placeholder={`/* Example */\n.btn { border-radius: 999px !important; }`}
          value={customCss}
          onChange={e => setCustomCss(e.target.value)}
          spellCheck={false}
        />
        <div className="flex gap-2 mt-3">
          <button className="btn" onClick={applyCSS}>{cssApplied ? '✓ Applied' : 'Apply'}</button>
          <button className="px-4 py-2 rounded bg-sp-input hover:bg-sp-input/70 text-sp-text text-sm font-semibold transition-colors" onClick={resetCSS}>Reset</button>
        </div>
      </div>

      {/* Save / Discard bar */}
      {isDirty && (
        <div className="sticky bottom-0 flex items-center justify-between bg-sp-servers border border-white/10 rounded-lg px-4 py-3 shadow-xl">
          <span className="text-sm text-sp-muted">You have unsaved changes</span>
          <div className="flex gap-2">
            <button
              onClick={handleDiscard}
              className="px-4 py-1.5 rounded bg-sp-input hover:bg-sp-input/70 text-sp-text text-sm font-semibold transition-colors"
            >Discard</button>
            <button
              onClick={handleSave}
              className="btn"
            >Save Changes</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Voice & Video tab ────────────────────────────────────────────────────────

const SOUND_KEYS = ['connectSound', 'disconnectSound', 'muteSound', 'unmuteSound', 'deafenSound', 'undeafenSound', 'notificationSound'] as const
const SOUND_LABELS: Record<string, string> = {
  connectSound: 'User connects', disconnectSound: 'User disconnects',
  muteSound: 'Mute', unmuteSound: 'Unmute', deafenSound: 'Deafen', undeafenSound: 'Undeafen',
  notificationSound: 'New message',
}

function VoiceTab() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [inputId, setInputId]   = useState(() => localStorage.getItem('voiceInputId')  ?? '')
  const [outputId, setOutputId] = useState(() => localStorage.getItem('voiceOutputId') ?? '')
  const [cameraId, setCameraId] = useState(() => localStorage.getItem('voiceCameraId') ?? '')
  const [inputVol, setInputVol]   = useState(() => Number(localStorage.getItem('voiceInputVol')  ?? 100))
  const [outputVol, setOutputVol] = useState(() => Number(localStorage.getItem('voiceOutputVol') ?? 100))
  const [soundVolume, setSoundVolume] = useState(() => Number(localStorage.getItem('soundVolume') ?? 50))
  const [micLevel, setMicLevel] = useState(0)
  const [testing, setTesting] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [sounds, setSounds] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SOUND_KEYS.map(k => [k, localStorage.getItem(k) !== 'false']))
  )
  const stopTestRef   = useRef<() => void>(() => {})
  const stopCameraRef = useRef<() => void>(() => {})
  const videoRef = useRef<HTMLVideoElement>(null)
  const { playSound } = useSoundManager()

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {}).finally(() =>
      navigator.mediaDevices.enumerateDevices().then(d => setDevices(d))
    )
    return () => { stopTestRef.current(); stopCameraRef.current() }
  }, [])

  const audioInputs  = devices.filter(d => d.kind === 'audioinput')
  const audioOutputs = devices.filter(d => d.kind === 'audiooutput')
  const cameras      = devices.filter(d => d.kind === 'videoinput')

  async function startMicTest() {
    setTesting(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: inputId ? { deviceId: inputId } : true })
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      let running = true
      const tick = () => {
        if (!running) return
        analyser.getByteFrequencyData(data)
        setMicLevel(data.reduce((a, b) => a + b, 0) / data.length / 255)
        requestAnimationFrame(tick)
      }
      tick()
      stopTestRef.current = () => {
        running = false
        stream.getTracks().forEach(t => t.stop())
        ctx.close()
        setTesting(false)
        setMicLevel(0)
      }
    } catch { setTesting(false) }
  }

  async function startCamera() {
    setCameraOn(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: cameraId ? { deviceId: cameraId } : true })
      if (videoRef.current) videoRef.current.srcObject = stream
      stopCameraRef.current = () => {
        stream.getTracks().forEach(t => t.stop())
        if (videoRef.current) videoRef.current.srcObject = null
        setCameraOn(false)
      }
    } catch { setCameraOn(false) }
  }

  function saveLocal(key: string, value: string) { localStorage.setItem(key, value) }
  function toggleSound(k: string, v: boolean) {
    setSounds(p => ({ ...p, [k]: v }))
    localStorage.setItem(k, String(v))
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Voice & Video</h2>

      {/* Input */}
      <div className="bg-sp-sidebar rounded-lg p-4 space-y-4">
        <div className="text-xs font-bold text-sp-muted uppercase">Input Device</div>
        <select className="input w-full" value={inputId} onChange={e => { setInputId(e.target.value); saveLocal('voiceInputId', e.target.value) }}>
          <option value="">Default</option>
          {audioInputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
        </select>
        <div>
          <div className="flex justify-between text-xs text-sp-muted mb-1"><span>Input Volume</span><span>{inputVol}%</span></div>
          <input type="range" min={0} max={100} value={inputVol} onChange={e => { setInputVol(+e.target.value); saveLocal('voiceInputVol', e.target.value) }} className="w-full accent-sp-mention" />
        </div>
        <div>
          <div className="text-xs text-sp-muted mb-2">Mic Test</div>
          <div className="flex items-center gap-3">
            <button className="btn py-1 px-3 text-xs shrink-0" onClick={testing ? stopTestRef.current : startMicTest}>
              {testing ? 'Stop' : "Let's Check"}
            </button>
            <div className="flex-1 h-3 bg-sp-bg rounded-full overflow-hidden">
              <div className="h-full bg-sp-mention rounded-full transition-all duration-75" style={{ width: `${micLevel * 100}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Output */}
      <div className="bg-sp-sidebar rounded-lg p-4 space-y-4">
        <div className="text-xs font-bold text-sp-muted uppercase">Output Device</div>
        <select className="input w-full" value={outputId} onChange={e => { setOutputId(e.target.value); saveLocal('voiceOutputId', e.target.value) }}>
          <option value="">Default (System)</option>
          {audioOutputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Speaker'}</option>)}
        </select>
        <div>
          <div className="flex justify-between text-xs text-sp-muted mb-1"><span>Output Volume</span><span>{outputVol}%</span></div>
          <input type="range" min={0} max={100} value={outputVol} onChange={e => { setOutputVol(+e.target.value); saveLocal('voiceOutputVol', e.target.value) }} className="w-full accent-sp-mention" />
        </div>
      </div>

      {/* Camera */}
      <div className="bg-sp-sidebar rounded-lg p-4 space-y-4">
        <div className="text-xs font-bold text-sp-muted uppercase">Camera</div>
        <select className="input w-full" value={cameraId} onChange={e => {
          setCameraId(e.target.value); saveLocal('voiceCameraId', e.target.value)
          if (cameraOn) { stopCameraRef.current(); setTimeout(startCamera, 150) }
        }}>
          <option value="">Default</option>
          {cameras.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
        </select>
        <div className="relative bg-black rounded-lg overflow-hidden aspect-video max-w-sm">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          {!cameraOn && (
            <div className="absolute inset-0 flex items-center justify-center">
              <button className="btn text-xs py-1 px-3" onClick={startCamera}>Preview Camera</button>
            </div>
          )}
          {cameraOn && (
            <button className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white text-xs py-0.5 px-2 rounded transition-colors" onClick={() => stopCameraRef.current()}>Stop</button>
          )}
        </div>
      </div>

      {/* Sound effects */}
      <div className="bg-sp-sidebar rounded-lg p-4">
        <div className="text-xs font-bold text-sp-muted uppercase mb-3">Sound Effects</div>

        {/* Volume slider */}
        <div className="px-3 pb-3 border-b border-sp-bg mb-2">
          <div className="flex justify-between text-xs text-sp-muted mb-1">
            <span>Volume</span>
            <span>{soundVolume}%</span>
          </div>
          <div className="flex items-center gap-3">
            <Icon name="volume-off" size={14} className="text-sp-muted shrink-0" />
            <input
              type="range" min={0} max={100} value={soundVolume}
              onChange={e => {
                const v = +e.target.value
                setSoundVolume(v)
                localStorage.setItem('soundVolume', String(v))
              }}
              className="flex-1 accent-sp-mention"
            />
            <Icon name="volume-up" size={14} className="text-sp-muted shrink-0" />
            <button
              className="shrink-0 text-xs px-2 py-1 rounded bg-sp-bg hover:bg-sp-input transition-colors"
              onClick={() => playSound('notificationSound')}
            >
              Preview
            </button>
          </div>
        </div>

        <div className="space-y-1">
          {SOUND_KEYS.map(k => (
            <label key={k} className="flex items-center justify-between py-2.5 px-3 rounded hover:bg-sp-bg transition-colors cursor-pointer select-none">
              <span className="text-sm">{SOUND_LABELS[k]}</span>
              <div className={`w-10 h-5 rounded-full relative transition-colors cursor-pointer ${sounds[k] ? 'bg-sp-mention' : 'bg-sp-input'}`} onClick={() => toggleSound(k, !sounds[k])}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${sounds[k] ? 'left-5' : 'left-0.5'}`} />
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Privacy & Safety tab ──────────────────────────────────────

const DM_PERM_OPTIONS: { value: DMPermission; label: string; desc: string }[] = [
  { value: 'everyone', label: 'Everyone', desc: 'Anyone can send you a direct message' },
  { value: 'friends_only', label: 'Friends only', desc: 'Only accepted friends can send you direct messages' },
  { value: 'server_members_only', label: 'Server members only', desc: 'Only people sharing a server can send you direct messages' },
]

function PrivacyTab() {
  const { user, refreshUser } = useAuth()
  const qc = useQueryClient()
  const { blockedUsers, unblock } = useBlocks()
  const e2ee = useE2EE()
  const [showQRScanner, setShowQRScanner] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [rotateConfirm, setRotateConfirm] = useState(false)
  const [rotateLoading, setRotateLoading] = useState(false)
  const [cacheCleared, setCacheCleared] = useState(false)
  const backupImportRef = useRef<HTMLInputElement>(null)

  const updateMut = useMutation({
    mutationFn: (patch: any) => updateMe(patch),
    onSuccess: async () => {
      await refreshUser()
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Privacy &amp; Safety</h2>

      {/* Hide online status */}
      <div className="bg-sp-sidebar rounded-lg p-4">
        <div className="text-xs font-bold text-sp-muted uppercase mb-3">Presence</div>
        <label className="flex items-center justify-between cursor-pointer py-2 px-3 rounded hover:bg-sp-bg transition-colors select-none">
          <div>
            <div className="text-sm font-medium">Hide my online status</div>
            <div className="text-xs text-sp-muted mt-0.5">You will appear offline to all other users</div>
          </div>
          <div
            className={`w-10 h-5 rounded-full relative transition-colors cursor-pointer ml-4 shrink-0 ${user?.hide_status ? 'bg-sp-mention' : 'bg-sp-input'}`}
            onClick={() => updateMut.mutate({ hide_status: !user?.hide_status })}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${user?.hide_status ? 'left-5' : 'left-0.5'}`} />
          </div>
        </label>
      </div>

      {/* DM permissions */}
      <div className="bg-sp-sidebar rounded-lg p-4">
        <div className="text-xs font-bold text-sp-muted uppercase mb-3">Who can message you</div>
        <div className="space-y-1">
          {DM_PERM_OPTIONS.map(opt => (
            <label
              key={opt.value}
              className="flex items-start gap-3 cursor-pointer py-2.5 px-3 rounded hover:bg-sp-bg transition-colors"
            >
              <input
                type="radio"
                name="dm_permission"
                value={opt.value}
                checked={(user?.dm_permission ?? 'everyone') === opt.value}
                onChange={() => updateMut.mutate({ dm_permission: opt.value })}
                className="mt-0.5 accent-sp-mention shrink-0"
              />
              <div>
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-xs text-sp-muted">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Blocked users */}
      <div className="bg-sp-sidebar rounded-lg p-4">
        <div className="text-xs font-bold text-sp-muted uppercase mb-3">
          Blocked Users{blockedUsers.length > 0 && ` (${blockedUsers.length})`}
        </div>
        {blockedUsers.length === 0 ? (
          <p className="text-sm text-sp-muted italic">You haven't blocked anyone.</p>
        ) : (
          <div className="space-y-1">
            {blockedUsers.map(u => (
              <div key={u.id} className="flex items-center justify-between py-2 px-2 rounded hover:bg-sp-bg">
                <div className="flex items-center gap-3">
                  <UserAvatar user={u} size={32} />
                  <span className="text-sm font-medium">{u.username}</span>
                </div>
                <button
                  onClick={() => unblock(u.id)}
                  className="text-xs px-3 py-1 rounded bg-sp-input hover:bg-red-500/20 hover:text-red-400 transition-colors"
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* E2EE section */}
      <div className="bg-sp-sidebar rounded-lg p-4">
        <div className="text-xs font-bold text-sp-muted uppercase mb-3">End-to-End Encryption</div>

        {e2ee.initialising ? (
          <p className="text-sm text-sp-muted">Initialising encryption keys…</p>
        ) : !e2ee.isEnabled ? (
          <p className="text-sm text-sp-muted">Encryption keys not available on this device.</p>
        ) : (
          <div className="space-y-4">
            {/* Fingerprint */}
            <div className="rounded bg-sp-bg p-3">
              <div className="text-xs text-sp-muted mb-1">Your key fingerprint</div>
              <code className="text-xs font-mono text-green-400 break-all select-all">{e2ee.fingerprint ?? '—'}</code>
              <p className="text-xs text-sp-muted mt-1">Compare this with the other person's view in a DM to verify your connection.</p>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Download backup */}
              <button
                onClick={() => e2ee.downloadBackup(user?.username ?? 'chatter')}
                className="flex items-center gap-2 px-3 py-2 rounded bg-sp-input hover:bg-sp-muted/20 transition-colors text-sm"
              >
                <Icon name="download" size={16} />
                Download key backup
              </button>

              {/* Import backup */}
              <button
                onClick={() => { setImportError(null); backupImportRef.current?.click() }}
                className="flex items-center gap-2 px-3 py-2 rounded bg-sp-input hover:bg-sp-muted/20 transition-colors text-sm"
              >
                <Icon name="cloud-upload" size={16} />
                Import key backup
              </button>
              <input
                ref={backupImportRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setImportError(null)
                  try {
                    const text = await file.text()
                    const backup = JSON.parse(text)
                    await e2ee.importBackup(backup)
                  } catch {
                    setImportError('Invalid backup file or could not restore keys.')
                  }
                  e.target.value = ''
                }}
              />

              {/* Scan QR (trust transfer) */}
              <button
                onClick={() => setShowQRScanner(true)}
                className="flex items-center gap-2 px-3 py-2 rounded bg-sp-input hover:bg-sp-muted/20 transition-colors text-sm"
              >
                <Icon name="qr-code" size={16} />
                Approve QR login
              </button>

              {/* Rotate key */}
              {!rotateConfirm ? (
                <button
                  onClick={() => setRotateConfirm(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded bg-sp-input hover:bg-red-500/20 hover:text-red-400 transition-colors text-sm"
                >
                  <Icon name="refresh" size={16} />
                  Rotate key pair
                </button>
              ) : (
                <div className="col-span-full flex items-center gap-2 p-3 rounded bg-red-500/10 border border-red-500/30">
                  <p className="text-sm text-red-400 flex-1">This will break decryption of old messages. Continue?</p>
                  <button
                    disabled={rotateLoading}
                    onClick={async () => {
                      setRotateLoading(true)
                      await e2ee.rotateKeyPair()
                      setRotateLoading(false)
                      setRotateConfirm(false)
                    }}
                    className="px-3 py-1 rounded bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors disabled:opacity-60"
                  >
                    {rotateLoading ? 'Rotating…' : 'Confirm'}
                  </button>
                  <button onClick={() => setRotateConfirm(false)} className="px-3 py-1 rounded bg-sp-input hover:bg-sp-muted/20 text-xs transition-colors">
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {importError && (
              <p className="text-xs text-red-400">{importError}</p>
            )}
          </div>
        )}
      </div>

      {/* DM Cache */}
      <div className="bg-sp-sidebar rounded-lg p-4">
        <div className="text-xs font-bold text-sp-muted uppercase mb-3">DM Cache</div>
        <p className="text-xs text-sp-muted mb-3">Recent DM messages are cached locally so you can read them while offline. Clearing the cache removes all stored messages and conversations from this device.</p>
        <button
          onClick={async () => {
            await clearDMCache()
            setCacheCleared(true)
            setTimeout(() => setCacheCleared(false), 3000)
          }}
          className="flex items-center gap-2 px-3 py-2 rounded bg-sp-input hover:bg-red-500/20 hover:text-red-400 transition-colors text-sm"
        >
          <Icon name="trash" size={15} />
          Clear DM cache
        </button>
        {cacheCleared && <p className="text-xs text-green-400 mt-2">Cache cleared.</p>}
      </div>

      {/* QR Scanner modal */}
      {showQRScanner && <QRScanner onClose={() => setShowQRScanner(false)} />}
    </div>
  )
}

// ─── Notifications tab ────────────────────────────────────────────────────────

function NotificationsTab() {
  const { isEnabled, isActive, permission, enable, disable } = useDesktopNotificationsContext()

  const handleToggle = async () => {
    if (isEnabled) {
      disable()
    } else {
      await enable()
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Notifications</h2>
      <p className="text-sp-muted text-sm mb-6">Control how you receive desktop push notifications.</p>

      {/* Enable toggle */}
      <div className="bg-sp-sidebar rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-sm mb-0.5">Enable Desktop Notifications</div>
            <div className="text-xs text-sp-muted">
              Show a system notification when you receive a message while away.
            </div>
          </div>
          <button
            role="switch"
            aria-checked={isEnabled}
            onClick={handleToggle}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${isEnabled ? 'bg-green-500' : 'bg-sp-input'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${isEnabled ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
        </div>
      </div>

      {/* Permission status */}
      {permission === 'unsupported' && (
        <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 px-4 py-3 text-sm text-yellow-300">
          Your browser does not support desktop notifications.
        </div>
      )}

      {permission === 'denied' && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300">
          <p className="font-semibold mb-1">Notifications blocked by browser</p>
          <p>You have denied notification permission. To re-enable, go to your browser&apos;s site settings for this page, allow notifications, then reload.</p>
        </div>
      )}

      {permission === 'default' && isEnabled && (
        <div className="rounded-lg bg-sp-sidebar border border-white/10 px-4 py-3 text-sm text-sp-muted">
          <p className="mb-2">Browser permission is required before notifications can be shown.</p>
          <button onClick={enable} className="btn py-1 px-4 text-sm">
            Request Permission
          </button>
        </div>
      )}

      {isActive && (
        <div className="rounded-lg bg-green-500/10 border border-green-500/30 px-4 py-3 text-sm text-green-300">
          Desktop notifications are active and will appear when you receive a message while the tab is not focused.
        </div>
      )}
    </div>
  )
}

// ─── Shared EditableField ─────────────────────────────────────────────────────

function EditableField({ label, value, placeholder, readOnly, multiline, isEditing, editValue, setEditValue, onEdit, onSave, onCancel, disabled }: any) {
  const maxLen = label === 'About Me' ? 2000 : undefined
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-sp-muted uppercase mb-1">{label}</div>
          {isEditing ? (
            <div className="mt-1">
              {multiline ? (
                <>
                  <textarea className="input w-full min-h-[90px] resize-y" value={editValue} placeholder={placeholder} onChange={e => setEditValue(e.target.value)} maxLength={maxLen} autoFocus />
                  {maxLen && (
                    <div className="mt-1 text-right text-xs text-sp-muted">{editValue.length}/{maxLen}</div>
                  )}
                </>
              ) : (
                <input className="input w-full" value={editValue} placeholder={placeholder} onChange={e => setEditValue(e.target.value)} autoFocus onKeyDown={e => { if (e.key === 'Enter') onSave() }} />
              )}
              <div className="flex gap-2 mt-2 justify-end">
                <button onClick={onCancel} className="text-sm px-3 py-1 hover:underline text-sp-muted">Cancel</button>
                <button onClick={onSave} disabled={disabled} className="btn py-1 px-4">Save</button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-sp-text whitespace-pre-wrap break-words">
              {value || <span className="italic text-sp-muted">{placeholder ?? 'Not set'}</span>}
            </div>
          )}
        </div>
        {!isEditing && !readOnly && (
          <button onClick={onEdit} className="shrink-0 bg-sp-bg hover:bg-sp-input px-3 py-1 rounded text-sm transition-colors">Edit</button>
        )}
      </div>
    </div>
  )
}

// ─── API Tokens tab ───────────────────────────────────────────────────────────

const MAX_TOKENS = 5

function TokensTab() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [revealed, setRevealed] = useState<ApiTokenCreated | null>(null)
  const [copied, setCopied] = useState(false)
  const [revokeId, setRevokeId] = useState<string | null>(null)

  const { data: tokens = [], isLoading } = useQuery<ApiToken[]>({
    queryKey: ['api-tokens'],
    queryFn: getTokens,
  })

  const createMut = useMutation({
    mutationFn: (name: string) => createToken(name),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['api-tokens'] })
      setShowCreate(false)
      setNewName('')
      setRevealed(created)
    },
  })

  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeToken(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-tokens'] })
      setRevokeId(null)
    },
  })

  function handleCopy() {
    if (!revealed) return
    navigator.clipboard.writeText(revealed.token).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function fmtDate(iso: string | null) {
    if (!iso) return 'Never'
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }

  const activeCount = tokens.length
  const atCap = activeCount >= MAX_TOKENS

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-sp-text mb-1">API Tokens</h2>
        <p className="text-sm text-sp-muted">
          Personal API tokens let scripts and bots act on your behalf.
          Tokens are shown only once at creation.
        </p>
      </div>

      {/* Token list */}
      <div className="space-y-2">
        {isLoading && <p className="text-sp-muted text-sm">Loading…</p>}
        {!isLoading && tokens.length === 0 && (
          <p className="text-sp-muted text-sm">No active tokens.</p>
        )}
        {tokens.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3 rounded-md bg-sp-input">
            <Icon name="key" size={16} className="shrink-0 text-sp-muted" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sp-text truncate">{t.name}</div>
              <div className="text-xs text-sp-muted font-mono">
                {t.token_prefix}{'·'.repeat(8)}
                <span className="ml-3 font-sans">Last used: {fmtDate(t.last_used_at)}</span>
              </div>
            </div>
            {revokeId === t.id ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-sp-muted">Revoke?</span>
                <button
                  onClick={() => revokeMut.mutate(t.id)}
                  disabled={revokeMut.isPending}
                  className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white text-xs"
                >
                  Yes
                </button>
                <button onClick={() => setRevokeId(null)} className="px-2 py-0.5 rounded bg-sp-muted/20 hover:bg-sp-muted/30 text-sp-text text-xs">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setRevokeId(t.id)}
                title="Revoke token"
                className="p-1.5 rounded hover:bg-red-500/20 text-sp-muted hover:text-red-400 transition-colors"
              >
                <Icon name="trash" size={15} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Create button */}
      <button
        onClick={() => { setShowCreate(true); setNewName('') }}
        disabled={atCap}
        className="px-4 py-2 rounded-m3-sm bg-sp-mention hover:bg-sp-mention/85 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        title={atCap ? `Maximum of ${MAX_TOKENS} active tokens` : undefined}
      >
        Create Token ({activeCount}/{MAX_TOKENS})
      </button>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)}>
          <div className="bg-sp-popup border border-sp-divider/60 rounded-m3-lg w-full max-w-sm p-6 space-y-4" style={{ boxShadow: 'var(--m3-shadow-3)' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-sp-text">New API Token</h3>
            <div>
              <label className="block text-xs font-semibold text-sp-muted uppercase mb-1">Token Name</label>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) createMut.mutate(newName.trim()) }}
                placeholder="e.g. My bot"
                className="w-full px-3 py-2 rounded-m3-sm bg-sp-input border border-sp-divider/50 text-sp-text placeholder:text-sp-muted text-sm focus:outline-none focus:ring-2 focus:ring-sp-mention/60"
              />
            </div>
            {createMut.isError && <p className="text-red-400 text-sm">{(createMut.error as Error)?.message ?? 'Failed to create token.'}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded text-sp-muted hover:text-sp-text text-sm">Cancel</button>
              <button
                onClick={() => { if (newName.trim()) createMut.mutate(newName.trim()) }}
                disabled={!newName.trim() || createMut.isPending}
                className="px-4 py-2 rounded-m3-sm bg-sp-mention hover:bg-sp-mention/85 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
              >
                {createMut.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* One-time token reveal modal */}
      {revealed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-sp-popup border border-sp-divider/60 rounded-m3-lg w-full max-w-md p-6 space-y-4" style={{ boxShadow: 'var(--m3-shadow-3)' }}>
            <h3 className="text-lg font-semibold text-sp-text">Token Created</h3>
            <p className="text-sm text-yellow-400 font-medium">
              Copy your token now. It will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={revealed.token}
                className="flex-1 px-3 py-2 rounded-m3-sm bg-sp-input border border-sp-divider/50 text-sp-text font-mono text-xs focus:outline-none select-all"
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={handleCopy}
                title="Copy to clipboard"
                className="p-2 rounded bg-sp-input hover:bg-sp-muted/30 text-sp-muted hover:text-sp-text transition-colors"
              >
                <Icon name={copied ? 'checkmark' : 'copy'} size={16} />
              </button>
            </div>
            {copied && <p className="text-xs text-green-400">Copied to clipboard!</p>}
            <div className="flex justify-end">
              <button
                onClick={() => { setRevealed(null); setCopied(false) }}
                className="px-4 py-2 rounded-m3-sm bg-sp-mention hover:bg-sp-mention/85 text-white text-sm font-medium"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// Old SettingsPage implementation removed

// End of file
