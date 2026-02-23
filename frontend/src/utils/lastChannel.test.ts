import { describe, it, expect, beforeEach } from 'vitest'
import { getLastChannel, setLastChannel } from './lastChannel'

describe('getLastChannel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when nothing is stored', () => {
    expect(getLastChannel('server-1')).toBeNull()
  })

  it('returns the channel ID that was set', () => {
    setLastChannel('server-1', 'chan-42')
    expect(getLastChannel('server-1')).toBe('chan-42')
  })

  it('is namespaced per server ID', () => {
    setLastChannel('server-1', 'chan-A')
    setLastChannel('server-2', 'chan-B')
    expect(getLastChannel('server-1')).toBe('chan-A')
    expect(getLastChannel('server-2')).toBe('chan-B')
  })

  it('overwrites when set twice', () => {
    setLastChannel('server-1', 'chan-old')
    setLastChannel('server-1', 'chan-new')
    expect(getLastChannel('server-1')).toBe('chan-new')
  })
})
