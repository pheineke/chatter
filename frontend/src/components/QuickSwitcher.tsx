import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getMyServers } from '../api/servers'
import { getChannels } from '../api/channels'
import { Icon } from './Icon'

interface QuickItem {
  id: string
  label: string
  sublabel?: string
  icon: string
  href: string
}

interface Props {
  onClose: () => void
}

export function QuickSwitcher({ onClose }: Props) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: servers = [] } = useQuery({
    queryKey: ['servers'],
    queryFn: getMyServers,
    staleTime: 60_000,
  })

  // Gather channels from any already-cached servers
  const channelQueryResults = servers.map((s) => ({
    serverId: s.id,
    serverTitle: s.title,
    // read from cache only — useQuery with enabled:false would refetch; here we just use stale data
    channels: [] as { id: string; title: string }[],
  }))

  // Build item list from servers
  const allItems: QuickItem[] = useMemo(() => {
    const items: QuickItem[] = []
    for (const s of servers) {
      items.push({
        id: `server-${s.id}`,
        label: s.title,
        icon: 'server',
        href: `/channels/${s.id}`,
      })
    }
    return items
  }, [servers])

  const filtered = useMemo(() => {
    if (!query.trim()) return allItems.slice(0, 10)
    const q = query.toLowerCase()
    return allItems.filter((item) =>
      item.label.toLowerCase().includes(q) ||
      (item.sublabel ?? '').toLowerCase().includes(q)
    ).slice(0, 10)
  }, [allItems, query])

  useEffect(() => {
    setSelectedIdx(0)
  }, [query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      const item = filtered[selectedIdx]
      if (item) {
        navigate(item.href)
        onClose()
      }
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center pt-20 z-[100]" onClick={onClose}>
      <div
        className="bg-discord-sidebar w-full max-w-lg rounded-xl shadow-2xl overflow-hidden border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-black/20">
          <Icon name="search" size={18} className="text-discord-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Go to a server, channel, or DM…"
            className="flex-1 bg-transparent outline-none text-sm text-discord-text placeholder:text-discord-muted"
          />
          <kbd className="text-[10px] text-discord-muted bg-discord-input px-1.5 py-0.5 rounded">Esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-discord-muted text-sm">
              No results found
            </div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                  ${idx === selectedIdx ? 'bg-discord-mention/20 text-discord-text' : 'text-discord-muted hover:bg-white/5 hover:text-discord-text'}`}
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={() => { navigate(item.href); onClose() }}
              >
                <Icon name={item.icon as never} size={16} className="shrink-0 opacity-70" />
                <span className="font-medium">{item.label}</span>
                {item.sublabel && (
                  <span className="ml-auto text-xs text-discord-muted truncate">{item.sublabel}</span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-black/20 bg-discord-bg/50">
          <span className="text-[10px] text-discord-muted flex items-center gap-1">
            <kbd className="bg-discord-input px-1.5 py-0.5 rounded text-[10px]">↑↓</kbd> navigate
          </span>
          <span className="text-[10px] text-discord-muted flex items-center gap-1">
            <kbd className="bg-discord-input px-1.5 py-0.5 rounded text-[10px]">↵</kbd> open
          </span>
          <span className="text-[10px] text-discord-muted flex items-center gap-1">
            <kbd className="bg-discord-input px-1.5 py-0.5 rounded text-[10px]">Esc</kbd> dismiss
          </span>
        </div>
      </div>
    </div>
  )
}
