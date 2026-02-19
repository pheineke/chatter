import { format, isToday, isYesterday } from 'date-fns'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { editMessage, deleteMessage, addReaction, removeReaction } from '../api/messages'
import { UserAvatar } from './UserAvatar'
import { Icon } from './Icon'
import type { Message } from '../api/types'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  message: Message
  channelId: string
  /** If true, collapse the header (same author, within 7 min of previous) */
  compact?: boolean
}

function formatTime(iso: string) {
  const d = new Date(iso)
  if (isToday(d)) return format(d, 'HH:mm')
  if (isYesterday(d)) return `Yesterday ${format(d, 'HH:mm')}`
  return format(d, 'dd/MM/yyyy HH:mm')
}

/** Render plain text content, turning @mention spans blue. */
function Content({ text, html }: { text: string; html?: string }) {
  if (html) return <span dangerouslySetInnerHTML={{ __html: html }} />
  // Highlight @Username mentions
  const parts = text.split(/(@\w+)/g)
  return (
    <>
      {parts.map((p, i) =>
        /^@\w+$/.test(p) ? (
          <span key={i} className="mention">{p}</span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

export function MessageBubble({ message: msg, channelId, compact = false }: Props) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isOwn = user?.id === msg.author.id
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(msg.content)
  const [hovered, setHovered] = useState(false)

  const editMut = useMutation({
    mutationFn: () => editMessage(channelId, msg.id, editText),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', channelId] })
      setEditing(false)
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteMessage(channelId, msg.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', channelId] }),
  })

  const reactMut = useMutation({
    mutationFn: (emoji: string) => addReaction(channelId, msg.id, emoji),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', channelId] }),
  })

  const unreactMut = useMutation({
    mutationFn: (emoji: string) => removeReaction(channelId, msg.id, emoji),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', channelId] }),
  })

  return (
    <div
      className={`group flex gap-3 px-4 py-0.5 hover:bg-white/[0.03] relative ${compact ? 'mt-0' : 'mt-3'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar / timestamp column */}
      <div className="w-10 shrink-0 flex justify-center">
        {compact ? (
          <span className="text-[10px] text-discord-muted opacity-0 group-hover:opacity-100 mt-1 leading-tight select-none">
            {format(new Date(msg.created_at), 'HH:mm')}
          </span>
        ) : (
          <UserAvatar user={msg.author} size={40} className="mt-0.5" />
        )}
      </div>

      {/* Content column */}
      <div className="flex-1 min-w-0">
        {!compact && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="font-semibold text-white hover:underline cursor-pointer">
              {msg.author.username}
            </span>
            <span className="text-xs text-discord-muted">{formatTime(msg.created_at)}</span>
          </div>
        )}

        {editing ? (
          <div>
            <textarea
              className="input w-full resize-none text-sm"
              rows={2}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); editMut.mutate() }
                if (e.key === 'Escape') setEditing(false)
              }}
              autoFocus
            />
            <div className="text-xs text-discord-muted mt-1">
              Enter to save · Esc to cancel
            </div>
          </div>
        ) : (
          <p className="text-sm text-discord-text break-words whitespace-pre-wrap leading-relaxed">
            <Content text={msg.content} />
          </p>
        )}

        {/* Attachments */}
        {msg.attachments?.map((att) => {
          const filename = att.file_path.split('/').pop() ?? att.file_path
          const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(att.file_path)
          return (
            <div key={att.id} className="mt-1">
              {isImage ? (
                <img src={`/api/attachments/${att.id}`} alt={filename} className="max-w-xs max-h-64 rounded object-cover" />
              ) : (
                <a href={`/api/attachments/${att.id}`} target="_blank" rel="noreferrer" className="text-discord-mention underline text-sm">
                  📎 {filename}
                </a>
              )}
            </div>
          )
        })}

        {/* Reactions – group by emoji */}
        {msg.reactions?.length > 0 && (() => {
          const grouped = msg.reactions.reduce<Record<string, { count: number; me: boolean }>>((acc, r) => {
            if (!acc[r.emoji]) acc[r.emoji] = { count: 0, me: false }
            acc[r.emoji].count++
            if (r.user_id === user?.id) acc[r.emoji].me = true
            return acc
          }, {})
          return (
            <div className="flex flex-wrap gap-1 mt-1">
              {Object.entries(grouped).map(([emoji, { count, me }]) => (
                <button
                  key={emoji}
                  onClick={() => (me ? unreactMut.mutate(emoji) : reactMut.mutate(emoji))}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors
                    ${me ? 'bg-discord-mention/20 border-discord-mention' : 'bg-discord-input border-transparent hover:border-discord-mention/50'}`}
                >
                  <span>{emoji}</span>
                  <span className="text-discord-text">{count}</span>
                </button>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Action toolbar on hover */}
      {hovered && (
        <div className="absolute right-4 top-0 -translate-y-1/2 flex items-center gap-1 bg-discord-sidebar border border-discord-input rounded px-1 py-0.5 shadow-lg">
          <ActionBtn title="React" onClick={() => reactMut.mutate('👍')}><Icon name="smiling-face" size={16} /></ActionBtn>
          {isOwn && <ActionBtn title="Edit" onClick={() => { setEditing(true); setEditText(msg.content) }}><Icon name="edit-2" size={16} /></ActionBtn>}
          {isOwn && <ActionBtn title="Delete" onClick={() => deleteMut.mutate()} className="hover:text-red-400"><Icon name="trash-2" size={16} /></ActionBtn>}
        </div>
      )}
    </div>
  )
}

function ActionBtn({ title, onClick, className = '', children }: { title: string; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`text-discord-muted hover:text-discord-text transition-colors text-sm px-1 ${className}`}
    >
      {children}
    </button>
  )
}
