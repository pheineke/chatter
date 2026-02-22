import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getPins, unpinMessage } from '../api/messages'
import { UserAvatar } from './UserAvatar'
import { Icon } from './Icon'
import { format } from 'date-fns'

interface Props {
  channelId: string
  onScrollToMessage?: (id: string) => void
  onClose: () => void
}

export function PinnedMessagesPanel({ channelId, onScrollToMessage, onClose }: Props) {
  const qc = useQueryClient()
  const { data: pins = [], isLoading } = useQuery({
    queryKey: ['pins', channelId],
    queryFn: () => getPins(channelId),
  })

  const unpinMut = useMutation({
    mutationFn: (messageId: string) => unpinMessage(channelId, messageId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pins', channelId] }),
  })

  return (
    <div className="w-80 shrink-0 flex flex-col border-l border-black/20 bg-discord-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-black/20 shrink-0">
        <div className="flex items-center gap-2 font-bold text-sm">
          <Icon name="pin" size={16} className="text-discord-muted" />
          Pinned Messages
        </div>
        <button
          onClick={onClose}
          className="text-discord-muted hover:text-discord-text transition-colors"
          title="Close"
        >
          <Icon name="x" size={18} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-discord-muted">
            <Icon name="loader" size={20} className="animate-spin" />
          </div>
        )}
        {!isLoading && pins.length === 0 && (
          <div className="text-center py-8">
            <Icon name="pin" size={32} className="text-discord-muted mx-auto mb-2" />
            <p className="text-discord-muted text-sm">No pinned messages yet.</p>
            <p className="text-discord-muted text-xs mt-1">Pin important messages using the message toolbar.</p>
          </div>
        )}
        {pins.map((pin) => (
          <div key={pin.id} className="bg-discord-sidebar rounded-lg p-3 group relative">
            {/* Pinned-by line */}
            <div className="flex items-center gap-1.5 mb-2 text-xs text-discord-muted">
              <Icon name="pin" size={11} className="text-discord-mention" />
              <span>
                Pinned by <span className="font-semibold">{pin.pinned_by.username}</span>
                {' · '}
                {format(new Date(pin.pinned_at), 'dd/MM/yyyy')}
              </span>
              <button
                className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-discord-muted hover:text-red-400"
                title="Unpin"
                onClick={() => unpinMut.mutate(pin.message.id)}
              >
                <Icon name="x" size={12} />
              </button>
            </div>

            {/* Message preview */}
            <div className="flex items-start gap-2">
              <UserAvatar user={pin.message.author} size={28} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className="text-sm font-semibold text-discord-text">{pin.message.author.username}</span>
                  <span className="text-[10px] text-discord-muted">{format(new Date(pin.message.created_at), 'HH:mm')}</span>
                </div>
                <p className="text-sm text-discord-text leading-snug line-clamp-4 break-words">
                  {pin.message.is_deleted
                    ? <em className="text-discord-muted">Message was deleted</em>
                    : pin.message.content}
                </p>
              </div>
            </div>

            {/* Jump button */}
            {onScrollToMessage && !pin.message.is_deleted && (
              <button
                className="mt-2 text-[11px] text-discord-mention hover:underline"
                onClick={() => { onScrollToMessage(pin.message.id); onClose() }}
              >
                Jump to message →
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
