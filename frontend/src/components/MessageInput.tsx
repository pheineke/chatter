import { useState, useRef, type KeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sendMessage, uploadAttachment } from '../api/messages'
import { Icon } from './Icon'

interface Props {
  channelId: string
  placeholder?: string
}

export function MessageInput({ channelId, placeholder = 'Send a message…' }: Props) {
  const [text, setText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const sendMut = useMutation({
    mutationFn: (content: string) => sendMessage(channelId, content),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', channelId] }),
  })

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      // Create a message entry first, then attach the file
      const msg = await sendMessage(channelId, file.name)
      return uploadAttachment(channelId, msg.id, file)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', channelId] }),
  })

  function handleSend() {
    const trimmed = text.trim()
    if (!trimmed) return
    sendMut.mutate(trimmed)
    setText('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadMut.mutate(file)
    e.target.value = ''
  }

  return (
    <div className="px-4 pb-4">
      <div className="flex items-end gap-2 bg-discord-input rounded-lg px-3 py-2.5">
        {/* Attachment button */}
        <button
          title="Attach File"
          onClick={() => fileRef.current?.click()}
          className="text-discord-muted hover:text-discord-text transition-colors shrink-0 self-end pb-[3px]"
        >
          <Icon name="attach-2" size={20} />
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />

        {/* Text area */}
        <textarea
          className="flex-1 bg-transparent resize-none outline-none text-sm text-discord-text placeholder:text-discord-muted max-h-36 leading-5 py-0"
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value)
            // Auto-resize
            e.target.style.height = 'auto'
            e.target.style.height = `${e.target.scrollHeight}px`
          }}
          onKeyDown={handleKeyDown}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!text.trim() || sendMut.isPending}
          className="text-discord-muted hover:text-discord-text disabled:opacity-30 transition-colors shrink-0 self-end pb-[3px]"
          title="Send"
        >
          <Icon name="paper-plane" size={20} />
        </button>
      </div>
    </div>
  )
}
