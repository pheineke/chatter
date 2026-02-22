/**
 * Splits a string into runs of plain text, @mention tokens, and URLs,
 * then renders URLs as clickable <a> tags that open in a new tab.
 *
 * Usage:
 *   <Linkified text="Check https://example.com and @alice!" />
 *   <Linkified text={description} noMentions />
 */

import type { ReactNode } from 'react'

// Matches http(s):// or bare www. URLs
const URL_RE = /(\bhttps?:\/\/[^\s<>"]+|\bwww\.[^\s<>"]+)/gi
const MENTION_RE = /(@\w+)/g

type Segment =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string }
  | { type: 'mention'; value: string }

function parse(text: string, noMentions: boolean): Segment[] {
  // Combine URL and (optionally) mention patterns into one regex so that
  // overlapping matches are impossible.
  const combined = noMentions
    ? new RegExp(URL_RE.source, 'gi')
    : new RegExp(`${URL_RE.source}|${MENTION_RE.source}`, 'gi')

  const segments: Segment[] = []
  let last = 0
  let m: RegExpExecArray | null

  combined.lastIndex = 0
  while ((m = combined.exec(text)) !== null) {
    if (m.index > last) {
      segments.push({ type: 'text', value: text.slice(last, m.index) })
    }
    const matched = m[0]
    if (/^https?:\/\//i.test(matched) || /^www\./i.test(matched)) {
      segments.push({ type: 'url', value: matched })
    } else {
      segments.push({ type: 'mention', value: matched })
    }
    last = m.index + matched.length
  }

  if (last < text.length) {
    segments.push({ type: 'text', value: text.slice(last) })
  }

  return segments
}

interface Props {
  text: string
  /** Skip @mention highlighting (e.g. for bio / channel description) */
  noMentions?: boolean
  className?: string
}

export function Linkified({ text, noMentions = false, className }: Props): ReactNode {
  const segments = parse(text, noMentions)

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'url') {
          const href = /^https?:\/\//i.test(seg.value)
            ? seg.value
            : `https://${seg.value}`
          return (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-discord-mention hover:underline break-all ${className ?? ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              {seg.value}
            </a>
          )
        }
        if (seg.type === 'mention') {
          return (
            <span key={i} className="mention">
              {seg.value}
            </span>
          )
        }
        return <span key={i}>{seg.value}</span>
      })}
    </>
  )
}
