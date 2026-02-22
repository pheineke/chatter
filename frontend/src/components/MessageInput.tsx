import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { sendMessage, uploadAttachment } from '../api/messages'
import { getMembers } from '../api/servers'
import { Icon } from './Icon'
import { EmojiPicker } from './EmojiPicker'
import { UserAvatar } from './UserAvatar'
import type { Message, Member } from '../api/types'

const TYPING_THROTTLE_MS = 8_000  // retransmit at most every 8s while typing (Discord-style)

interface Props {
  channelId: string
  serverId?: string
  placeholder?: string
  replyTo?: Message | null
  onCancelReply?: () => void
  onTyping?: () => void
  /** slowmode_delay in seconds from the channel settings; 0 = disabled */
  slowmodeDelay?: number
}

/** Scan backwards from `cursorPos` in `text` to find an active @ trigger.
 *  Returns { query, triggerStart } if we're inside an @-mention, or null. */
function findMentionTrigger(text: string, cursorPos: number): { query: string; triggerStart: number } | null {
  // Search backwards for @ that isn't preceded by a word character
  let i = cursorPos - 1
  while (i >= 0 && text[i] !== '@' && text[i] !== ' ' && text[i] !== '\n') i--
  if (i < 0 || text[i] !== '@') return null
  // Make sure @ is at start of input or preceded by whitespace
  if (i > 0 && text[i - 1] !== ' ' && text[i - 1] !== '\n') return null
  const query = text.slice(i + 1, cursorPos)
  // Don't trigger autocomplete if query contains spaces
  if (query.includes(' ')) return null
  return { query: query.toLowerCase(), triggerStart: i }
}

export function MessageInput({ channelId, serverId, placeholder = 'Send a message…', replyTo, onCancelReply, onTyping, slowmodeDelay = 0 }: Props) {
  const [text, setText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ x: number; y: number } | null>(null)
  const qc = useQueryClient()
  const lastTypingSent = useRef(0)

  // Cooldown state: timestamp (ms) when the user is allowed to send again
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [cooldownSecs, setCooldownSecs] = useState(0)

  // Tick the countdown every second
  useEffect(() => {
    if (!cooldownUntil) return
    const tick = () => {
      const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000)
      if (remaining <= 0) {
        setCooldownUntil(null)
        setCooldownSecs(0)
      } else {
        setCooldownSecs(remaining)
      }
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [cooldownUntil])

  const inCooldown = cooldownSecs > 0

  // @mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionTriggerStart, setMentionTriggerStart] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionListRef = useRef<HTMLDivElement>(null)

  // Load server members (uses cached data if already fetched by MemberSidebar)
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', serverId],
    queryFn: () => getMembers(serverId!),
    enabled: !!serverId,
    staleTime: 60_000,
  })

  // Filter members by current mention query
  const mentionCandidates = mentionQuery !== null
    ? members
        .filter((m) => m.user.username.toLowerCase().startsWith(mentionQuery))
        .slice(0, 8)
    : []

  // Throttled typing emit
  const emitTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastTypingSent.current > TYPING_THROTTLE_MS) {
      lastTypingSent.current = now
      onTyping?.()
    }
  }, [onTyping])

  // Auto-focus textarea when entering reply mode
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus()
  }, [replyTo])

  const sendMut = useMutation({
    mutationFn: (content: string) => sendMessage(channelId, content, replyTo?.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', channelId] })
      onCancelReply?.()
      // Start client-side cooldown so the user sees the countdown immediately
      if (slowmodeDelay > 0) {
        setCooldownUntil(Date.now() + slowmodeDelay * 1000)
      }
    },
    onError: (err) => {
      // Handle 429 from both global rate-limiter and per-channel slowmode
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        const retryAfter = Number(err.response.headers?.['retry-after'] ?? 5)
        setCooldownUntil(Date.now() + retryAfter * 1000)
      }
    },
  })

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const msg = await sendMessage(channelId, null)
      return uploadAttachment(channelId, msg.id, file)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', channelId] }),
  })

  function handleSend() {
    if (inCooldown) return
    const trimmed = text.trim()
    if (!trimmed) return
    sendMut.mutate(trimmed)
    setText('')
    setMentionQuery(null)
  }

  function selectMention(member: Member) {
    const ta = textareaRef.current
    const cursorPos = ta?.selectionStart ?? text.length
    const before = text.slice(0, mentionTriggerStart)
    const after = text.slice(cursorPos)
    const inserted = `@${member.user.username} `
    const next = before + inserted + after
    setText(next)
    setMentionQuery(null)
    setMentionIndex(0)
    requestAnimationFrame(() => {
      ta?.focus()
      const pos = before.length + inserted.length
      ta?.setSelectionRange(pos, pos)
    })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Intercept keyboard nav when mention dropdown is open
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % mentionCandidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectMention(mentionCandidates[mentionIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionQuery(null)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Escape' && replyTo) {
      onCancelReply?.()
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
    setEmojiPickerPos({ x: rect.left, y: rect.top - 4 })
  }

  return (
    <div className="px-4 pb-4 relative">
      {/* @mention autocomplete dropdown */}
      {mentionQuery !== null && mentionCandidates.length > 0 && (
        <div
          ref={mentionListRef}
          className="absolute bottom-full mb-1 left-4 right-4 bg-discord-sidebar border border-white/10 rounded-lg shadow-xl overflow-hidden z-50"
        >
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-discord-muted tracking-wider border-b border-white/5">
            Members — {mentionQuery ? `matching "@${mentionQuery}"` : 'all'}
          </div>
          {mentionCandidates.map((m, idx) => (
            <button
              key={m.user_id}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors
                ${idx === mentionIndex ? 'bg-discord-mention/20 text-discord-text' : 'text-discord-muted hover:bg-white/5 hover:text-discord-text'}`}
              onMouseEnter={() => setMentionIndex(idx)}
              onMouseDown={(e) => { e.preventDefault(); selectMention(m) }}
            >
              <UserAvatar user={m.user} size={24} />
              <span className="font-semibold">{m.user.username}</span>
              {m.roles.length > 0 && (
                <span className="text-xs text-discord-muted truncate ml-auto">
                  {m.roles[0].name}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Slowmode banner */}
      {inCooldown && (
        <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-1.5 mb-1.5 text-xs text-yellow-300">
          <Icon name="clock" size={13} className="shrink-0" />
          <span>Slowmode — you can send another message in <strong>{cooldownSecs}s</strong></span>
        </div>
      )}

      {/* Reply banner */}
      {replyTo && (
        <div className="flex items-center gap-2 bg-discord-input/60 rounded-t-lg px-3 py-1.5 text-xs text-discord-muted border-b border-white/5">
          <Icon name="corner-up-left" size={13} className="text-discord-mention shrink-0" />
          <span>
            Replying to{' '}
            <span className="font-semibold text-discord-text">{replyTo.author.username}</span>
            {' — '}
            <span className="truncate italic">
              {(replyTo.content ?? '').length > 80 ? (replyTo.content ?? '').slice(0, 80) + '…' : (replyTo.content ?? '')}
            </span>
          </span>
          <button
            onClick={onCancelReply}
            className="ml-auto text-discord-muted hover:text-red-400 transition-colors shrink-0"
            title="Cancel reply"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      <div className={`flex bg-discord-input ${replyTo ? 'rounded-b-lg' : 'rounded-lg'} px-3 py-2.5`}>
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
          className={`flex-1 bg-transparent resize-none outline-none text-sm text-discord-text placeholder:text-discord-muted max-h-36 leading-6 py-0 mx-2 ${inCooldown ? 'opacity-50 cursor-not-allowed' : ''}`}
          rows={1}
          value={text}
          placeholder={inCooldown ? `Slowmode — wait ${cooldownSecs}s…` : placeholder}
          disabled={inCooldown}
          onChange={(e) => {
            const newText = e.target.value
            setText(newText)
            e.target.style.height = 'auto'
            e.target.style.height = `${e.target.scrollHeight}px`
            emitTyping()

            // @mention detection
            const cursor = e.target.selectionStart ?? newText.length
            const trigger = findMentionTrigger(newText, cursor)
            if (trigger && serverId) {
              setMentionQuery(trigger.query)
              setMentionTriggerStart(trigger.triggerStart)
              setMentionIndex(0)
            } else {
              setMentionQuery(null)
            }
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
          disabled={!text.trim() || sendMut.isPending || inCooldown}
          className="text-discord-muted hover:text-discord-text disabled:opacity-30 transition-colors shrink-0 mt-[2px]"
          title={inCooldown ? `Slowmode — wait ${cooldownSecs}s` : 'Send'}
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
