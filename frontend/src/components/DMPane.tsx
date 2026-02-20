import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDMs, sendDM } from '../api/dms'
import { getUser } from '../api/users'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { UserAvatar } from './UserAvatar'
import { StatusIndicator } from './StatusIndicator'
import { useWebSocket } from '../hooks/useWebSocket'
import type { DM } from '../api/types'
import { format } from 'date-fns'

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

export function DMPane() {
  const { dmUserId } = useParams<{ dmUserId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const closePreview = useCallback(() => setPreviewUrl(null), [])

  const { data: dms = [] } = useQuery({ queryKey: ['dms', dmUserId], queryFn: () => getDMs(dmUserId!), enabled: !!dmUserId })
  const { data: otherUser } = useQuery({ queryKey: ['user', dmUserId], queryFn: () => getUser(dmUserId!), enabled: !!dmUserId })

  useWebSocket(dmUserId ? `/ws/me` : '', {
    enabled: !!dmUserId,
    onMessage(msg) {
      if (msg.type === 'dm.created' || msg.type === 'dm.deleted') {
        qc.invalidateQueries({ queryKey: ['dms', dmUserId] })
      }
    },
  })

  const sendMut = useMutation({
    mutationFn: () => sendDM(dmUserId!, text),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dms', dmUserId] }); setText('') },
  })

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [dms.length])

  if (!dmUserId) return <div className="flex-1 flex items-center justify-center text-discord-muted">Select a conversation</div>

  return (
    <>
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-black/20 shadow-sm shrink-0">
        <div className="relative">
          <UserAvatar user={otherUser ?? null} size={32} />
          {otherUser && <span className="absolute -bottom-0.5 -right-0.5"><StatusIndicator status={otherUser.status} size={10} /></span>}
        </div>
        <span className="font-bold">{otherUser?.username ?? '…'}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-2">
        {dms.map((dm) => (
          <div key={dm.id} className={`flex gap-3 px-4 py-0.5 hover:bg-white/[0.03]`}>
            <div className="text-xs text-discord-muted mt-1 w-10 shrink-0 text-right">
              {format(new Date(dm.created_at), 'HH:mm')}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm break-words ${dm.sender.id === dmUserId ? 'text-discord-muted' : 'text-discord-text'}`}>
                {dm.content}
              </p>
              {dm.attachments?.map((att) => {
                const filename = att.file_path.split('/').pop() ?? att.file_path
                const url = `/api/static/${att.file_path}`
                return (
                  <div key={att.id} className="mt-1">
                    {att.file_type === 'image' ? (
                      <img
                        src={url}
                        alt={filename}
                        className="max-w-xs max-h-64 rounded object-cover cursor-zoom-in hover:brightness-90 transition"
                        onClick={() => setPreviewUrl(url)}
                      />
                    ) : (
                      <a href={url} target="_blank" rel="noreferrer" className="text-discord-mention underline text-sm">
                        📎 {filename}
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4">
        <div className="flex items-end gap-2 bg-discord-input rounded-lg px-3 py-2">
          <textarea
            className="flex-1 bg-transparent resize-none outline-none text-sm text-discord-text placeholder:text-discord-muted max-h-36"
            rows={1}
            value={text}
            placeholder={`Message ${otherUser?.username ?? '…'}`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim()) sendMut.mutate() } }}
          />
        </div>
      </div>
    </div>
    {previewUrl && <ImagePreviewModal url={previewUrl} onClose={closePreview} />}
    </>
  )
}
