import { useEffect, useRef, useCallback } from 'react'

const WS_BASE = import.meta.env.VITE_WS_URL ?? ''  // empty = use vite proxy
const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export type WSMessage = { type: string; data?: unknown } & Record<string, unknown>

interface Options {
  onMessage: (msg: WSMessage) => void
  onOpen?: () => void
  enabled?: boolean
}

/** Attempt a silent token refresh. Returns true if successful. */
async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken) return false
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!res.ok) return false
    const data = await res.json()
    localStorage.setItem('token', data.access_token)
    localStorage.setItem('refreshToken', data.refresh_token)
    return true
  } catch {
    return false
  }
}

/**
 * Opens a WebSocket to `path?token=<JWT>` and calls `onMessage` for every
 * incoming JSON frame. Reconnects automatically with exponential back-off.
 *
 * Close code 4001 (expired/invalid token) triggers a token refresh before
 * the next reconnect attempt.
 */
export function useWebSocket(path: string, { onMessage, onOpen, enabled = true }: Options) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectDelay = useRef(1000)
  const generation = useRef(0)   // incremented on every cleanup so stale callbacks self-discard
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  const connect = useCallback((gen: number) => {
    if (generation.current !== gen) return   // a newer generation took over
    if (!enabled) return
    const token = localStorage.getItem('token')
    if (!token) return

    const url = `${WS_BASE}${path}?token=${token}`
    const wsScheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(url.startsWith('ws') ? url : `${wsScheme}://${location.host}${url}`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      if (generation.current !== gen) return
      try {
        const msg = JSON.parse(e.data) as WSMessage
        onMessageRef.current(msg)
      } catch {
        /* ignore malformed frames */
      }
    }

    ws.onclose = (event) => {
      if (generation.current !== gen) return   // cleanup already ran — don't reconnect

      const delay = reconnectDelay.current
      reconnectDelay.current = Math.min(delay * 2, 30_000)

      if (event.code === 4001) {
        // Token rejected — try to refresh before reconnecting
        tryRefreshToken().then((ok) => {
          if (!ok) {
            // Refresh failed: clear auth and redirect to login
            localStorage.removeItem('token')
            localStorage.removeItem('refreshToken')
            if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
              window.location.href = '/login'
            }
            return
          }
          setTimeout(() => connect(gen), delay)
        })
      } else {
        setTimeout(() => connect(gen), delay)
      }
    }

    ws.onopen = () => {
      if (generation.current !== gen) return
      reconnectDelay.current = 1000
      onOpenRef.current?.()
    }
  }, [path, enabled])

  useEffect(() => {
    const gen = ++generation.current
    connect(gen)
    return () => {
      generation.current++       // invalidate this generation; disables all callbacks
      if (wsRef.current) {
        wsRef.current.onclose = null   // prevent the close handler triggering a reconnect
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  return { send }
}