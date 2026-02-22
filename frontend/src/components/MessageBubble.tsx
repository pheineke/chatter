import { format, isToday, isYesterday } from 'date-fns'
import { useState, useEffect, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { editMessage, deleteMessage, addReaction, removeReaction, pinMessage, unpinMessage } from '../api/messages'
import { UserAvatar } from './UserAvatar'
import { Icon } from './Icon'
import { ProfileCard } from './ProfileCard'
import { EmojiPicker } from './EmojiPicker'
import { ContextMenu } from './ContextMenu'
import type { Message } from '../api/types'
import { useAuth } from '../contexts/AuthContext'
import { useBlocks } from '../hooks/useBlocks'
import { Linkified } from '../utils/linkify'

interface Props {
  message: Message
  channelId: string
  /** If true, collapse the header (same author, within 7 min of previous) */
  compact?: boolean
  /** Called when the user clicks Reply on this message */
  onReply?: (msg: Message) => void
  /** Called with a message id to scroll to it (provided by MessageList) */
  onScrollToMessage?: (id: string) => void
  /** Whether the message is currently pinned */
  isPinned?: boolean
}

function formatTime(iso: string) {
  const d = new Date(iso)
  if (isToday(d)) return format(d, 'HH:mm')
  if (isYesterday(d)) return `Yesterday ${format(d, 'HH:mm')}`
  return format(d, 'dd/MM/yyyy HH:mm')
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Render plain text content, turning @mentions blue and URLs into links. */
function Content({ text }: { text: string }) {
  return <Linkified text={text} />
}

export function MessageBubble({ message: msg, channelId, compact = false, onReply, onScrollToMessage, isPinned = false }: Props) {
  const { user } = useAuth()
  const { blockedIds } = useBlocks()
  const qc = useQueryClient()
  const isOwn = user?.id === msg.author.id
  const [showBlocked, setShowBlocked] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(msg.content ?? '')
  const [hovered, setHovered] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const closePreview = useCallback(() => setPreviewUrl(null), [])
  const [cardPos, setCardPos] = useState<{ x: number; y: number } | null>(null)
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ x: number; y: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const pinMut = useMutation({
    mutationFn: () => isPinned ? unpinMessage(channelId, msg.id) : pinMessage(channelId, msg.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pins', channelId] }),
  })

  const handleUserClick = useCallback((e: React.MouseEvent) => {
     e.stopPropagation()
     const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
     // Spawn slightly to the right/bottom
     setCardPos({ x: rect.right + 12, y: rect.top })
  }, [])

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

  // Blocked-user early return (all hooks already called above)
  const isBlocked = !isOwn && blockedIds.has(msg.author.id)
  if (isBlocked && !showBlocked) {
    return (
      <div className={`flex gap-3 px-4 py-0.5 ${compact ? 'mt-0' : 'mt-3'}`}>
        <div className="w-10 shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="text-xs text-discord-muted italic">Blocked message</span>
          <span className="text-discord-muted text-xs">—</span>
          <button
            onClick={() => setShowBlocked(true)}
            className="text-xs text-discord-muted underline hover:text-discord-text transition-colors"
          >
            Show message
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
    <div
      className={`group flex gap-3 px-4 py-0.5 hover:bg-white/[0.03] relative ${compact ? 'mt-0' : 'mt-3'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }) }}
    >
      {/* Avatar / timestamp column */}
      <div className="w-10 shrink-0 flex justify-center select-none cursor-pointer" onClick={handleUserClick}>
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
        {/* Reply header - quoted reference */}
        {msg.reply_to_id && (
          <button
            className="flex items-center gap-1.5 text-xs text-discord-muted mb-0.5 max-w-full hover:text-discord-text transition-colors cursor-pointer text-left"
            onClick={() => msg.reply_to && onScrollToMessage?.(msg.reply_to.id)}
            title={msg.reply_to ? 'Jump to original message' : undefined}
          >
            <Icon name="corner-up-left" size={11} className="shrink-0 text-discord-muted/70" />
            {msg.reply_to && !msg.reply_to.is_deleted ? (
              <>
                <UserAvatar user={msg.reply_to.author} size={16} className="rounded-full shrink-0" />
                <span className="font-medium text-discord-text/80">{msg.reply_to.author.username}</span>
                <span className="truncate italic opacity-70">
                  {msg.reply_to.content
                    ? (msg.reply_to.content.length > 80 ? msg.reply_to.content.slice(0, 80) + '…' : msg.reply_to.content)
                    : '📎 Attachment'}
                </span>
              </>
            ) : (
              <span className="italic opacity-50">Original message was deleted</span>
            )}
          </button>
        )}

        {!compact && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span 
              className="font-semibold text-white hover:underline cursor-pointer"
              onClick={handleUserClick}
            >
              {msg.author_nickname ?? msg.author.username}
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
            {msg.content && <Content text={msg.content} />}
            {msg.is_edited && (
              <span className="text-[11px] text-discord-muted ml-1 select-none" title={msg.edited_at ? `Edited ${formatTime(msg.edited_at)}` : 'Edited'}>(edited)</span>
            )}
          </p>
        )}

        {/* Attachments */}
        {msg.attachments?.map((att) => {
          const displayName = att.filename ?? att.file_path.split('/').pop() ?? att.file_path
          const url = `/api/static/${att.file_path}`
          return (
            <div key={att.id} className="mt-1">
              {att.file_type === 'image' ? (
                <img
                  src={url}
                  alt={displayName}
                  width={att.width ?? undefined}
                  height={att.height ?? undefined}
                  className="max-w-xs max-h-64 rounded object-cover cursor-zoom-in hover:brightness-90 transition"
                  style={att.width && att.height ? { aspectRatio: `${att.width}/${att.height}` } : undefined}
                  onClick={() => setPreviewUrl(url)}
                />
              ) : (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  download={displayName}
                  className="inline-flex items-center gap-2 bg-discord-sidebar rounded px-3 py-2 text-sm hover:bg-white/10 transition"
                >
                  <span className="text-discord-muted text-lg">📎</span>
                  <span className="text-discord-mention underline truncate max-w-[200px]">{displayName}</span>
                  {att.file_size != null && (
                    <span className="text-discord-muted text-xs shrink-0">{formatFileSize(att.file_size)}</span>
                  )}
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
          <ActionBtn
            title="Add Reaction"
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setEmojiPickerPos({ x: rect.left, y: rect.bottom + 4 })
            }}
          >
            <Icon name="smiling-face" size={16} />
          </ActionBtn>
          <ActionBtn title="Reply" onClick={() => onReply?.(msg)}>
            <Icon name="corner-up-left" size={16} />
          </ActionBtn>
          <ActionBtn
            title={isPinned ? 'Unpin' : 'Pin'}
            onClick={() => pinMut.mutate()}
            className={isPinned ? 'text-discord-mention' : ''}
          >
            <Icon name="pin" size={16} />
          </ActionBtn>
          {isOwn && <ActionBtn title="Edit" onClick={() => { setEditing(true); setEditText(msg.content ?? '') }}><Icon name="edit-2" size={16} /></ActionBtn>}
          {isOwn && <ActionBtn title="Delete" onClick={() => deleteMut.mutate()} className="hover:text-red-400"><Icon name="trash-2" size={16} /></ActionBtn>}
        </div>
      )}
    </div>
    {previewUrl && <ImagePreviewModal url={previewUrl} onClose={closePreview} />}
    {cardPos && (
      <ProfileCard 
        userId={msg.author.id} 
        onClose={() => setCardPos(null)} 
        position={cardPos}
      />
    )}
    {emojiPickerPos && (
      <EmojiPicker
        position={emojiPickerPos}
        onPick={(emoji) => reactMut.mutate(emoji)}
        onClose={() => setEmojiPickerPos(null)}
      />
    )}
    {contextMenu && (
      <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu(null)}
        items={[
          {
            label: 'Reply',
            icon: 'corner-up-left',
            onClick: () => { onReply?.(msg); setContextMenu(null) },
          },
          {
            label: 'Copy Text',
            icon: 'copy',
            onClick: () => { navigator.clipboard.writeText(msg.content ?? ''); setContextMenu(null) },
          },
          ...(isOwn ? [
            {
              label: 'Edit',
              icon: 'edit-2',
              onClick: () => { setEditing(true); setEditText(msg.content ?? ''); setContextMenu(null) },
            },
            {
              label: 'Delete',
              icon: 'trash-2',
              danger: true as const,
              onClick: () => { deleteMut.mutate(); setContextMenu(null) },
            },
          ] : []),
        ]}
      />
    )}
  </>
  )
}

function ActionBtn({ title, onClick, className = '', children }: { title: string; onClick: (e: React.MouseEvent) => void; className?: string; children: React.ReactNode }) {
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

function ImagePreviewModal({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
      onClick={onClose}
    >
      <img
        src={url}
        alt="Preview"
        className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
