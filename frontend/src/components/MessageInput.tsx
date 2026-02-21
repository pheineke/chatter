import { useState, useRef, type KeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sendMessage, uploadAttachment } from '../api/messages'
import { Icon } from './Icon'
import { EmojiPicker } from './EmojiPicker'

interface Props {
  channelId: string
  placeholder?: string
}

export function MessageInput({ channelId, placeholder = 'Send a message…' }: Props) {
  const [text, setText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ x: number; y: number } | null>(null)
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

  function insertEmoji(emoji: string) {
    const ta = textareaRef.current
    if (!ta) {
      setText((t) => t + emoji)
      return
    }
    const start = ta.selectionStart ?? text.length
    const end = ta.selectionEnd ?? text.length
    const next = text.slice(0, start) + emoji + text.slice(end)
    setText(next)
    // Restore focus and cursor after state update
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + emoji.length
      ta.setSelectionRange(pos, pos)
    })
  }

  function toggleEmojiPicker() {
    if (emojiPickerPos) {
      setEmojiPickerPos(null)
      return
    }
    const btn = emojiButtonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    // Open upward above the input bar
    setEmojiPickerPos({ x: rect.left, y: rect.top - 4 })
  }

  return (
    <div className="px-4 pb-4">
      <div className="flex bg-discord-input rounded-lg px-3 py-2.5">
        {/* Attachment button */}
        <button
          title="Attach File"
          onClick={() => fileRef.current?.click()}
          className="text-discord-muted hover:text-discord-text transition-colors shrink-0 mt-[2px]"
        >
          <Icon name="attach-2" size={20} />
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />

        {/* Text area */}
        <textarea
          ref={textareaRef}
          className="flex-1 bg-transparent resize-none outline-none text-sm text-discord-text placeholder:text-discord-muted max-h-36 leading-6 py-0 mx-2"
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

        {/* Emoji picker button */}
        <button
          ref={emojiButtonRef}
          title="Emoji"
          onClick={toggleEmojiPicker}
          className="text-discord-muted hover:text-discord-text transition-colors shrink-0 mt-[2px] mx-1"
        >
          <Icon name="smiling-face" size={20} />
        </button>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!text.trim() || sendMut.isPending}
          className="text-discord-muted hover:text-discord-text disabled:opacity-30 transition-colors shrink-0 mt-[2px]"
          title="Send"
        >
          <Icon name="paper-plane" size={20} />
        </button>
      </div>

      {emojiPickerPos && (
        <EmojiPicker
          position={emojiPickerPos}
          onPick={(emoji) => { insertEmoji(emoji); setEmojiPickerPos(null) }}
          onClose={() => setEmojiPickerPos(null)}
        />
      )}
    </div>
  )
}
