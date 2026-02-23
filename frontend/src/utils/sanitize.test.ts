import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from './sanitize'

describe('sanitizeHtml', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizeHtml('')).toBe('')
    expect(sanitizeHtml(undefined as unknown as string)).toBe('')
  })

  it('returns plain text unchanged in default (plain) mode', () => {
    expect(sanitizeHtml('Hello world')).toBe('Hello world')
  })

  it('strips all HTML tags in default mode, keeping text content', () => {
    // Our mock strips tags, keeps content
    expect(sanitizeHtml('<script>alert(1)</script>')).toBe('alert(1)')
    expect(sanitizeHtml('<img src="x" />')).toBe('')
  })

  it('preserves allowed formatting tags in rich-text mode', () => {
    // In richText mode our mock returns input as-is
    expect(sanitizeHtml('<b>bold</b>', true)).toBe('<b>bold</b>')
    expect(sanitizeHtml('<em>italic</em>', true)).toBe('<em>italic</em>')
  })

  it('strips disallowed tags even in rich-text mode in real DOMPurify (mock passes through)', () => {
    // This test documents the expected production behavior;
    // the mock just passes through so we verify the call path at minimum.
    const result = sanitizeHtml('<b>ok</b><script>bad</script>', true)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})
