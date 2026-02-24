import { useParams, useNavigate } from 'react-router-dom'
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getChannels } from '../api/channels'
import { getPins, searchMessages } from '../api/messages'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import { MemberSidebar } from './MemberSidebar'
import { PinnedMessagesPanel } from './PinnedMessagesPanel'
import { Icon } from './Icon'
import { VoiceGridPane } from './VoiceGridPane'
import type { VoiceSession } from '../pages/AppShell'
import type { Message } from '../api/types'
import { useUnreadChannels } from '../contexts/UnreadChannelsContext'
import { useChannelWS } from '../hooks/useChannelWS'
import { Linkified } from '../utils/linkify'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  voiceSession: VoiceSession | null
  onJoinVoice: (s: VoiceSession) => void
  onLeaveVoice: () => void
  /** Called when the mobile hamburger button is tapped */
  onOpenNav?: () => void
}

export function MessagePane({ voiceSession, onJoinVoice, onLeaveVoice, onOpenNav }: Props) {
  const { serverId, channelId } = useParams<{ serverId: string; channelId: string }>()
  const navigate = useNavigate()
  const [showMembers, setShowMembers] = useState(true)
  const [showPins, setShowPins] = useState(false)
  const [showNotifMenu, setShowNotifMenu] = useState(false)
  const notifBtnRef = useRef<HTMLButtonElement>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const scrollToMessageRef = useRef<((id: string) => void) | null>(null)
  const { markRead, markServerRead } = useUnreadChannels()
  const qc = useQueryClient()

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchResults, setSearchResults] = useState<Message[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchCardRef = useRef<HTMLDivElement>(null)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Notification level per channel
  const notifKey = channelId ? `notif_${channelId}` : null
  const [notifLevel, setNotifLevel] = useState<'default'|'all'|'mentions'|'nothing'>(() => {
    if (!channelId) return 'default'
    return (localStorage.getItem(`notif_${channelId}`) as any) ?? 'default'
  })
  function setNotif(level: 'default'|'all'|'mentions'|'nothing') {
    setNotifLevel(level)
    if (notifKey) localStorage.setItem(notifKey, level)
    setShowNotifMenu(false)
  }

  // Mark channel + server as read when the user opens a channel
  useEffect(() => {
    if (channelId) markRead(channelId)
    if (serverId) markServerRead(serverId)
  }, [channelId, serverId, markRead, markServerRead])

  // Ctrl+F / Cmd+F → focus search
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // Search debounce
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (!channelId) { setSearchResults([]); setSearchLoading(false); return }

    // Parse filter prefixes: from:user  mentions:user  has:link|file|embed
    const fromMatch = searchQuery.match(/\bfrom:\s*(\S+)/i)
    const mentionsMatch = searchQuery.match(/\bmentions:\s*(\S+)/i)
    const hasMatch = searchQuery.match(/\bhas:\s*(\S+)/i)
    const plainQ = searchQuery
      .replace(/\bfrom:\s*\S+/gi, '')
      .replace(/\bmentions:\s*\S+/gi, '')
      .replace(/\bhas:\s*\S+/gi, '')
      .trim()
    const hasFilters = !!(fromMatch || mentionsMatch || hasMatch)

    if (!plainQ && !hasFilters) { setSearchResults([]); setSearchLoading(false); return }

    setSearchLoading(true)
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const msgs = await searchMessages(channelId, plainQ, {
          author: fromMatch?.[1],
          mentions: mentionsMatch?.[1],
          has: hasMatch?.[1],
        })
        setSearchResults(msgs)
      } catch { setSearchResults([]) }
      finally { setSearchLoading(false) }
    }, 300)
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current) }
  }, [searchQuery, channelId])

  function closeSearch() {
    setSearchFocused(false)
    setSearchQuery('')
    setSearchResults([])
  }

  const handleReply = useCallback((msg: Message) => setReplyTo(msg), [])
  const handleCancelReply = useCallback(() => setReplyTo(null), [])
  const handleRegisterScrollTo = useCallback((fn: (id: string) => void) => {
    scrollToMessageRef.current = fn
  }, [])

  const { user } = useAuth()

  // Real-time channel events (WS lifted here so sendTyping/typingUsers can be passed to children)
  const { typingUsers, sendTyping } = useChannelWS(channelId ?? null)

  // Pinned messages query + WS event handling
  const { data: pins = [] } = useQuery({
    queryKey: ['pins', channelId],
    queryFn: () => getPins(channelId!),
    enabled: !!channelId,
    staleTime: 60_000,
  })
  const pinnedIds = useMemo(() => new Set(pins.map((p) => p.message.id)), [pins])

  // Invalidate pins cache on WS pin/unpin events
  useEffect(() => {
    const handler = (e: Event) => {
      const { type, channelId: eid } = (e as CustomEvent).detail
      if ((type === 'message.pinned' || type === 'message.unpinned') && eid === channelId) {
        qc.invalidateQueries({ queryKey: ['pins', channelId] })
      }
    }
    window.addEventListener('channel-ws-event', handler)
    return () => window.removeEventListener('channel-ws-event', handler)
  }, [channelId, qc])

  const { data: channels = [], isLoading: channelsLoading, isSuccess: channelsLoaded } = useQuery({
    queryKey: ['channels', serverId],
    queryFn: () => getChannels(serverId!),
    enabled: !!serverId,
  })

  const channel = channels.find((c) => c.id === channelId)

  // If the channel list has loaded and the active channel no longer exists, navigate back to the server root.
  useEffect(() => {
    if (channelsLoaded && channelId && !channel && !voiceSession) {
      navigate(`/channels/${serverId}`, { replace: true })
    }
  }, [channelsLoaded, channelId, channel, voiceSession, serverId, navigate])

  if (!channelId) {
    return (
      <div className="h-full flex items-center justify-center text-discord-muted">
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
      <div className="h-full flex items-center justify-center text-discord-muted">
        <Icon name="loader" size={24} className="animate-spin" />
      </div>
    )
  }

  if (channel?.type === 'voice') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-discord-muted">
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
      <div className="flex items-center gap-2 px-4 border-b border-white/[0.07] shrink-0 h-12 min-w-0">
        {/* Mobile: open left-panel drawer */}
        {onOpenNav && (
          <button
            className="md:hidden p-1 -ml-1 mr-1 text-discord-muted hover:text-discord-text shrink-0"
            onClick={onOpenNav}
            aria-label="Open navigation"
          >
            <Icon name="menu" size={22} />
          </button>
        )}
        <Icon name="hash" size={16} className="text-discord-muted shrink-0" />
        <span className="font-bold shrink-0 select-none leading-none">{channel?.title ?? channelId}</span>
        {channel?.description && (
          <>
            <div className="w-px h-5 bg-white/20 shrink-0 mx-1" />
            <span
              className="text-sm text-discord-muted truncate"
              title={channel.description}
            >
              <Linkified text={channel.description} noMentions />
            </span>
          </>
        )}
        <div className="flex-1" />
        {/* Notification settings */}
        <div className="relative shrink-0">
          <button
            ref={notifBtnRef}
            onClick={() => setShowNotifMenu(v => !v)}
            title="Notification settings"
            className={`p-1.5 rounded transition-colors shrink-0 ${showNotifMenu ? 'text-discord-text' : 'text-discord-muted hover:text-discord-text'}`}
          >
            <Icon name={notifLevel === 'nothing' ? 'bell-off' : 'bell'} size={20} />
          </button>
          {showNotifMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowNotifMenu(false)} />
              <div className="absolute right-0 top-full mt-1 w-56 bg-[#1e1f22] rounded-lg shadow-xl z-50 overflow-hidden py-1.5 border border-white/[0.07]">
                {notifLevel === 'nothing'
                  ? <button onClick={() => setNotif('default')} className="w-full text-left px-3 py-2 text-sm text-discord-text hover:bg-white/10 transition-colors">Unmute Channel</button>
                  : <button onClick={() => setNotif('nothing')} className="w-full text-left px-3 py-2 text-sm text-discord-text hover:bg-white/10 transition-colors">Mute Channel</button>
                }
                <div className="my-1 border-t border-white/[0.07]" />
                {(['default','all','mentions','nothing'] as const).map(lvl => {
                  const labels = { default: 'Use Category Default', all: 'All Messages', mentions: 'Only @mentions', nothing: 'Nothing' }
                  const hints = { default: 'All Messages', all: '', mentions: '', nothing: '' }
                  return (
                    <button key={lvl} onClick={() => setNotif(lvl)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition-colors flex items-center justify-between"
                    >
                      <span className="flex flex-col">
                        <span className={notifLevel === lvl ? 'text-discord-text font-medium' : 'text-discord-text'}>{labels[lvl]}</span>
                        {hints[lvl] && <span className="text-xs text-discord-muted">{hints[lvl]}</span>}
                      </span>
                      <span className={`w-4 h-4 rounded-full border-2 shrink-0 ml-3 flex items-center justify-center ${
                        notifLevel === lvl ? 'border-blue-500 bg-blue-500' : 'border-discord-muted'
                      }`}>
                        {notifLevel === lvl && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
        {/* Pins toggle */}
        <button
          onClick={() => setShowPins(v => !v)}
          title={showPins ? 'Close pins' : 'Pinned messages'}
          className={`p-1.5 rounded transition-colors shrink-0 ${showPins ? 'text-discord-text' : 'text-discord-muted hover:text-discord-text'}`}
        >
          <Icon name="pin" size={20} />
          {pinnedIds.size > 0 && (
            <span className="ml-0.5 text-xs text-discord-muted">{pinnedIds.size}</span>
          )}
        </button>
        {/* Members toggle — hidden on mobile (member list has no space) */}
        <button
          onClick={() => setShowMembers(v => !v)}
          title="Toggle member list"
          className={`hidden md:block p-1.5 rounded transition-colors shrink-0 ${showMembers ? 'text-discord-text' : 'text-discord-muted hover:text-discord-text'}`}
        >
          <Icon name="people" size={20} />
        </button>
        {/* Search — icon toggles input */}
        <div className="relative flex items-center shrink-0">
          {searchFocused && (
            <input
              ref={searchInputRef}
              autoFocus
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onBlur={e => {
                if (!searchCardRef.current?.contains(e.relatedTarget as Node)) {
                  setTimeout(closeSearch, 150)
                }
              }}
              onKeyDown={e => { if (e.key === 'Escape') { closeSearch() } }}
              placeholder={`Search ${channel?.title ?? ''}…`}
              className="bg-discord-input/60 border border-white/[0.07] rounded px-2.5 h-7 text-sm text-discord-text placeholder:text-discord-muted outline-none mr-1"
              style={{ width: 220 }}
            />
          )}
          <button
            onClick={() => { if (searchFocused) { closeSearch() } else { setSearchFocused(true) } }}
            title={searchFocused ? 'Close search (Esc)' : 'Search messages'}
            className={`p-1.5 rounded transition-colors shrink-0 ${searchFocused ? 'text-discord-text' : 'text-discord-muted hover:text-discord-text'}`}
          >
            <Icon name="search" size={20} />
          </button>
          {/* Dropdown card */}
          {searchFocused && (
            <div
              ref={searchCardRef}
              className="absolute right-0 top-full mt-2 w-80 bg-[#1e1f22] rounded-lg shadow-2xl z-50 border border-white/[0.07] overflow-hidden"
            >
              {!searchQuery.trim() ? (
                <>
                  <div className="px-3 pt-3 pb-1 text-xs font-bold text-discord-muted uppercase tracking-wider">Filters</div>
                  {[
                    { icon: 'person', label: 'From a specific user', hint: 'from: username', prefix: 'from: ' },
                    { icon: 'attach-2', label: 'Has a link, file or image', hint: 'has: link  or  has: file', prefix: 'has: ' },
                    { icon: 'at', label: 'Mentions a specific user', hint: 'mentions: username', prefix: 'mentions: ' },
                  ].map(f => (
                    <button key={f.icon}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { setSearchQuery(f.prefix); setTimeout(() => searchInputRef.current?.focus(), 0) }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
                    >
                      <Icon name={f.icon} size={20} className="text-discord-muted shrink-0" />
                      <span className="flex flex-col">
                        <span className="text-sm text-discord-text">{f.label}</span>
                        <span className="text-xs text-discord-muted">{f.hint}</span>
                      </span>
                    </button>
                  ))}
                  <div className="pb-1" />
                </>
              ) : searchLoading ? (
                <div className="px-4 py-6 text-sm text-discord-muted text-center">Searching…</div>
              ) : searchResults.length === 0 ? (
                <div className="px-4 py-6 text-sm text-discord-muted text-center">No results for <strong className="text-discord-text">{searchQuery}</strong></div>
              ) : (
                <>
                  <div className="px-3 pt-3 pb-1 text-xs font-bold text-discord-muted uppercase tracking-wider">{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</div>
                  <div className="max-h-72 overflow-y-auto">
                    {searchResults.map(msg => (
                      <button key={msg.id}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { scrollToMessageRef.current?.(msg.id); closeSearch() }}
                        className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors border-b border-white/[0.04] last:border-0"
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-discord-text truncate">{msg.author.username}</span>
                          <span className="text-[10px] text-discord-muted ml-auto shrink-0">
                            {new Date(msg.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-xs text-discord-muted leading-snug line-clamp-2">{msg.content ?? <em>No text</em>}</p>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body: messages + optional sidebars */}
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Messages */}
          <MessageList
            channelId={channelId}
            onReply={handleReply}
            onRegisterScrollTo={handleRegisterScrollTo}
            pinnedIds={pinnedIds}
          />

          {/* Typing indicator */}
          {typingUsers.length > 0 && (
            <div className="px-4 py-1 text-xs text-discord-muted flex items-center gap-1 select-none shrink-0">
              <span className="flex gap-0.5 items-center">
                <span className="w-1 h-1 bg-discord-muted rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1 h-1 bg-discord-muted rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1 h-1 bg-discord-muted rounded-full animate-bounce [animation-delay:300ms]" />
              </span>
              <span>
                {typingUsers.length === 1
                  ? <><strong>{typingUsers[0].username}</strong> is typing…</>
                  : typingUsers.length === 2
                    ? <><strong>{typingUsers[0].username}</strong> and <strong>{typingUsers[1].username}</strong> are typing…</>
                    : <><strong>Several people</strong> are typing…</>
                }
              </span>
            </div>
          )}

          {/* Input */}
          <MessageInput
            channelId={channelId}
            serverId={serverId}
            placeholder={`Message #${channel?.title ?? channelId}`}
            replyTo={replyTo}
            onCancelReply={handleCancelReply}
            onTyping={sendTyping}
            slowmodeDelay={channel?.slowmode_delay ?? 0}
          />
        </div>

        {/* Pinned messages panel */}
        {showPins && (
          <PinnedMessagesPanel
            channelId={channelId}
            onScrollToMessage={(id) => scrollToMessageRef.current?.(id)}
            onClose={() => setShowPins(false)}
          />
        )}

        {showMembers && serverId && <MemberSidebar serverId={serverId} />}
      </div>
    </div>
  )
}
