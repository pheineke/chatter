/** Regex that matches http(s) URLs inside message content */
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g

const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|svg)(\?[^\s]*)?$/i

export interface DetectedURL {
  url: string
  isImage: boolean
}

/**
 * Extract all URLs from a message's text content.
 * De-duplicates; preserves order of appearance.
 */
export function extractURLs(content: string): DetectedURL[] {
  const seen = new Set<string>()
  const matches = content.match(URL_RE) ?? []
  const result: DetectedURL[] = []
  for (const url of matches) {
    // Trim trailing punctuation that's likely not part of the URL
    const clean = url.replace(/[.,;:!?)]+$/, '')
    if (seen.has(clean)) continue
    seen.add(clean)
    result.push({ url: clean, isImage: IMAGE_EXTS.test(clean) })
  }
  return result
}

/** localStorage key for dismissed embeds (per message id) */
export function dismissedKey(messageId: string): string {
  return `embed_dismissed_${messageId}`
}

export function getDismissed(messageId: string): Set<string> {
  try {
    const raw = localStorage.getItem(dismissedKey(messageId))
    if (!raw) return new Set()
    return new Set(JSON.parse(raw))
  } catch {
    return new Set()
  }
}

export function addDismissed(messageId: string, url: string): void {
  try {
    const s = getDismissed(messageId)
    s.add(url)
    localStorage.setItem(dismissedKey(messageId), JSON.stringify([...s]))
  } catch {
    // ignore
  }
}
