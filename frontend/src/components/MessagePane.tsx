import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getChannels } from '../api/channels'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import type { VoiceSession } from '../pages/AppShell'

interface Props {
  voiceSession: VoiceSession | null
  onJoinVoice: (s: VoiceSession) => void
}

export function MessagePane({ voiceSession, onJoinVoice }: Props) {
  const { serverId, channelId } = useParams<{ serverId: string; channelId: string }>()

  const { data: channels = [] } = useQuery({
    queryKey: ['channels', serverId],
    queryFn: () => getChannels(serverId!),
    enabled: !!serverId,
  })

  const channel = channels.find((c) => c.id === channelId)

  if (!channelId) {
    return (
      <div className="flex-1 flex items-center justify-center text-discord-muted">
        Select a channel to start chatting.
      </div>
    )
  }

  if (channel?.type === 'voice') {
    const inVoice = voiceSession?.channelId === channelId
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-discord-muted">
        <div className="text-5xl">🔊</div>
        <h2 className="text-xl font-bold text-discord-text">{channel.title}</h2>
        <p className="text-sm">Voice Channel</p>
        <button
          onClick={() => {
            if (inVoice) return
            onJoinVoice({ channelId: channel.id, channelName: channel.title, serverId: serverId! })
          }}
          className={`btn ${inVoice ? 'opacity-60 cursor-default' : ''}`}
          disabled={inVoice}
        >
          {inVoice ? 'In Voice' : 'Join Voice'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Channel header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-black/20 shadow-sm shrink-0">
        <span className="text-discord-muted font-semibold">#</span>
        <span className="font-bold">{channel?.title ?? channelId}</span>
      </div>

      {/* Messages */}
      <MessageList channelId={channelId} />

      {/* Input */}
      <MessageInput
        channelId={channelId}
        placeholder={`Message #${channel?.title ?? channelId}`}
      />
    </div>
  )
}
