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
 * Opens a WebSocket to `path` and calls `onMessage` for every incoming JSON
 * frame. Reconnects automatically with exponential back-off.
 *
 * Auth: the token is never put in the URL (query strings end up in proxy
 * access logs, APM tools, etc., and browsers give WebSocket no way to set
 * an Authorization header). Instead, as soon as the socket opens, the first
 * frame sent is {"type": "auth", "token": "<jwt>"}; the server replies
 * {"type": "auth.ok", ...} once it has validated it. The consumer's
 * `onOpen` callback — and forwarding of any further messages to
 * `onMessage` — is deferred until that ack arrives, so callers can treat
 * `onOpen` as "authenticated and ready" exactly like before.
 *
 * Close code 4001 (expired/invalid token) triggers a token refresh before
 * the next reconnect attempt. Code 4008 (server gave up waiting for the
 * auth frame) is treated the same as any other drop — reconnect with
 * back-off.
 */
export function useWebSocket(path: string, { onMessage, onOpen, enabled = true }: Options) {
  const wsRef = useRef<WebSocket | null>(null)
  const authenticatedRef = useRef(false)   // gates send() until auth.ok is received
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

    const url = `${WS_BASE}${path}`
    const wsScheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(url.startsWith('ws') ? url : `${wsScheme}://${location.host}${url}`)
    wsRef.current = ws
    authenticatedRef.current = false

    ws.onmessage = (e) => {
      if (generation.current !== gen) return
      let msg: WSMessage
      try {
        msg = JSON.parse(e.data) as WSMessage
      } catch {
        return   // ignore malformed frames
      }

      if (!authenticatedRef.current) {
        // The only frame we expect before auth.ok is auth.ok itself.
        if (msg.type === 'auth.ok') {
          authenticatedRef.current = true
          reconnectDelay.current = 1000
          onOpenRef.current?.()
        }
        return
      }

      onMessageRef.current(msg)
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
      // Authenticate immediately — this is the first frame the server sees.
      ws.send(JSON.stringify({ type: 'auth', token }))
    }
  }, [path, enabled])

  useEffect(() => {
    const gen = ++generation.current
    connect(gen)
    return () => {
      generation.current++       // invalidate this generation; disables all callbacks
      authenticatedRef.current = false
      if (wsRef.current) {
        wsRef.current.onclose = null   // prevent the close handler triggering a reconnect
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  const send = useCallback((data: unknown) => {
    // authenticatedRef guards against ever sending a non-auth frame before
    // the server has acked {"type": "auth.ok"} — the server treats
    // anything else as protocol violation on first frame and closes.
    if (authenticatedRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  return { send }
}