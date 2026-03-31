import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
import type { CustomEmoji } from '../api/types'
import { asCustomEmojiToken } from '../utils/customEmojis'

interface Props {
  /** Called with the native emoji string (e.g. "👍") */
  onPick: (emoji: string) => void
  onClose: () => void
  /** Preferred top-left anchor in viewport coords. The picker repositions itself if it overflows. */
  position: { x: number; y: number }
  customEmojis?: CustomEmoji[]
  showServerSection?: boolean
  enableGifSearch?: boolean
}

const PICKER_W = 352
const PICKER_H = 435
const TENOR_LIMIT = 24
const TENOR_KEY = (import.meta.env.VITE_TENOR_API_KEY as string | undefined)?.trim() || ''

type TenorResponse = {
  results: Array<{
    id: string
    media_formats?: {
      tinygif?: { url: string }
      gif?: { url: string }
    }
  }>
}

export function EmojiPicker({ onPick, onClose, position, customEmojis = [], showServerSection = false, enableGifSearch = false }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<'unicode' | 'gifs' | 'server'>('unicode')
  const [gifQuery, setGifQuery] = useState('')
  const [gifResults, setGifResults] = useState<Array<{ id: string; previewUrl: string; gifUrl: string }>>([])
  const [gifLoading, setGifLoading] = useState(false)
  const [gifError, setGifError] = useState<string | null>(null)
  const showTabs = enableGifSearch || showServerSection
  const hasTenorKey = TENOR_KEY.length > 0

  // Clamp to viewport
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.min(position.x, vw - PICKER_W - 8)
  const top = position.y + PICKER_H > vh ? position.y - PICKER_H : position.y

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    // Use mousedown so it fires before the button's onClick potentially re-opens the picker
    window.addEventListener('mousedown', handleMouseDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('mousedown', handleMouseDown)
    }
  }, [onClose])

  useEffect(() => {
    if (!enableGifSearch || tab !== 'gifs') return
    if (!hasTenorKey) {
      setGifResults([])
      setGifLoading(false)
      setGifError('GIF search is not configured. Set VITE_TENOR_API_KEY in frontend env.')
      return
    }
    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      setGifLoading(true)
      setGifError(null)
      try {
        const q = gifQuery.trim()
        const params = new URLSearchParams({
          key: TENOR_KEY,
          client_key: 'chatter',
          limit: String(TENOR_LIMIT),
          media_filter: 'tinygif,gif',
          contentfilter: 'medium',
        })
        const endpoint = q.length > 0 ? 'search' : 'featured'
        if (q.length > 0) params.set('q', q)
        const res = await fetch(`https://tenor.googleapis.com/v2/${endpoint}?${params.toString()}`, {
          signal: controller.signal,
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
          const detail = body?.error?.message || `GIF search failed (${res.status})`
          throw new Error(detail)
        }
        const payload = (await res.json()) as TenorResponse
        const parsed = (payload.results || [])
          .map((r) => {
            const preview = r.media_formats?.tinygif?.url ?? r.media_formats?.gif?.url
            const full = r.media_formats?.gif?.url ?? r.media_formats?.tinygif?.url
            if (!preview || !full) return null
            return { id: r.id, previewUrl: preview, gifUrl: full }
          })
          .filter((v): v is { id: string; previewUrl: string; gifUrl: string } => v !== null)
        setGifResults(parsed)
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setGifResults([])
          setGifError(String(err?.message || 'Could not load GIFs.'))
        }
      } finally {
        setGifLoading(false)
      }
    }, 250)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [enableGifSearch, gifQuery, hasTenorKey, tab])

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', left, top, zIndex: 9999 }}
      // Stop propagation so mousedown inside the picker doesn't close it
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="w-[352px] overflow-hidden rounded-lg border border-sp-divider/60 bg-sp-popup shadow-sp-3">
        {showTabs && (
          <div className="flex items-center border-b border-sp-divider/60 px-1 py-1">
            <button
              type="button"
              className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === 'unicode' ? 'bg-sp-mention text-white' : 'text-sp-muted hover:bg-sp-hover hover:text-sp-text'
              }`}
              onClick={() => setTab('unicode')}
            >
              Emoji
            </button>
            {enableGifSearch && (
              <button
                type="button"
                className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                  tab === 'gifs' ? 'bg-sp-mention text-white' : 'text-sp-muted hover:bg-sp-hover hover:text-sp-text'
                }`}
                onClick={() => setTab('gifs')}
              >
                GIFs
              </button>
            )}
            {showServerSection && (
              <button
                type="button"
                className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                  tab === 'server' ? 'bg-sp-mention text-white' : 'text-sp-muted hover:bg-sp-hover hover:text-sp-text'
                }`}
                onClick={() => setTab('server')}
              >
                Server
              </button>
            )}
          </div>
        )}

        {showServerSection && tab === 'server' ? (
          <div className="h-[392px] overflow-y-auto p-2">
            <div className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wider text-sp-muted">Server Emojis</div>
            {customEmojis.length === 0 ? (
              <div className="px-1 py-2 text-xs text-sp-muted">No server emojis uploaded yet.</div>
            ) : (
              <div className="grid grid-cols-8 gap-1">
                {customEmojis.slice(0, 96).map((emoji) => (
                  <button
                    key={emoji.id}
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-sp-hover"
                    title={`:${emoji.name}:`}
                    onClick={() => {
                      onPick(asCustomEmojiToken(emoji.id))
                      onClose()
                    }}
                  >
                    <img
                      src={`/api/static/${emoji.image_path}`}
                      alt={emoji.name}
                      className="h-6 w-6 object-contain"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : enableGifSearch && tab === 'gifs' ? (
          <div className="h-[435px] p-2">
            <input
              value={gifQuery}
              onChange={(e) => setGifQuery(e.target.value)}
              className="input mb-2 w-full"
              placeholder="Search GIFs"
            />
            <div className="h-[375px] overflow-y-auto">
              {gifLoading ? (
                <div className="px-2 py-4 text-xs text-sp-muted">Searching GIFs…</div>
              ) : gifError ? (
                <div className="px-2 py-4 text-xs text-red-400">{gifError}</div>
              ) : gifResults.length === 0 ? (
                <div className="px-2 py-4 text-xs text-sp-muted">No GIFs found.</div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {gifResults.map((gif) => (
                    <button
                      key={gif.id}
                      type="button"
                      className="overflow-hidden rounded border border-sp-divider/40 hover:border-sp-mention/60"
                      onClick={() => {
                        onPick(gif.gifUrl)
                        onClose()
                      }}
                    >
                      <img src={gif.previewUrl} alt="GIF" className="h-24 w-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <Picker
            data={data}
            theme="dark"
            onEmojiSelect={(e: { native: string }) => {
              onPick(e.native)
              onClose()
            }}
            previewPosition="none"
            skinTonePosition="search"
            navPosition="top"
            perLine={9}
            emojiSize={28}
            emojiButtonSize={36}
          />
        )}
      </div>
    </div>,
    document.body,
  )
}
