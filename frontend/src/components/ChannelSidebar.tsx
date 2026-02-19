import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getChannels, getCategories, createChannel } from '../api/channels'
import { getMembers } from '../api/servers'
import { useAuth } from '../contexts/AuthContext'
import { StatusIndicator } from './StatusIndicator'
import { UserAvatar } from './UserAvatar'
import { Icon } from './Icon'
import { useServerWS } from '../hooks/useServerWS'
import type { Channel, VoiceParticipant } from '../api/types'
import type { VoiceSession } from '../pages/AppShell'

interface Props {
  voiceSession: VoiceSession | null
  onJoinVoice: (session: VoiceSession) => void
  onLeaveVoice: () => void
}

export function ChannelSidebar({ voiceSession, onJoinVoice, onLeaveVoice }: Props) {
  const { serverId, channelId } = useParams<{ serverId: string; channelId?: string }>()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const qc = useQueryClient()

  useServerWS(serverId ?? null)

  const { data: channels = [] } = useQuery({
    queryKey: ['channels', serverId],
    queryFn: () => getChannels(serverId!),
    enabled: !!serverId,
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', serverId],
    queryFn: () => getCategories(serverId!),
    enabled: !!serverId,
  })

  const { data: members = [] } = useQuery({
    queryKey: ['members', serverId],
    queryFn: () => getMembers(serverId!),
    enabled: !!serverId,
  })

  const [showAddChannel, setShowAddChannel] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>('text')

  async function handleCreateChannel() {
    if (!serverId || !newChannelName.trim()) return
    await createChannel(serverId, { title: newChannelName, type: newChannelType })
    qc.invalidateQueries({ queryKey: ['channels', serverId] })
    setShowAddChannel(false)
    setNewChannelName('')
  }

  // Group channels by category (null = no category)
  const grouped = new Map<string | null, Channel[]>()
  grouped.set(null, [])
  categories.forEach((c) => grouped.set(c.id, []))
  channels.forEach((ch) => {
    const key = ch.category_id ?? null
    grouped.set(key, [...(grouped.get(key) ?? []), ch])
  })

  return (
    <div className="flex flex-col h-full">
      {/* Server name header */}
      <div className="px-4 py-3 font-bold border-b border-black/20 shadow-sm flex items-center justify-between">
        <span className="truncate">Server</span>
        <button onClick={() => setShowAddChannel(true)} title="Add Channel" className="text-discord-muted hover:text-discord-text">
          <Icon name="plus" size={16} />
        </button>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto py-2 space-y-1">
        {Array.from(grouped.entries()).map(([catId, chs]) => {
          const cat = categories.find((c) => c.id === catId)
          return (
            <div key={catId ?? 'no-cat'}>
              {cat && (
                <div className="px-2 pt-3 pb-1 text-xs font-semibold uppercase text-discord-muted tracking-wider">
                  {cat.title}
                </div>
              )}
              {chs.map((ch) => (
                <ChannelRow
                  key={ch.id}
                  channel={ch}
                  active={ch.id === channelId}
                  serverId={serverId!}
                  voiceSession={voiceSession}
                  onJoinVoice={onJoinVoice}
                  onLeaveVoice={onLeaveVoice}
                  navigate={navigate}
                />
              ))}
            </div>
          )
        })}
      </div>

      {/* User panel */}
      <div className="p-2 bg-discord-bg flex items-center gap-2">
        <div className="relative">
          <UserAvatar user={user} size={32} />
          {user && (
            <span className="absolute -bottom-0.5 -right-0.5">
              <StatusIndicator status={user.status} size={10} />
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{user?.username}</div>
          <div className="text-xs text-discord-muted truncate capitalize">{user?.status}</div>
        </div>
        <button
          title="Log out"
          onClick={logout}
          className="text-discord-muted hover:text-discord-text leading-none p-1"
        >
          <Icon name="log-out" size={18} />
        </button>
      </div>

      {/* Add channel modal */}
      {showAddChannel && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowAddChannel(false)}>
          <div className="bg-discord-sidebar rounded-lg p-6 w-80" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Add Channel</h2>
            <div className="flex gap-2 mb-3">
              {(['text', 'voice'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setNewChannelType(t)}
                  className={`flex-1 py-1 rounded text-sm flex items-center justify-center gap-1 ${newChannelType === t ? 'bg-discord-mention text-white' : 'bg-discord-input text-discord-text'}`}
                >
                  {t === 'text'
                    ? <><Icon name="hash" size={14} /> Text</>
                    : <><Icon name="headphones" size={14} /> Voice</>}
                </button>
              ))}
            </div>
            <input
              className="input w-full mb-3"
              placeholder="channel-name"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
            />
            <button className="btn w-full" onClick={handleCreateChannel} disabled={!newChannelName.trim()}>
              Create Channel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface RowProps {
  channel: Channel
  active: boolean
  serverId: string
  voiceSession: VoiceSession | null
  onJoinVoice: (s: VoiceSession) => void
  onLeaveVoice: () => void
  navigate: ReturnType<typeof useNavigate>
}

function ChannelRow({ channel, active, serverId, voiceSession, onJoinVoice, onLeaveVoice, navigate }: RowProps) {
  const isVoice = channel.type === 'voice'
  const inThisVoice = voiceSession?.channelId === channel.id

  function handleClick() {
    if (isVoice) {
      if (inThisVoice) {
        onLeaveVoice()
      } else {
        onJoinVoice({ channelId: channel.id, channelName: channel.title, serverId })
      }
    } else {
      navigate(`/channels/${serverId}/${channel.id}`)
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`w-full flex items-center gap-1.5 px-2 py-1 mx-1 rounded text-sm transition-colors
        ${active || inThisVoice
          ? 'bg-discord-input text-discord-text'
          : 'text-discord-muted hover:bg-discord-input/60 hover:text-discord-text'}`}
    >
      <Icon name={isVoice ? 'headphones' : 'hash'} size={16} className="opacity-60 shrink-0" />
      <span className="truncate">{channel.title}</span>
      {inThisVoice && <span className="ml-auto text-discord-online text-xs">● Live</span>}
    </button>
  )
}
