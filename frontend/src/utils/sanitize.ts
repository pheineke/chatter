/**
 * sanitize.ts
 *
 * DOMPurify wrapper for safely rendering any HTML string into the DOM.
 * Use this any time you need `dangerouslySetInnerHTML` with user-controlled
 * content – it strips scripts, event handlers, and other dangerous constructs
 * while preserving safe formatting tags.
 */
import DOMPurify from 'dompurify'

/** Allowed HTML tags for rich-text message content. */
const ALLOWED_TAGS = ['b', 'i', 'em', 'strong', 'u', 's', 'code', 'pre', 'br', 'span']

/**
 * Returns a sanitized HTML string safe for use with `dangerouslySetInnerHTML`.
 *
 * @param dirty  Raw (potentially malicious) HTML string.
 * @param richText  When false (default) strips all tags, returning plain text.
 *                  When true, allows a small allowlist of formatting tags.
 */
export function sanitizeHtml(dirty: string, richText = false): string {
  if (!dirty) return ''
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: richText ? ALLOWED_TAGS : [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
  })
}
