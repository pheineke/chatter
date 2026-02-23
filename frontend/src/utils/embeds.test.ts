import { describe, it, expect, beforeEach } from 'vitest'
import { extractURLs, getDismissed, addDismissed, dismissedKey } from './embeds'

describe('extractURLs', () => {
  it('returns empty array when no URLs', () => {
    expect(extractURLs('hello world')).toEqual([])
    expect(extractURLs('')).toEqual([])
  })

  it('extracts a single http URL', () => {
    const result = extractURLs('check out https://example.com today')
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://example.com')
    expect(result[0].isImage).toBe(false)
  })

  it('extracts a single http URL', () => {
    const result = extractURLs('see http://example.org/page')
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('http://example.org/page')
  })

  it('detects image URLs by extension', () => {
    const cases = [
      'https://cdn.example.com/photo.png',
      'https://cdn.example.com/photo.jpg',
      'https://cdn.example.com/photo.jpeg',
      'https://cdn.example.com/photo.gif',
      'https://cdn.example.com/photo.webp',
      'https://cdn.example.com/photo.svg',
    ]
    for (const url of cases) {
      const result = extractURLs(url)
      expect(result[0].isImage).toBe(true)
    }
  })

  it('marks non-image URLs as not images', () => {
    const result = extractURLs('https://example.com/document.pdf')
    expect(result[0].isImage).toBe(false)
  })

  it('strips trailing punctuation from URLs', () => {
    const result = extractURLs('See https://example.com!')
    expect(result[0].url).toBe('https://example.com')
  })

  it('strips trailing comma, semicolon, period', () => {
    expect(extractURLs('see https://a.com,')[0].url).toBe('https://a.com')
    expect(extractURLs('see https://a.com;')[0].url).toBe('https://a.com')
    expect(extractURLs('see https://a.com.')[0].url).toBe('https://a.com')
  })

  it('deduplicates the same URL', () => {
    const result = extractURLs('https://example.com and https://example.com again')
    expect(result).toHaveLength(1)
  })

  it('extracts multiple distinct URLs', () => {
    const result = extractURLs('go to https://a.com and https://b.com')
    expect(result).toHaveLength(2)
    expect(result[0].url).toBe('https://a.com')
    expect(result[1].url).toBe('https://b.com')
  })
})

describe('dismissedKey', () => {
  it('returns a string key based on message id', () => {
    expect(dismissedKey('msg-123')).toBe('embed_dismissed_msg-123')
  })
})

describe('getDismissed / addDismissed', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns empty set when nothing is stored', () => {
    const result = getDismissed('msg-1')
    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })

  it('persists and retrieves dismissed URLs', () => {
    addDismissed('msg-1', 'https://example.com')
    const result = getDismissed('msg-1')
    expect(result.has('https://example.com')).toBe(true)
  })

  it('does not mix up different message IDs', () => {
    addDismissed('msg-1', 'https://a.com')
    addDismissed('msg-2', 'https://b.com')
    expect(getDismissed('msg-1').has('https://a.com')).toBe(true)
    expect(getDismissed('msg-1').has('https://b.com')).toBe(false)
    expect(getDismissed('msg-2').has('https://b.com')).toBe(true)
  })

  it('accumulates multiple URLs for the same message', () => {
    addDismissed('msg-1', 'https://a.com')
    addDismissed('msg-1', 'https://b.com')
    const result = getDismissed('msg-1')
    expect(result.has('https://a.com')).toBe(true)
    expect(result.has('https://b.com')).toBe(true)
  })

  it('handles corrupt localStorage gracefully', () => {
    localStorage.setItem(dismissedKey('bad-msg'), 'not-valid-json{{{')
    expect(() => getDismissed('bad-msg')).not.toThrow()
    expect(getDismissed('bad-msg').size).toBe(0)
  })
})
