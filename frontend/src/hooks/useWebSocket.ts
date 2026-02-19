import { useEffect, useRef, useCallback } from 'react'

const WS_BASE = import.meta.env.VITE_WS_URL ?? ''  // empty = use vite proxy

export type WSMessage = { type: string; data?: unknown } & Record<string, unknown>

interface Options {
  onMessage: (msg: WSMessage) => void
  enabled?: boolean
}

/**
 * Opens a WebSocket to `path?token=<JWT>` and calls `onMessage` for every
 * incoming JSON frame. Reconnects automatically with exponential back-off.
 */
export function useWebSocket(path: string, { onMessage, enabled = true }: Options) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectDelay = useRef(1000)
  const unmounted = useRef(false)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (!enabled || unmounted.current) return
    const token = localStorage.getItem('token')
    if (!token) return

    const url = `${WS_BASE}${path}?token=${token}`
    const ws = new WebSocket(url.startsWith('ws') ? url : `ws://${location.host}${url}`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WSMessage
        onMessageRef.current(msg)
      } catch {
        /* ignore malformed frames */
      }
    }

    ws.onclose = () => {
      if (unmounted.current) return
      const delay = reconnectDelay.current
      reconnectDelay.current = Math.min(delay * 2, 30_000)
      setTimeout(connect, delay)
    }

    ws.onopen = () => {
      reconnectDelay.current = 1000
    }
  }, [path, enabled])

  useEffect(() => {
    unmounted.current = false
    connect()
    return () => {
      unmounted.current = true
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  return { send }
}
