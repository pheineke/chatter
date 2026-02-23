import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import client from '../api/client'
import { Icon } from './Icon'
import { addDismissed } from '../utils/embeds'

// ─── API type ─────────────────────────────────────────────────────────────────

interface OGMeta {
  url: string
  title: string | null
  description: string | null
  image: string | null
  site_name: string | null
}

async function fetchMeta(url: string): Promise<OGMeta> {
  const { data } = await client.get<OGMeta>('/meta', { params: { url } })
  return data
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm cursor-zoom-out"
      onClick={onClose}
    >
      <img
        src={src}
        alt="Full size preview"
        className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

// ─── Inline image embed ───────────────────────────────────────────────────────

function ImageEmbed({
  url,
  messageId,
  onDismiss,
}: {
  url: string
  messageId: string
  onDismiss: () => void
}) {
  const [lightbox, setLightbox] = useState(false)
  const [errored, setErrored] = useState(false)

  if (errored) return null

  return (
    <div className="relative group/embed mt-1.5 inline-block">
      <img
        src={url}
        alt="Inline preview"
        className="max-w-[400px] max-h-[300px] rounded object-cover cursor-zoom-in hover:brightness-90 transition block"
        onError={() => setErrored(true)}
        onClick={() => setLightbox(true)}
      />
      <button
        title="Dismiss image"
        onClick={() => { addDismissed(messageId, url); onDismiss() }}
        className="absolute top-1 right-1 opacity-0 group-hover/embed:opacity-100 transition bg-black/60 hover:bg-black/80 rounded p-0.5 text-white"
      >
        <Icon name="x" size={12} />
      </button>
      {lightbox && <Lightbox src={url} onClose={() => setLightbox(false)} />}
    </div>
  )
}

// ─── OG embed card ────────────────────────────────────────────────────────────

function OGCard({
  url,
  messageId,
  onDismiss,
}: {
  url: string
  messageId: string
  onDismiss: () => void
}) {
  const { data, isLoading, isError } = useQuery<OGMeta>({
    queryKey: ['meta', url],
    queryFn: () => fetchMeta(url),
    staleTime: 10 * 60_000, // 10 min
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="mt-1.5 w-80 h-20 bg-discord-sidebar rounded flex items-center justify-center">
        <Icon name="loader" size={16} className="animate-spin text-discord-muted" />
      </div>
    )
  }

  // If error or no useful data, render nothing
  if (isError || !data || (!data.title && !data.description)) return null

  const hostname = (() => {
    try { return new URL(url).hostname } catch { return url }
  })()

  return (
    <div className="relative group/embed mt-1.5 max-w-[440px] border-l-4 border-discord-mention/60 bg-discord-sidebar rounded-r overflow-hidden">
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className="block p-3 hover:bg-white/5 transition"
      >
        {data.site_name && (
          <p className="text-[11px] text-discord-muted uppercase tracking-wide mb-0.5">{data.site_name}</p>
        )}
        {data.title && (
          <p className="text-sm font-semibold text-discord-mention hover:underline leading-snug mb-1 line-clamp-2">
            {data.title}
          </p>
        )}
        {data.description && (
          <p className="text-xs text-discord-muted leading-relaxed line-clamp-3 mb-2">{data.description}</p>
        )}
        {!data.site_name && (
          <p className="text-[11px] text-discord-muted">{hostname}</p>
        )}

        {data.image && (
          <img
            src={data.image}
            alt=""
            className="mt-2 w-full max-h-[200px] rounded object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        )}
      </a>

      <button
        title="Dismiss embed"
        onClick={() => { addDismissed(messageId, url); onDismiss() }}
        className="absolute top-1.5 right-1.5 opacity-0 group-hover/embed:opacity-100 transition bg-black/50 hover:bg-black/70 rounded p-0.5 text-white"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}

// ─── Public component ─────────────────────────────────────────────────────────

export interface LinkEmbedProps {
  url: string
  isImage: boolean
  messageId: string
  dismissed: Set<string>
  onDismiss: (url: string) => void
}

export function LinkEmbed({ url, isImage, messageId, dismissed, onDismiss }: LinkEmbedProps) {
  if (dismissed.has(url)) return null

  if (isImage) {
    return <ImageEmbed url={url} messageId={messageId} onDismiss={() => onDismiss(url)} />
  }

  return <OGCard url={url} messageId={messageId} onDismiss={() => onDismiss(url)} />
}
