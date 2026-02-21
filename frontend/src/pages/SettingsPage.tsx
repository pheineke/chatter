import { useNavigate } from 'react-router-dom'
import { useRef, useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Icon } from '../components/Icon'
import { UserAvatar } from '../components/UserAvatar'
import { updateMe, uploadAvatar, uploadBanner } from '../api/users'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UserStatus } from '../api/types'
import { COLOR_SWATCHES, loadColorOverrides, applyColorOverrides } from '../utils/colorOverrides'

type Tab = 'account' | 'appearance' | 'voice'

// ─── Sidebar nav ─────────────────────────────────────────────────────────────

const NAV: { group: string; items: { id: Tab; label: string; icon: string }[] }[] = [
  {
    group: 'User Settings',
    items: [{ id: 'account', label: 'My Account', icon: 'person' }],
  },
  {
    group: 'App Settings',
    items: [
      { id: 'appearance', label: 'Appearance', icon: 'color-palette' },
      { id: 'voice', label: 'Voice & Video', icon: 'mic' },
    ],
  },
]

// ─── My Account tab ───────────────────────────────────────────────────────────

function AccountTab() {
  const { user, refreshUser } = useAuth()
  const qc = useQueryClient()
  const avatarInput = useRef<HTMLInputElement>(null)
  const bannerInput = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const updateMut = useMutation({
    mutationFn: (patch: any) => updateMe(patch),
    onSuccess: async () => {
      await refreshUser()
      qc.invalidateQueries({ queryKey: ['me'] })
      setEditing(null)
      setIsSubmitting(false)
    },
  })

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'banner') {
    if (!e.target.files?.[0]) return
    setIsSubmitting(true)
    try {
      if (type === 'avatar') await uploadAvatar(e.target.files[0])
      else await uploadBanner(e.target.files[0])
      await refreshUser()
      qc.invalidateQueries({ queryKey: ['me'] })
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

  const statusColors: Record<string, string> = {
    online: 'bg-discord-online',
    away: 'bg-discord-idle',
    busy: 'bg-discord-dnd',
    offline: 'bg-discord-offline',
  }
  const statusLabels: Record<string, string> = {
    online: 'Online', away: 'Away', busy: 'Do Not Disturb', offline: 'Offline',
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">My Account</h2>

      {/* Profile preview */}
      <div className="bg-discord-sidebar rounded-lg mb-6">
        {/* Banner */}
        <div
          className="h-24 rounded-t-lg relative bg-cover bg-center group cursor-pointer"
          style={{
            backgroundColor: user?.banner ? undefined : '#5865F2',
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
            <div className="rounded-full p-1.5 bg-discord-sidebar shrink-0">
              <div className="relative group rounded-full">
                <UserAvatar user={user} size={72} className="rounded-full" />
                <div
                  className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity"
                  onClick={() => avatarInput.current?.click()}
                >
                  <span className="text-[10px] font-bold text-white text-center leading-tight">CHANGE{'\n'}AVATAR</span>
                </div>
                <input ref={avatarInput} type="file" className="hidden" accept="image/*" onChange={e => handleFile(e, 'avatar')} />
                <div className={`absolute bottom-1 right-1 w-5 h-5 rounded-full border-[3px] border-discord-sidebar ${statusColors[user?.status ?? 'offline']}`} />
              </div>
            </div>
            {/* Name sits at the bottom of the avatar row */}
            <div className="pb-1">
              <p className="font-bold text-lg leading-tight">{user?.username}</p>
              {user?.pronouns && <p className="text-discord-muted text-sm">{user.pronouns}</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Status selector */}
      <div className="bg-discord-sidebar rounded-lg p-4 mb-6">
        <div className="text-xs font-bold text-discord-muted uppercase mb-3">Online Status</div>
        <div className="grid grid-cols-2 gap-2">
          {(['online', 'away', 'busy', 'offline'] as const).map(s => (
            <button
              key={s}
              onClick={() => updateMut.mutate({ status: s as UserStatus })}
              className={`py-2 px-3 rounded text-sm font-medium flex items-center gap-2 transition-colors
                ${user?.status === s
                  ? 'bg-discord-mention/20 text-discord-mention ring-1 ring-discord-mention/50'
                  : 'bg-discord-bg hover:bg-discord-input text-discord-text'}`}
            >
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusColors[s]}`} />
              {statusLabels[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Editable fields */}
      <div className="bg-discord-sidebar rounded-lg p-4 space-y-2 divide-y divide-discord-input">
        <div className="text-xs font-bold text-discord-muted uppercase pb-2">Account Information</div>
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
    </div>
  )
}

// ─── Appearance tab ───────────────────────────────────────────────────────────

const PRESETS: { id: string; label: string; accent: string; bg: string; sidebar: string; servers: string; input: string; text: string; muted: string }[] = [
  { id: 'default', label: 'Default', accent: '#7289da', bg: '#36393f', sidebar: '#2f3136', servers: '#202225', input: '#40444b', text: '#dcddde', muted: '#72767d' },
  { id: 'light',   label: 'Light',   accent: '#5865f2', bg: '#ffffff', sidebar: '#f2f3f5', servers: '#e3e5e8', input: '#e9eaed', text: '#2e3338', muted: '#747f8d' },
  { id: 'red',     label: 'Ruby',    accent: '#ed4245', bg: '#2e2323', sidebar: '#261d1d', servers: '#1a1414', input: '#3a2e2e', text: '#dcddde', muted: '#72767d' },
  { id: 'blue',    label: 'Ocean',   accent: '#00b0f4', bg: '#1e2733', sidebar: '#1a2234', servers: '#131822', input: '#263445', text: '#dcddde', muted: '#72767d' },
  { id: 'purple',  label: 'Violet',  accent: '#9b59b6', bg: '#1e1028', sidebar: '#260d3b', servers: '#180a26', input: '#2e1545', text: '#dcddde', muted: '#72767d' },
  { id: 'green',   label: 'Forest',  accent: '#3ba55c', bg: '#1a2318', sidebar: '#1a2d1f', servers: '#111a12', input: '#243329', text: '#dcddde', muted: '#72767d' },
]


function AppearanceTab() {
  const initSaved   = loadColorOverrides
  const initPreset  = () => localStorage.getItem('appPreset') ?? 'default'

  const [saved,        setSaved]        = useState<Record<string, string>>(initSaved)
  const [savedPreset,  setSavedPreset]  = useState<string>(initPreset)
  const [pending,      setPending]      = useState<Record<string, string>>(initSaved)
  const [pendingPreset,setPendingPreset]= useState<string>(initPreset)
  const [customCss, setCustomCss] = useState(() => localStorage.getItem('customCss') ?? '')
  const [cssApplied, setCssApplied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const isDirty = JSON.stringify(pending) !== JSON.stringify(saved) || pendingPreset !== savedPreset

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
  }

  function handleDiscard() {
    setPending(saved)
    setPendingPreset(savedPreset)
  }

  function resetColors() {
    setSaved({})
    setSavedPreset('default')
    setPending({})
    setPendingPreset('default')
    localStorage.removeItem('colorOverrides')
    localStorage.setItem('appPreset', 'default')
    applyColorOverrides({})
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
      <div className="bg-discord-sidebar rounded-lg p-4">
        <div className="text-xs font-bold text-discord-muted uppercase mb-3">Preset Themes</div>
        <div className="grid grid-cols-6 gap-3">
          {PRESETS.map(preset => (
            <button
              key={preset.id}
              onClick={() => handlePreset(preset)}
              className={`flex flex-col items-center gap-2 p-2 rounded-lg border-2 transition-all
                ${pendingPreset === preset.id ? 'border-discord-mention' : 'border-transparent hover:border-white/10'}`}
            >
              {/* Mini preview */}
              <div className="w-full h-10 rounded flex overflow-hidden shadow-md" style={{ backgroundColor: preset.bg }}>
                <div className="w-2.5 h-full shrink-0" style={{ backgroundColor: preset.servers }} />
                <div className="w-4 h-full shrink-0" style={{ backgroundColor: preset.sidebar }} />
                <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: preset.bg }}>
                  <div className="w-4 h-1.5 rounded-full" style={{ backgroundColor: preset.accent }} />
                </div>
              </div>
              <span className="text-xs text-discord-muted">{preset.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Color swatches */}
      <div className="bg-discord-sidebar rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs font-bold text-discord-muted uppercase">Custom Colors</div>
          <button onClick={resetColors} className="text-xs text-discord-muted hover:text-discord-text transition-colors">
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
                <span className="text-[11px] text-discord-muted text-center leading-tight">{swatch.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Advanced: Custom CSS */}
      <div className="bg-discord-sidebar rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-bold text-discord-muted uppercase">Advanced — Custom CSS</div>
          <button onClick={() => fileRef.current?.click()} className="text-xs text-discord-muted hover:text-discord-text flex items-center gap-1">
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
          <button className="px-4 py-2 rounded bg-discord-input hover:bg-discord-input/70 text-discord-text text-sm font-semibold transition-colors" onClick={resetCSS}>Reset</button>
        </div>
      </div>

      {/* Save / Discard bar */}
      {isDirty && (
        <div className="sticky bottom-0 flex items-center justify-between bg-discord-servers border border-white/10 rounded-lg px-4 py-3 shadow-xl">
          <span className="text-sm text-discord-muted">You have unsaved changes</span>
          <div className="flex gap-2">
            <button
              onClick={handleDiscard}
              className="px-4 py-1.5 rounded bg-discord-input hover:bg-discord-input/70 text-discord-text text-sm font-semibold transition-colors"
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

const SOUND_KEYS = ['connectSound', 'disconnectSound', 'muteSound', 'unmuteSound', 'deafenSound', 'undeafenSound'] as const
const SOUND_LABELS: Record<string, string> = {
  connectSound: 'User connects', disconnectSound: 'User disconnects',
  muteSound: 'Mute', unmuteSound: 'Unmute', deafenSound: 'Deafen', undeafenSound: 'Undeafen',
}

function VoiceTab() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [inputId, setInputId]   = useState(() => localStorage.getItem('voiceInputId')  ?? '')
  const [outputId, setOutputId] = useState(() => localStorage.getItem('voiceOutputId') ?? '')
  const [cameraId, setCameraId] = useState(() => localStorage.getItem('voiceCameraId') ?? '')
  const [inputVol, setInputVol]   = useState(() => Number(localStorage.getItem('voiceInputVol')  ?? 100))
  const [outputVol, setOutputVol] = useState(() => Number(localStorage.getItem('voiceOutputVol') ?? 100))
  const [micLevel, setMicLevel] = useState(0)
  const [testing, setTesting] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [sounds, setSounds] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SOUND_KEYS.map(k => [k, localStorage.getItem(k) !== 'false']))
  )
  const stopTestRef   = useRef<() => void>(() => {})
  const stopCameraRef = useRef<() => void>(() => {})
  const videoRef = useRef<HTMLVideoElement>(null)

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
      <div className="bg-discord-sidebar rounded-lg p-4 space-y-4">
        <div className="text-xs font-bold text-discord-muted uppercase">Input Device</div>
        <select className="input w-full" value={inputId} onChange={e => { setInputId(e.target.value); saveLocal('voiceInputId', e.target.value) }}>
          <option value="">Default</option>
          {audioInputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
        </select>
        <div>
          <div className="flex justify-between text-xs text-discord-muted mb-1"><span>Input Volume</span><span>{inputVol}%</span></div>
          <input type="range" min={0} max={100} value={inputVol} onChange={e => { setInputVol(+e.target.value); saveLocal('voiceInputVol', e.target.value) }} className="w-full accent-discord-mention" />
        </div>
        <div>
          <div className="text-xs text-discord-muted mb-2">Mic Test</div>
          <div className="flex items-center gap-3">
            <button className="btn py-1 px-3 text-xs shrink-0" onClick={testing ? stopTestRef.current : startMicTest}>
              {testing ? 'Stop' : "Let's Check"}
            </button>
            <div className="flex-1 h-3 bg-discord-bg rounded-full overflow-hidden">
              <div className="h-full bg-discord-mention rounded-full transition-all duration-75" style={{ width: `${micLevel * 100}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Output */}
      <div className="bg-discord-sidebar rounded-lg p-4 space-y-4">
        <div className="text-xs font-bold text-discord-muted uppercase">Output Device</div>
        <select className="input w-full" value={outputId} onChange={e => { setOutputId(e.target.value); saveLocal('voiceOutputId', e.target.value) }}>
          <option value="">Default (System)</option>
          {audioOutputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Speaker'}</option>)}
        </select>
        <div>
          <div className="flex justify-between text-xs text-discord-muted mb-1"><span>Output Volume</span><span>{outputVol}%</span></div>
          <input type="range" min={0} max={100} value={outputVol} onChange={e => { setOutputVol(+e.target.value); saveLocal('voiceOutputVol', e.target.value) }} className="w-full accent-discord-mention" />
        </div>
      </div>

      {/* Camera */}
      <div className="bg-discord-sidebar rounded-lg p-4 space-y-4">
        <div className="text-xs font-bold text-discord-muted uppercase">Camera</div>
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
      <div className="bg-discord-sidebar rounded-lg p-4">
        <div className="text-xs font-bold text-discord-muted uppercase mb-3">Sound Effects</div>
        <div className="space-y-1">
          {SOUND_KEYS.map(k => (
            <label key={k} className="flex items-center justify-between py-2.5 px-3 rounded hover:bg-discord-bg transition-colors cursor-pointer select-none">
              <span className="text-sm">{SOUND_LABELS[k]}</span>
              <div className={`w-10 h-5 rounded-full relative transition-colors cursor-pointer ${sounds[k] ? 'bg-discord-mention' : 'bg-discord-input'}`} onClick={() => toggleSound(k, !sounds[k])}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${sounds[k] ? 'left-5' : 'left-0.5'}`} />
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Shared EditableField ─────────────────────────────────────────────────────

function EditableField({ label, value, placeholder, readOnly, multiline, isEditing, editValue, setEditValue, onEdit, onSave, onCancel, disabled }: any) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-discord-muted uppercase mb-1">{label}</div>
          {isEditing ? (
            <div className="mt-1">
              {multiline ? (
                <textarea className="input w-full min-h-[90px] resize-y" value={editValue} placeholder={placeholder} onChange={e => setEditValue(e.target.value)} autoFocus />
              ) : (
                <input className="input w-full" value={editValue} placeholder={placeholder} onChange={e => setEditValue(e.target.value)} autoFocus onKeyDown={e => { if (e.key === 'Enter') onSave() }} />
              )}
              <div className="flex gap-2 mt-2 justify-end">
                <button onClick={onCancel} className="text-sm px-3 py-1 hover:underline text-discord-muted">Cancel</button>
                <button onClick={onSave} disabled={disabled} className="btn py-1 px-4">Save</button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-discord-text whitespace-pre-wrap break-words">
              {value || <span className="italic text-discord-muted">{placeholder ?? 'Not set'}</span>}
            </div>
          )}
        </div>
        {!isEditing && !readOnly && (
          <button onClick={onEdit} className="shrink-0 bg-discord-bg hover:bg-discord-input px-3 py-1 rounded text-sm transition-colors">Edit</button>
        )}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('account')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') navigate(-1) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])

  return (
    <div className="flex h-screen w-full bg-discord-bg text-discord-text overflow-hidden">

      {/* Nav sidebar */}
      <div className="flex flex-col w-[218px] shrink-0 bg-discord-sidebar px-2 py-6 overflow-y-auto">
        {NAV.map(group => (
          <div key={group.group} className="mb-4">
            <div className="px-2 mb-1 text-[11px] font-bold text-discord-muted uppercase tracking-wide">{group.group}</div>
            {group.items.map(item => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm font-medium transition-colors
                  ${tab === item.id ? 'bg-discord-input text-discord-text' : 'text-discord-muted hover:bg-discord-input/50 hover:text-discord-text'}`}
              >
                <Icon name={item.icon} size={16} className="shrink-0" />
                {item.label}
              </button>
            ))}
          </div>
        ))}
        <div className="mt-auto pt-4 border-t border-white/5">
          <button onClick={logout} className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors">
            <Icon name="log-out" size={16} className="shrink-0" />
            Log Out
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 min-w-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-2xl mx-auto">
            {tab === 'account'    && <AccountTab />}
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'voice'      && <VoiceTab />}
          </div>
        </div>
        {/* Close button */}
        <div className="p-4 shrink-0 flex flex-col items-center gap-1">
          <button onClick={() => navigate(-1)} title="Close (Esc)" className="w-9 h-9 rounded-full bg-discord-input hover:bg-discord-muted/30 flex items-center justify-center transition-colors group">
            <Icon name="close" size={20} className="text-discord-muted group-hover:text-discord-text" />
          </button>
          <span className="text-[10px] text-discord-muted">ESC</span>
        </div>
      </div>
    </div>
  )
}
