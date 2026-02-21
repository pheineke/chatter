import { useParams } from 'react-router-dom'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getChannels } from '../api/channels'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import { MemberSidebar } from './MemberSidebar'
import { VoiceGridPane } from './VoiceGridPane'
import { Icon } from './Icon'
import type { VoiceSession } from '../pages/AppShell'

interface Props {
  voiceSession: VoiceSession | null
  onJoinVoice: (s: VoiceSession) => void
  onLeaveVoice: () => void
}

export function MessagePane({ voiceSession, onJoinVoice, onLeaveVoice }: Props) {
  const { serverId, channelId } = useParams<{ serverId: string; channelId: string }>()
  const [showMembers, setShowMembers] = useState(true)

  const { data: channels = [], isLoading: channelsLoading } = useQuery({
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

  // If we're already in a voice session for this channel, show the grid immediately
  // (don't wait for the channels query — we know it's a voice channel).
  if (voiceSession?.channelId === channelId) {
    return <VoiceGridPane session={voiceSession} onLeave={onLeaveVoice} />
  }

  // Still loading channel list — don't render a text-channel layout for a voice channel
  if (channelsLoading && !channel) {
    return (
      <div className="flex-1 flex items-center justify-center text-discord-muted">
        <Icon name="loader" size={24} className="animate-spin" />
      </div>
    )
  }

  if (channel?.type === 'voice') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-discord-muted">
        <div className="text-5xl">🔊</div>
        <h2 className="text-xl font-bold text-discord-text">{channel.title}</h2>
        <p className="text-sm">Voice Channel</p>
        <button
          onClick={() => onJoinVoice({ channelId: channel.id, channelName: channel.title, serverId: serverId! })}
          className="btn"
        >
          Join Voice
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Channel header */}
      <div className="flex items-center gap-2 px-4 border-b border-black/20 shadow-sm shrink-0 h-12">
        <span className="text-discord-muted font-semibold">#</span>
        <span className="font-bold">{channel?.title ?? channelId}</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowMembers(v => !v)}
          title="Toggle member list"
          className={`p-1.5 rounded transition-colors ${showMembers ? 'text-discord-text' : 'text-discord-muted hover:text-discord-text'}`}
        >
          <Icon name="people" size={20} />
        </button>
      </div>

      {/* Body: messages + optional member sidebar */}
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Messages */}
          <MessageList channelId={channelId} />

          {/* Input */}
          <MessageInput
            channelId={channelId}
            placeholder={`Message #${channel?.title ?? channelId}`}
          />
        </div>

        {showMembers && serverId && <MemberSidebar serverId={serverId} />}
      </div>
    </div>
  )
}
