import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWebSocket } from './useWebSocket'
import { setAccessToken } from '../api/tokenStore'

/** Minimal stand-in for the browser WebSocket: records instances so tests can drive them. */
class FakeWS {
  static instances: FakeWS[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  sent: string[] = []
  constructor(public url: string) { FakeWS.instances.push(this) }
  send(data: string) { this.sent.push(data) }
  close() {}
  // test helpers
  open() { this.onopen?.() }
  receive(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }) }
  serverClose(code: number) { this.onclose?.({ code }) }
}

describe('useWebSocket close handling', () => {
  beforeEach(() => {
    FakeWS.instances = []
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWS)
    setAccessToken('tok')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    localStorage.clear()
    setAccessToken(null)
  })

  function connectAndAuth() {
    const onRejected = vi.fn()
    const onOpen = vi.fn()
    renderHook(() => useWebSocket('/ws/channels/c1', { onMessage: () => {}, onOpen, onRejected }))
    const ws = FakeWS.instances[0]
    act(() => { ws.open(); ws.receive({ type: 'auth.ok' }) })
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'auth', token: 'tok' })
    expect(onOpen).toHaveBeenCalledOnce()
    return { ws, onRejected }
  }

  it.each([4003, 4004])('stops reconnecting and calls onRejected on %i', (code) => {
    const { ws, onRejected } = connectAndAuth()
    act(() => { ws.serverClose(code) })
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(onRejected).toHaveBeenCalledWith(code)
    expect(FakeWS.instances).toHaveLength(1) // no new connection attempt
  })

  it('reconnects with back-off on an ordinary drop', () => {
    const { ws, onRejected } = connectAndAuth()
    act(() => { ws.serverClose(1006) })
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(onRejected).not.toHaveBeenCalled()
    expect(FakeWS.instances).toHaveLength(2)
  })
})
