/**
 * Discord-flavoured markdown renderer.
 *
 * Supported syntax:
 *   **bold** / __bold__
 *   *italic* / _italic_
 *   ~~strikethrough~~
 *   `inline code`
 *   ```lang\ncode block\n```
 *   > blockquote
 *   - / * / 1. lists
 *   [text](url) and bare https:// URLs  →  external links
 *   @mention  →  highlighted span
 *   ||spoiler||  →  hidden until clicked
 *
 * All output is run through DOMPurify before being injected into the DOM.
 */

import { marked } from 'marked'
import DOMPurify from 'dompurify'

// ── Custom renderer ──────────────────────────────────────────────────────────

const renderer = {
  // Open every link in a new tab with security attributes.
  link({ href, text }: { href?: string | null; title?: string | null; text: string }): string {
    const safe = (href ?? '#').replace(/"/g, '%22').replace(/</g, '%3C')
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer" class="md-link">${text}</a>`
  },

  // Discord doesn't render markdown headings — treat them as bold paragraphs.
  heading({ text }: { text: string; depth: number }): string {
    return `<p><strong>${text}</strong></p>\n`
  },
}

// ── Custom inline extensions ─────────────────────────────────────────────────

// Spoiler: ||hidden text||
const spoilerExtension = {
  name: 'spoiler',
  level: 'inline' as const,
  start(src: string) {
    return src.indexOf('||')
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tokenizer(src: string): any {
    const m = src.match(/^\|\|(.+?)\|\|/s)
    if (m) return { type: 'spoiler', raw: m[0], text: m[1] }
    return undefined
  },
  renderer(token: { text: string }): string {
    return `<span class="spoiler" data-spoiler="1">${token.text}</span>`
  },
}

// @mention: @word  →  highlighted span
const mentionExtension = {
  name: 'mention',
  level: 'inline' as const,
  start(src: string) {
    return src.indexOf('@')
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tokenizer(src: string): any {
    const m = src.match(/^@(\w+)/)
    if (m) return { type: 'mention', raw: m[0], text: m[1] }
    return undefined
  },
  renderer(token: { text: string }): string {
    return `<span class="mention">@${token.text}</span>`
  },
}

// ── Configure marked (done once at module load) ───────────────────────────────

marked.use({
  gfm: true,    // ~~strikethrough~~, fenced code blocks, auto-links
  breaks: true, // single newline  →  <br>
  renderer,
  extensions: [spoilerExtension, mentionExtension],
})

// ── DOMPurify allowlist ──────────────────────────────────────────────────────

const ALLOWED_TAGS = [
  'p', 'br',
  'strong', 'b',
  'em', 'i',
  'del', 's',
  'code', 'pre',
  'blockquote',
  'ul', 'ol', 'li',
  'a',
  'span',
]

const ALLOWED_ATTR = ['href', 'target', 'rel', 'class', 'data-spoiler']

// ── Public API ────────────────────────────────────────────────────────────────

/** Render Discord-flavoured markdown to safe HTML. */
export function renderMarkdown(text: string): string {
  const html = String(marked.parse(text))
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR })
}
