import { useState, useRef, useEffect, useCallback, useLayoutEffect, type KeyboardEvent } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { sendMessage, uploadAttachment } from '../api/messages'
import { getMembers } from '../api/servers'
import { getCommands, createInteraction } from '../api/interactions'
import { Icon } from './Icon'
import { EmojiPicker } from './EmojiPicker'
import { UserAvatar } from './UserAvatar'
import { useE2EE } from '../contexts/E2EEContext'
import type { Message, Member, ApplicationCommandRead } from '../api/types'

const TYPING_THROTTLE_MS = 8_000  // retransmit at most every 8s while typing (Discord-style)

interface Props {
  channelId: string
  serverId?: string
  /** If set, messages to this DM channel will be end-to-end encrypted */
  partnerId?: string
  placeholder?: string
  replyTo?: Message | null
  onCancelReply?: () => void
  onTyping?: () => void
  /** slowmode_delay in seconds from the channel settings; 0 = disabled */
  slowmodeDelay?: number
  /** When true the input shows a "You are offline" indicator and routes sends to onOfflineSubmit */
  isOffline?: boolean
  /** Called instead of the normal API send when isOffline is true */
  onOfflineSubmit?: (content: string) => void
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

export function MessageInput({ channelId, serverId, partnerId, placeholder = 'Send a message…', replyTo, onCancelReply, onTyping, slowmodeDelay = 0, isOffline = false, onOfflineSubmit }: Props) {
  const MAX_MESSAGE_LEN = 2000
  const [text, setText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ x: number; y: number } | null>(null)
  const qc = useQueryClient()
  const lastTypingSent = useRef(0)
  const e2ee = useE2EE()

  // Cooldown state: timestamp (ms) when the user is allowed to send again
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [cooldownSecs, setCooldownSecs] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const messageSentRef = useRef(false)

  // Auto-shrink textarea when message is cleared
  useLayoutEffect(() => {
    if (text === '' && textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text])

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
  const textLen = text.length
  const overLimit = textLen > MAX_MESSAGE_LEN

  // @mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionTriggerStart, setMentionTriggerStart] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionListRef = useRef<HTMLDivElement>(null)

  // Command autocomplete state
  const [commandQuery, setCommandQuery] = useState<string | null>(null)
  const [commandIndex, setCommandIndex] = useState(0)
  const commandListRef = useRef<HTMLDivElement>(null)

  // Load server members (uses cached data if already fetched by MemberSidebar)
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', serverId],
    queryFn: () => getMembers(serverId || ''),
    enabled: !!serverId,
    staleTime: Infinity,
  })

  // Load commands
  const { data: commands = [] } = useQuery<ApplicationCommandRead[]>({
    queryKey: ['commands', serverId],
    queryFn: () => getCommands(serverId),
    // Stale time effectively infinite for production usually, but we want to see new commands during dev
    staleTime: 10_000, 
    refetchOnWindowFocus: true
  })

  // Filter members by current mention query
  const mentionCandidates = mentionQuery !== null
    ? members
        .filter((m) => m.user.username.toLowerCase().startsWith(mentionQuery))
        .slice(0, 8)
    : []

  // Filter commands by query
  const commandCandidates = commandQuery !== null
    ? commands
        .filter((c) => c.name.toLowerCase().startsWith(commandQuery))
        .slice(0, 8)
    : []
  
  // Reset selected index when candidates change
  useEffect(() => {
    if (commandCandidates.length > 0) setCommandIndex(0)
  }, [commandQuery])

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
    mutationFn: async (content: string) => {
      // Encrypt DM messages if E2EE is ready and a partnerId is supplied
      if (partnerId && e2ee.isEnabled) {
        const encrypted = await e2ee.encryptForUser(partnerId, content)
        if (encrypted) {
          return sendMessage(channelId, null, replyTo?.id, encrypted)
        }
        // Fall through to plaintext if partner has no public key
      }
      return sendMessage(channelId, content, replyTo?.id)
    },
    onSuccess: (_data, _variables) => {
      setText('')
      qc.invalidateQueries({ queryKey: ['messages', channelId] })
      onCancelReply?.()
      // Start client-side cooldown so the user sees the countdown immediately
      if (slowmodeDelay > 0) {
        setCooldownUntil(Date.now() + slowmodeDelay * 1000)
      }
    },
    onError: (err, variables) => {
      // Restore the typed text so the user can retry or edit
      setText(variables)
      // Handle 429 from both global rate-limiter and per-channel slowmode
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        const retryAfter = Number(err.response.headers?.['retry-after'] ?? 5)
        setCooldownUntil(Date.now() + retryAfter * 1000)
        return
      }
      const detail = axios.isAxiosError(err) ? (err.response?.data?.detail ?? err.message) : String(err)
      setUploadError(`Failed to send: ${detail}`)
    },
  })

  const uploadMut = useMutation({
    mutationFn: async ({ file, content }: { file: File; content: string | null }) => {
      messageSentRef.current = false
      // Encrypt the text portion for E2EE DM channels (same logic as sendMut)
      let encrypted: { ciphertext: string; nonce: string } | undefined
      if (partnerId && e2ee.isEnabled && content) {
        const enc = await e2ee.encryptForUser(partnerId, content)
        if (enc) encrypted = enc
      }
      const msg = await sendMessage(channelId, encrypted ? null : content, replyTo?.id, encrypted)
      messageSentRef.current = true
      return uploadAttachment(channelId, msg.id, file)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', channelId] })
      setText('')
      onCancelReply?.()
      setUploadError(null)
      if (slowmodeDelay > 0) {
        setCooldownUntil(Date.now() + slowmodeDelay * 1000)
      }
    },
    onError: (err) => {
      if (messageSentRef.current) {
        // sendMessage succeeded but uploadAttachment failed — message text is visible in chat
        setText('')
        onCancelReply?.()
        const detail = axios.isAxiosError(err) ? (err.response?.data?.detail ?? err.message) : String(err)
        setUploadError(`Attachment failed: ${detail}`)
        qc.invalidateQueries({ queryKey: ['messages', channelId] })
      } else {
        // sendMessage itself failed
        const detail = axios.isAxiosError(err) ? (err.response?.data?.detail ?? err.message) : String(err)
        setUploadError(`Failed to send: ${detail}`)
      }
    },
  })

  // Execute a slash command interaction
  const executeCommand = async (commandName: string, args: string) => {
    // Basic argument parsing: split by space for now
    // In a real implementation this would parse options based on schema
    const options: Record<string, any> = {}
    const cmd = commands.find(c => c.name === commandName)
    if (cmd && args) {
       // "Smart" parsing: if multiple options, parsing is hard. 
       // For 'echo', we assume 'message' is the rest.
       if (cmd.name === 'echo') options['message'] = args.trim()
       else if (cmd.options && cmd.options.length > 0) {
         options[cmd.options[0].name] = args.trim()
       }
    }

    try {
        if (!cmd) throw new Error('Command not found')
        const response = await createInteraction(cmd.id, cmd.name, options, serverId, channelId)
        
        if (response?.data?.flags === 64 && response.data.content) {
          // Ephemeral message injection
          const ephemeralMsg: Message = {
            id: `ephemeral-${Date.now()}`,
            channel_id: channelId,
            content: response.data.content,
            author: { 
              id: 'system', 
              username: 'System', 
              status: 'online', 
              preferred_status: 'online', 
              hide_status: false, 
              created_at: new Date().toISOString(), 
              avatar: null, 
              banner: null, 
              avatar_decoration: null, 
              description: null, 
              custom_status: null,
              pronouns: null, 
              dm_permission: 'everyone' 
            },
            author_nickname: null,
            reply_to_id: null,
            reply_to: null,
            is_deleted: false,
            is_edited: false,
            edited_at: null,
            created_at: new Date().toISOString(),
            attachments: [],
            reactions: [],
            mentions: [],
            is_encrypted: false,
            nonce: null,
            is_ephemeral: true
          }

          qc.setQueryData(['messages', channelId], (old: any) => {
            if (!old) return old
            const [first, ...rest] = old.pages
            return { ...old, pages: [[...(first ?? []), ephemeralMsg], ...rest] }
          })
        }
    } catch (err) {
        setUploadError(`Command failed: ${err}`)
    }
    
    setText('')
    setCommandQuery(null)
  }

  function handleSend() {
    if (inCooldown) return
    const trimmed = text.trim()
    if (!trimmed) return
    if (trimmed.length > MAX_MESSAGE_LEN) {
      setUploadError(`Message is too long (${trimmed.length}/${MAX_MESSAGE_LEN}).`)
      return
    }

    // Check for slash command
    if (trimmed.startsWith('/')) {
        const parts = trimmed.slice(1).split(' ')
        const cmdName = parts[0]
        const args = parts.slice(1).join(' ')
        if (commands.some(c => c.name === cmdName)) {
            executeCommand(cmdName, args)
            return
        }
    }

    if (isOffline && onOfflineSubmit) {
      onOfflineSubmit(trimmed)
      setText('')
      setMentionQuery(null)
      return
    }
    sendMut.mutate(trimmed)
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

  function selectCommand(cmd: ApplicationCommandRead) {
    // Replace current query with command
    setText(`/${cmd.name} `)
    setCommandQuery(null)
    textareaRef.current?.focus()
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

    // Command navigation
    if (commandQuery !== null && commandCandidates.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCommandIndex(i => (i - 1 + commandCandidates.length) % commandCandidates.length)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCommandIndex(i => (i + 1) % commandCandidates.length)
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        selectCommand(commandCandidates[commandIndex])
        return
      }
      if (e.key === 'Escape') {
        setCommandQuery(null)
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

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newVal = e.target.value
    setText(newVal)
    e.target.style.height = 'auto'
    e.target.style.height = `${e.target.scrollHeight}px`
    emitTyping()

    const selStart = e.target.selectionStart ?? newVal.length

    // Detect /commands (must be at start)
    if (newVal.startsWith('/')) {
        const cmdPart = newVal.slice(1).split(' ')[0]
        // only show menu while typing the command name
        if (!newVal.includes(' ') || (selStart <= cmdPart.length + 1)) {
             setCommandQuery(cmdPart.toLowerCase())
             setCommandIndex(0)
             setMentionQuery(null) 
             return
        } else {
             setCommandQuery(null)
        }
    } else {
        setCommandQuery(null)
    }

    // Detect @mentions
    const match = findMentionTrigger(newVal, selStart)
    if (match && serverId) {
      setMentionQuery(match.query)
      setMentionTriggerStart(match.triggerStart)
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      const content = text.trim() || null
      uploadMut.mutate({ file, content })
    }
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
    <div className="px-2 pb-2 relative">
      {/* @mention autocomplete dropdown */}
      {mentionQuery !== null && mentionCandidates.length > 0 && (
        <div
          ref={mentionListRef}
          className="absolute bottom-full mb-1 left-4 right-4 bg-sp-popup border border-sp-divider/50 rounded-sp-lg shadow-sp-3 overflow-hidden z-50"
        >
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-sp-muted tracking-wider border-b border-sp-divider/50">
            Members — {mentionQuery ? `matching "@${mentionQuery}"` : 'all'}
          </div>
          {mentionCandidates.map((m, idx) => (
            <button
              key={m.user_id}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors
                ${idx === mentionIndex ? 'bg-sp-mention/15 text-sp-mention' : 'text-sp-muted hover:bg-sp-hover hover:text-sp-text'}`}
              onMouseEnter={() => setMentionIndex(idx)}
              onMouseDown={(e) => { e.preventDefault(); selectMention(m) }}
            >
              <UserAvatar user={m.user} size={24} />
              <span className="font-semibold">{m.user.username}</span>
              {m.roles.length > 0 && (
                <span className="text-xs text-sp-muted truncate ml-auto">
                  {m.roles[0].name}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* /command autocomplete dropdown */}
      {commandQuery !== null && commandCandidates.length > 0 && (
        <div
          className="absolute bottom-full mb-1 left-4 right-4 bg-sp-popup border border-sp-divider/50 rounded-sp-lg shadow-sp-3 overflow-hidden z-50 flex flex-col"
        >
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-sp-muted tracking-wider border-b border-sp-divider/50 bg-sp-bg/50">
             Commands — {commandQuery ? `matching "/${commandQuery}"` : 'all'}
          </div>
          <div className="max-h-[220px] overflow-y-auto custom-scrollbar p-1 space-y-0.5">
           {commandCandidates.map((cmd, idx) => (
            <button
              key={cmd.id}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors text-left
                ${idx === commandIndex ? 'bg-sp-mention/15 text-sp-mention' : 'text-sp-muted hover:bg-sp-hover hover:text-sp-text'}`}
              onMouseEnter={() => setCommandIndex(idx)}
              onMouseDown={(e) => { e.preventDefault(); selectCommand(cmd) }}
            >
              <div className="w-6 h-6 rounded-full bg-sp-button text-sp-text flex items-center justify-center shrink-0">
                  <span className="font-bold text-xs">/</span>
              </div>
              <div className="flex flex-col min-w-0">
                  <span className="font-bold truncate">{cmd.name}</span>
                  <span className="text-[10px] opacity-70 truncate">{cmd.description}</span>
              </div>
            </button>
          ))}
          </div>
        </div>
      )}

      {/* Slowmode banner */}
      {inCooldown && (
        <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-300/60 rounded-sp-sm px-3 py-1.5 mb-1.5 text-xs text-yellow-700">
          <Icon name="clock" size={13} className="shrink-0" />
          <span>Slowmode — you can send another message in <strong>{cooldownSecs}s</strong></span>
        </div>
      )}

      {/* Offline banner */}
      {isOffline && (
        <div className="flex items-center gap-2 bg-orange-50 border border-orange-300/60 rounded-sp-sm px-3 py-1.5 mb-1.5 text-xs text-orange-700">
          <Icon name="cloud-offline" size={13} className="shrink-0" />
          <span>You're offline — messages will be queued and sent when you reconnect</span>
        </div>
      )}

      {/* Upload error banner */}
      {uploadError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-300/60 rounded-sp-sm px-3 py-1.5 mb-1.5 text-xs text-red-600">
          <Icon name="alert-circle" size={13} className="shrink-0" />
          <span className="flex-1">{uploadError}</span>
          <button onClick={() => setUploadError(null)} className="ml-auto text-red-400/60 hover:text-red-400"><Icon name="x" size={12} /></button>
        </div>
      )}

      <div className="rounded-2xl border border-sp-divider/60 overflow-hidden bg-sp-input shadow-sp-1">
      {/* Reply banner */}
      {replyTo && (
        <div className="flex items-center gap-2 bg-sp-hover/50 rounded-t-2xl px-3 py-1.5 text-xs text-sp-muted border-b border-sp-divider/40">
          <Icon name="corner-up-left" size={13} className="text-sp-mention shrink-0" />
          <span>
            Replying to{' '}
            <span className="font-semibold text-sp-text">{replyTo.author.username}</span>
            {' — '}
            <span className="truncate italic">
              {(replyTo.content ?? '').length > 80 ? (replyTo.content ?? '').slice(0, 80) + '…' : (replyTo.content ?? '')}
            </span>
          </span>
          <button
            onClick={onCancelReply}
            className="ml-auto text-sp-muted hover:text-red-400 transition-colors shrink-0"
            title="Cancel reply"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      <div className="flex items-center min-h-[52px] px-3 py-2.5">
        {/* Attachment button */}
        <button
          title="Attach File"
          onClick={() => fileRef.current?.click()}
          className="text-sp-muted hover:text-sp-text transition-colors shrink-0 mt-[2px]"
        >
          <Icon name="attach-2" size={20} />
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />

        {/* Text area */}
        <textarea
          ref={textareaRef}
          className={`flex-1 bg-transparent resize-none outline-none text-sm text-sp-text placeholder:text-sp-muted max-h-36 leading-6 py-0 mx-2 ${inCooldown ? 'opacity-50 cursor-not-allowed' : ''}`}
          rows={1}
          value={text}
          maxLength={MAX_MESSAGE_LEN}
          placeholder={inCooldown ? `Slowmode — wait ${cooldownSecs}s…` : placeholder}
          disabled={inCooldown}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
        />

        {/* Emoji picker button */}
        <button
          ref={emojiButtonRef}
          title="Emoji"
          onClick={toggleEmojiPicker}
          className="text-sp-muted hover:text-sp-text transition-colors shrink-0 mt-[2px] mx-1"
        >
          <Icon name="smiling-face" size={20} />
        </button>

        <button
          onClick={handleSend}
          disabled={!text.trim() || sendMut.isPending || inCooldown || overLimit}
          className={`shrink-0 mt-[2px] w-8 h-8 rounded-full flex items-center justify-center transition-all
            ${text.trim() && !inCooldown && !overLimit
              ? 'bg-sp-mention text-white hover:bg-sp-mention/85 active:scale-90 shadow-sp-1'
              : 'text-sp-muted opacity-40 cursor-not-allowed'}`}
          title={inCooldown ? `Slowmode — wait ${cooldownSecs}s` : 'Send'}
        >
          <Icon name="paper-plane" size={20} />
        </button>
      </div>

      <div className="px-3 pb-2 text-right">
        <span className={`text-[11px] ${textLen > 1800 ? 'text-red-400' : 'text-sp-muted'}`}>
          {textLen}/{MAX_MESSAGE_LEN}
        </span>
      </div>

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
