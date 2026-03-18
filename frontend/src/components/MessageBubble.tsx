import { format, isToday, isYesterday } from 'date-fns'
import { memo, useState, useEffect, useCallback } from 'react'
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
import { MarkdownContent } from './MarkdownContent'
import { LinkEmbed } from './LinkEmbed'
import { extractURLs, getDismissed } from '../utils/embeds'
import { useE2EE } from '../contexts/E2EEContext'

interface Props {
  message: Message
  channelId: string
  /** If this is a DM channel, pass the partner's userId so we can decrypt */
  partnerId?: string
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

export const MessageBubble = memo(function MessageBubble({ message: msg, channelId, partnerId, compact = false, onReply, onScrollToMessage, isPinned = false }: Props) {
  const { user } = useAuth()
  const { blockedIds, block, unblock } = useBlocks()
  const qc = useQueryClient()
  const e2ee = useE2EE()
  const isOwn = user?.id === msg.author.id
  const [showBlocked, setShowBlocked] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(msg.content ?? '')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const closePreview = useCallback(() => setPreviewUrl(null), [])
  const [dismissed, setDismissed] = useState<Set<string>>(() => getDismissed(msg.id))
  const [cardPos, setCardPos] = useState<{ x: number; y: number } | null>(null)
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ x: number; y: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [userContextMenu, setUserContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // E2EE: decrypt the message content if it was sent encrypted
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null)
  const [decryptFailed, setDecryptFailed] = useState(false)

  useEffect(() => {
    if (!msg.is_encrypted || !msg.content || !msg.nonce) return

    // Wait for E2EE to finish initialising — avoid a permanent decryptFailed flag
    // while keys are still loading on first mount.
    if (e2ee.initialising) return

    // Determine who the other party is: if I sent it, they are the DM partner; if they sent it, they are the author
    const otherId = isOwn ? partnerId : msg.author.id
    if (!otherId || !e2ee.isEnabled) {
      setDecryptFailed(true)
      return
    }

    // Reset on every retry so a previous false-fail doesn't persist
    setDecryptFailed(false)
    setDecryptedContent(null)

    let cancelled = false
    e2ee.decryptFromUser(otherId, msg.content, msg.nonce).then(plain => {
      if (cancelled) return
      if (plain === null) setDecryptFailed(true)
      else setDecryptedContent(plain)
    })
    return () => { cancelled = true }
  }, [msg.id, msg.is_encrypted, msg.content, msg.nonce, isOwn, partnerId, e2ee])

  // Effective display content: decrypted (if E2EE), otherwise raw
  const displayContent = msg.is_encrypted
    ? (decryptFailed ? null : decryptedContent)
    : msg.content

  const pinMut = useMutation({
    mutationFn: () => isPinned ? unpinMessage(channelId, msg.id) : pinMessage(channelId, msg.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pins', channelId] }),
    onError: (err: any) => {
      const detail = err?.response?.data?.detail ?? err?.message ?? 'Failed to update pin.'
      setActionError(String(detail))
    },
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
      // message.updated arrives via channel WS and updates the cache in real time
      setEditing(false)
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail ?? err?.message ?? 'Failed to edit message.'
      setActionError(String(detail))
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteMessage(channelId, msg.id),
    // message.deleted arrives via channel WS and removes the message from cache
    onError: (err: any) => {
      const detail = err?.response?.data?.detail ?? err?.message ?? 'Failed to delete message.'
      setActionError(String(detail))
    },
  })

  const reactMut = useMutation({
    mutationFn: (emoji: string) => addReaction(channelId, msg.id, emoji),
    // reaction.added arrives via channel WS
    onError: (err: any) => {
      const detail = err?.response?.data?.detail ?? err?.message ?? 'Failed to add reaction.'
      setActionError(String(detail))
    },
  })

  const unreactMut = useMutation({
    mutationFn: (emoji: string) => removeReaction(channelId, msg.id, emoji),
    // reaction.removed arrives via channel WS
    onError: (err: any) => {
      const detail = err?.response?.data?.detail ?? err?.message ?? 'Failed to remove reaction.'
      setActionError(String(detail))
    },
  })

  // Blocked-user early return (all hooks already called above)
  const isBlocked = !isOwn && blockedIds.has(msg.author.id)
  if (isBlocked && !showBlocked) {
    return (
      <div className={`flex gap-3 px-4 py-0.5 ${compact ? 'mt-0' : 'mt-3'}`}>
        <div className="w-10 shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="text-xs text-sp-muted italic">Blocked message</span>
          <span className="text-sp-muted text-xs">—</span>
          <button
            onClick={() => setShowBlocked(true)}
            className="text-xs text-sp-muted underline hover:text-sp-text transition-colors"
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
      className={`group flex gap-3 px-4 py-0.5 hover:bg-sp-hover/40 relative ${compact ? 'mt-0' : 'mt-3'}`}
      onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }) }}
    >
      {/* Avatar / timestamp column */}
      <div 
        className="w-10 shrink-0 flex justify-center select-none"
        onContextMenu={(e) => {
           if (!compact) {
             e.preventDefault()
             e.stopPropagation()
             setUserContextMenu({ x: e.clientX, y: e.clientY })
           }
        }}
      >
        {compact ? (
          <div className="flex items-center justify-center h-full opacity-0 group-hover:opacity-100 transition-opacity select-none gap-0.5">
            <span className="text-[10px] text-sp-muted leading-tight">
              {format(new Date(msg.created_at), 'HH:mm')}
            </span>
            {msg.is_encrypted && decryptedContent && (
              <span className="text-sp-muted" title="End-to-End Encrypted">
                <Icon name="lock" size={10} />
              </span>
            )}
          </div>
        ) : (
          <button 
            className="cursor-pointer" 
            onClick={handleUserClick}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setUserContextMenu({ x: e.clientX, y: e.clientY })
            }}
            aria-label={`Open ${msg.author.username} profile`}
          >
            <UserAvatar user={msg.author} size={40} className="mt-0.5" />
          </button>
        )}
      </div>

      {/* Content column */}
      <div className="flex-1 min-w-0">
        {/* Reply header - quoted reference */}
        {msg.reply_to_id && (
          <button
            className="flex items-center gap-1.5 text-xs text-sp-muted mb-0.5 max-w-full hover:text-sp-text transition-colors cursor-pointer text-left"
            onClick={() => msg.reply_to && onScrollToMessage?.(msg.reply_to.id)}
            title={msg.reply_to ? 'Jump to original message' : undefined}
          >
            <Icon name="corner-up-left" size={11} className="shrink-0 text-sp-muted/70" />
            {msg.reply_to && !msg.reply_to.is_deleted ? (
              <>
                <UserAvatar user={msg.reply_to.author} size={16} className="rounded-full shrink-0" />
                <span className="font-medium text-sp-text/80">{msg.reply_to.author.username}</span>
                <span className="truncate italic opacity-70">
                  {msg.reply_to.content
                    ? (msg.reply_to.content.length > 80 ? msg.reply_to.content.slice(0, 80) + '…' : msg.reply_to.content)
                    : 'Attachment'}
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
              className="font-semibold text-sp-text hover:underline cursor-pointer"
              onClick={handleUserClick}
              onContextMenu={(e) => {
                 e.preventDefault()
                 e.stopPropagation()
                 setUserContextMenu({ x: e.clientX, y: e.clientY })
              }}
            >
              {msg.author_nickname ?? msg.author.username}
            </span>
            <span className="text-xs text-sp-muted">{formatTime(msg.created_at)}</span>
            {msg.is_encrypted && decryptedContent && (
              <span className="text-[10px] text-sp-online/80 font-medium select-none flex items-center gap-0.5" title="End-to-End Encrypted">
                <Icon name="lock" size={10} />
                E2EE
              </span>
            )}
          </div>
        )}

        {editing ? (
          <div>
            <textarea
              className="input w-full resize-none text-sm"
              rows={2}
              value={editText}
              maxLength={2000}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); editMut.mutate() }
                if (e.key === 'Escape') setEditing(false)
              }}
              autoFocus
            />
            <div className="text-xs text-sp-muted mt-1">
              Enter to save · Esc to cancel
            </div>
          </div>
        ) : (
          <div className="text-sm break-words leading-relaxed text-sp-text max-w-full">
            {msg.is_encrypted && !decryptedContent && !decryptFailed && (
              <span className="text-sp-muted italic text-xs flex items-center gap-1">
                <Icon name="lock" size={11} />
                Decrypting…
              </span>
            )}
            {msg.is_encrypted && decryptFailed && (
              <span className="text-red-400 italic text-xs flex items-center gap-1">
                <Icon name="lock" size={11} />
                Could not decrypt message (key mismatch or missing)
              </span>
            )}
            {displayContent && <MarkdownContent text={displayContent} />}
          </div>
        )}
        {msg.is_edited && (
          <span className="text-[11px] text-sp-muted ml-1 select-none" title={msg.edited_at ? `Edited ${formatTime(msg.edited_at)}` : 'Edited'}>(edited)</span>
        )}

        {/* URL / image embeds */}
        {!editing && displayContent && (() => {
          const urls = extractURLs(displayContent)
          if (urls.length === 0) return null
          return (
            <div className="flex flex-col items-start gap-1">
              {urls.map(({ url, isImage }) => (
                <LinkEmbed
                  key={url}
                  url={url}
                  isImage={isImage}
                  messageId={msg.id}
                  dismissed={dismissed}
                  onDismiss={(u) => setDismissed(prev => new Set([...prev, u]))}
                />
              ))}
            </div>
          )
        })()}

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
                  className="inline-flex items-center gap-2 bg-sp-input rounded-sp-sm px-3 py-2 text-sm hover:bg-sp-hover transition"
                >
                  <Icon name="file" size={18} className="text-sp-muted shrink-0" />
                  <span className="text-sp-mention underline truncate max-w-[200px]">{displayName}</span>
                  {att.file_size != null && (
                    <span className="text-sp-muted text-xs shrink-0">{formatFileSize(att.file_size)}</span>
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
                    ${me ? 'bg-sp-mention/20 border-sp-mention' : 'bg-sp-input border-transparent hover:border-sp-mention/50'}`}
                >
                  <span>{emoji}</span>
                  <span className="text-sp-text">{count}</span>
                </button>
              ))}
            </div>
          )
        })()}

        {actionError && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400">
            <Icon name="alert-circle" size={12} />
            <span className="truncate">{actionError}</span>
            <button className="ml-auto text-sp-muted hover:text-sp-text" onClick={() => setActionError(null)}>
              <Icon name="x" size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Action toolbar on hover */}
      <div className="absolute right-4 top-0 -translate-y-1/2 flex items-center gap-1 bg-sp-popup border border-sp-divider/60 rounded-sp-sm px-1 py-0.5 shadow-sp-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
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
            className={isPinned ? 'text-sp-mention' : ''}
          >
            <Icon name="pin" size={16} />
          </ActionBtn>
          {isOwn && <ActionBtn title="Edit" onClick={() => { setEditing(true); setEditText(displayContent ?? msg.content ?? '') }}><Icon name="edit-2" size={16} /></ActionBtn>}
          {isOwn && <ActionBtn title="Delete" onClick={() => deleteMut.mutate()} className="hover:text-red-400"><Icon name="trash-2" size={16} /></ActionBtn>}
      </div>
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
              onClick: () => { setEditing(true); setEditText(displayContent ?? msg.content ?? ''); setContextMenu(null) },
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
    {userContextMenu && (
      <ContextMenu
        x={userContextMenu.x}
        y={userContextMenu.y}
        onClose={() => setUserContextMenu(null)}
        items={[
           {
             label: 'Profile',
             icon: 'user',
             onClick: () => {
               setCardPos({ x: userContextMenu.x, y: userContextMenu.y })
             }
           },
           { separator: true },
           {
             label: 'Copy User ID',
             icon: 'copy',
             onClick: () => navigator.clipboard.writeText(msg.author.id)
           },
           { separator: true },
           (!isOwn) ? {
              label: blockedIds.has(msg.author.id) ? 'Unblock' : 'Block',
              icon: 'slash',
              danger: true,
              onClick: () => {
                if (blockedIds.has(msg.author.id)) unblock(msg.author.id)
                else block(msg.author.id)
                setUserContextMenu(null)
              }
           } : null
        ].filter(Boolean) as any}
      />
    )}
  </>
  )
})

function ActionBtn({ title, onClick, className = '', children }: { title: string; onClick: (e: React.MouseEvent) => void; className?: string; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`text-sp-muted hover:text-sp-text transition-colors text-sm px-1 ${className}`}
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
