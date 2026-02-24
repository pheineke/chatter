import { useState, useEffect, useRef } from 'react'
import { searchMessages } from '../api/messages'
import type { Message } from '../api/types'

interface Props {
  channelId: string
  onJump: (messageId: string) => void
  onClose: () => void
  query: string
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SearchPanel({ channelId, onJump, onClose, query }: Props) {
  const [results, setResults] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!query.trim()) {
      setResults([])
      setError(null)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const msgs = await searchMessages(channelId, query.trim())
        setResults(msgs)
      } catch {
        setError('Search failed. Please try again.')
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, channelId])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="w-72 flex flex-col bg-discord-sidebar border-l-2 border-white/[0.07] h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-white/[0.07] shrink-0">
        <span className="text-discord-muted text-xs font-semibold uppercase tracking-wide">
          {results.length > 0 ? `${results.length} result${results.length !== 1 ? 's' : ''}` : 'Search Results'}
        </span>
        <button
          onClick={onClose}
          className="ml-auto text-discord-muted hover:text-discord-text transition-colors shrink-0"
          title="Close search"
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="text-discord-muted text-xs text-center py-6">Searching…</p>
        )}
        {error && (
          <p className="text-red-400 text-xs text-center py-6">{error}</p>
        )}
        {!loading && !error && query.trim() && results.length === 0 && (
          <p className="text-discord-muted text-xs text-center py-6">No results found.</p>
        )}
        {!loading && results.map(msg => (
          <button
            key={msg.id}
            onClick={() => { onJump(msg.id); onClose() }}
            className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors border-b border-black/10"
          >
            <div className="flex items-center gap-2 mb-0.5">
              {/* Avatar */}
              {msg.author.avatar ? (
                <img
                  src={`/static/avatars/${msg.author.avatar}`}
                  alt={msg.author.username}
                  className="w-5 h-5 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-discord-primary flex items-center justify-center shrink-0">
                  <span className="text-white text-[10px] font-bold">
                    {msg.author.username[0]?.toUpperCase()}
                  </span>
                </div>
              )}
              <span className="text-xs font-semibold text-discord-text truncate">
                {msg.author.username}
              </span>
              <span className="text-[10px] text-discord-muted ml-auto shrink-0">
                {formatDate(msg.created_at)}
              </span>
            </div>
            <p className="text-xs text-discord-muted leading-snug line-clamp-2 pl-7">
              {msg.content ?? <em>No text content</em>}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}
