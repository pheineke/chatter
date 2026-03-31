import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVoiceCall } from '../contexts/VoiceCallContext'
import { Icon } from './Icon'
import type { VoiceSession } from '../pages/AppShell'

interface Props {
  session: VoiceSession
  onLeave: () => void
}

function VoiceBtn({
  title, active, danger, onClick, onContextMenu, children,
}: {
  title: string
  active?: boolean
  danger?: boolean
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`w-full h-8 flex items-center justify-center text-lg transition-colors rounded
        ${danger ? 'hover:bg-red-500 text-sp-muted hover:text-white'
          : active ? 'bg-white/10 text-sp-text'
          : 'text-sp-muted hover:bg-white/5 hover:text-sp-text'}`}
    >
      {children}
    </button>
  )
}

export function VoiceChannelBar({ session, onLeave }: Props) {
  const navigate = useNavigate()
  const { state, toggleMute, toggleDeafen, toggleScreenShare, toggleWebcam } = useVoiceCall()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [inputId, setInputId] = useState(() => localStorage.getItem('voiceInputId') ?? '')
  const [outputId, setOutputId] = useState(() => localStorage.getItem('voiceOutputId') ?? '')
  const [inputVol, setInputVol] = useState(() => Number(localStorage.getItem('voiceInputVol') ?? 100))
  const [outputVol, setOutputVol] = useState(() => Number(localStorage.getItem('voiceOutputVol') ?? 100))
  const [micLevel, setMicLevel] = useState(0)
  const [inputMenu, setInputMenu] = useState<{ x: number; y: number } | null>(null)
  const [outputMenu, setOutputMenu] = useState<{ x: number; y: number } | null>(null)
  const inputMenuRef = useRef<HTMLDivElement>(null)
  const outputMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null).finally(() => {
      navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => setDevices([]))
    })
  }, [])

  useEffect(() => {
    if (!inputMenu && !outputMenu) return
    function closeOnOutside(e: MouseEvent) {
      const t = e.target as Node
      if (inputMenuRef.current?.contains(t) || outputMenuRef.current?.contains(t)) return
      setInputMenu(null)
      setOutputMenu(null)
    }
    function closeOnEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setInputMenu(null)
        setOutputMenu(null)
      }
    }
    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEsc)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEsc)
    }
  }, [inputMenu, outputMenu])

  useEffect(() => {
    if (!inputMenu) return
    let active = true
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let rafId = 0

    async function startMeter() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: inputId ? { deviceId: inputId } : true,
        })
        if (!active) return
        ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        const source = ctx.createMediaStreamSource(stream)
        source.connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          if (!active) return
          analyser.getByteFrequencyData(data)
          const level = data.reduce((a, b) => a + b, 0) / data.length / 255
          setMicLevel(level)
          rafId = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        setMicLevel(0)
      }
    }

    startMeter()
    return () => {
      active = false
      if (rafId) cancelAnimationFrame(rafId)
      stream?.getTracks().forEach((t) => t.stop())
      ctx?.close().catch(() => null)
      setMicLevel(0)
    }
  }, [inputMenu, inputId])

  const audioInputs = devices.filter((d) => d.kind === 'audioinput')
  const audioOutputs = devices.filter((d) => d.kind === 'audiooutput')

  function saveLocal(key: string, value: string) {
    localStorage.setItem(key, value)
  }

  function openVoiceSettings() {
    setInputMenu(null)
    setOutputMenu(null)
    navigate('/channels/settings?tab=voice')
  }
  
  return (
    <div className="flex flex-col shrink-0 gap-0 border-b border-sp-divider/20">
      {/* Connection status bar */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-sp-user">
        <div className="flex flex-col min-w-0 pointer-events-none select-none">
          <div className="flex items-center gap-1.5 font-bold text-sp-online text-xs uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-sp-online" />
            Voice Connected
          </div>
          <span className="text-sp-muted text-xs truncate">
            {session.channelName} / {session.serverId ? 'Server' : 'DM'}
          </span>
        </div>
        
        <button 
          title="Disconnect" 
          onClick={onLeave}
          className="w-7 h-7 rounded flex items-center justify-center text-sp-muted hover:text-white hover:bg-sp-danger transition-colors"
        >
          <Icon name="phone-off" size={16} />
        </button>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-4 px-1 py-1 bg-sp-user gap-px">
        <VoiceBtn
          title={state.isMuted ? 'Unmute' : 'Mute'}
          active={state.isMuted}
          onClick={toggleMute}
          onContextMenu={(e) => {
            e.preventDefault()
            setOutputMenu(null)
            setInputMenu({ x: e.pageX, y: e.pageY })
          }}
        >
          <Icon name={state.isMuted ? 'mic-off' : 'mic'} size={18} />
        </VoiceBtn>
        <VoiceBtn
          title={state.isDeafened ? 'Undeafen' : 'Deafen'}
          active={state.isDeafened}
          onClick={toggleDeafen}
          onContextMenu={(e) => {
            e.preventDefault()
            setInputMenu(null)
            setOutputMenu({ x: e.pageX, y: e.pageY })
          }}
        >
          <Icon name={state.isDeafened ? 'headphones-off' : 'headphones'} size={18} />
        </VoiceBtn>
        <VoiceBtn title={state.isSharingWebcam ? 'Turn Off Camera' : 'Turn On Camera'} active={state.isSharingWebcam} onClick={toggleWebcam}>
          <Icon name="camera" size={18} />
        </VoiceBtn>
        <VoiceBtn title={state.isSharingScreen ? 'Stop Screen Share' : 'Share Screen'} active={state.isSharingScreen} onClick={toggleScreenShare}>
          <Icon name="monitor" size={18} />
        </VoiceBtn>
      </div>

      {inputMenu && (
        <div
          ref={inputMenuRef}
          style={{ left: inputMenu.x, top: inputMenu.y }}
          className="fixed z-[9999] w-72 bg-sp-popup border border-sp-divider/60 rounded-sp-lg shadow-sp-3 p-3"
        >
          <div className="text-xs font-bold uppercase tracking-wider text-sp-muted mb-2">Input Device</div>
          <select
            className="input w-full mb-3"
            value={inputId}
            onChange={(e) => {
              setInputId(e.target.value)
              saveLocal('voiceInputId', e.target.value)
            }}
          >
            <option value="">Default</option>
            {audioInputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>
            ))}
          </select>

          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-sp-muted mb-1">
              <span>Input Volume</span>
              <span>{inputVol}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={inputVol}
              onChange={(e) => {
                const v = Number(e.target.value)
                setInputVol(v)
                saveLocal('voiceInputVol', String(v))
              }}
              className="w-full accent-sp-mention"
            />
          </div>

          <div className="mb-3">
            <div className="text-xs text-sp-muted mb-1">Mic Activity</div>
            <div className="h-2 bg-sp-input rounded-full overflow-hidden">
              <div
                className="h-full bg-sp-mention transition-all duration-75"
                style={{ width: `${Math.min(100, Math.round(micLevel * 100))}%` }}
              />
            </div>
          </div>

          <button
            onClick={openVoiceSettings}
            className="w-full text-left px-2.5 py-2 rounded text-sm text-sp-text hover:bg-sp-hover transition-colors"
          >
            Voice Settings
          </button>
        </div>
      )}

      {outputMenu && (
        <div
          ref={outputMenuRef}
          style={{ left: outputMenu.x, top: outputMenu.y }}
          className="fixed z-[9999] w-72 bg-sp-popup border border-sp-divider/60 rounded-sp-lg shadow-sp-3 p-3"
        >
          <div className="text-xs font-bold uppercase tracking-wider text-sp-muted mb-2">Output Device</div>
          <select
            className="input w-full mb-3"
            value={outputId}
            onChange={(e) => {
              setOutputId(e.target.value)
              saveLocal('voiceOutputId', e.target.value)
            }}
          >
            <option value="">Default (System)</option>
            {audioOutputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || 'Speaker'}</option>
            ))}
          </select>

          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-sp-muted mb-1">
              <span>Output Volume</span>
              <span>{outputVol}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              value={outputVol}
              onChange={(e) => {
                const v = Number(e.target.value)
                setOutputVol(v)
                saveLocal('voiceOutputVol', String(v))
              }}
              className="w-full accent-sp-mention"
            />
          </div>

          <button
            onClick={openVoiceSettings}
            className="w-full text-left px-2.5 py-2 rounded text-sm text-sp-text hover:bg-sp-hover transition-colors"
          >
            Voice Settings
          </button>
        </div>
      )}
    </div>
  )
}
