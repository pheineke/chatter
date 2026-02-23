import { describe, it, expect, beforeEach } from 'vitest'
import { loadColorOverrides, applyColorOverrides } from './colorOverrides'

describe('loadColorOverrides', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns empty object when nothing stored', () => {
    expect(loadColorOverrides()).toEqual({})
  })

  it('returns stored overrides', () => {
    localStorage.setItem('colorOverrides', JSON.stringify({ accent: '#ff0000', bg: '#222222' }))
    expect(loadColorOverrides()).toEqual({ accent: '#ff0000', bg: '#222222' })
  })

  it('returns empty object on corrupt JSON', () => {
    localStorage.setItem('colorOverrides', '{not-valid-json')
    expect(loadColorOverrides()).toEqual({})
  })
})

describe('applyColorOverrides', () => {
  beforeEach(() => {
    // Remove any pre-existing style tag
    document.getElementById('color-overrides')?.remove()
  })

  it('creates a <style id="color-overrides"> element in <head>', () => {
    applyColorOverrides({ accent: '#ff0000' })
    const tag = document.getElementById('color-overrides')
    expect(tag).not.toBeNull()
    expect(tag!.tagName.toLowerCase()).toBe('style')
  })

  it('injects CSS for the given color key', () => {
    applyColorOverrides({ accent: '#ff0000' })
    const tag = document.getElementById('color-overrides') as HTMLStyleElement
    expect(tag.textContent).toContain('#ff0000')
  })

  it('reuses the existing style tag on subsequent calls', () => {
    applyColorOverrides({ accent: '#aabbcc' })
    applyColorOverrides({ accent: '#112233' })
    const tags = document.querySelectorAll('#color-overrides')
    expect(tags.length).toBe(1)
    expect((tags[0] as HTMLStyleElement).textContent).toContain('#112233')
  })

  it('produces empty CSS when no overrides are given', () => {
    applyColorOverrides({})
    const tag = document.getElementById('color-overrides') as HTMLStyleElement
    // textContent may be empty or just whitespace
    expect((tag.textContent ?? '').trim()).toBe('')
  })

  it('ignores unknown color keys', () => {
    applyColorOverrides({ nonexistent: '#ffffff' } as Record<string, string>)
    const tag = document.getElementById('color-overrides') as HTMLStyleElement
    expect((tag.textContent ?? '').trim()).toBe('')
  })
})
