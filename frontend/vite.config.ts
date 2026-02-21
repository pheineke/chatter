import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig({
  plugins: [react(), mkcert()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        configure: (proxy) => {
          const IGNORE_CODES = new Set(['ECONNABORTED', 'ECONNRESET', 'EPIPE', 'ENOTCONN'])
          const IGNORE_MSGS = ['ended by the other party', 'ECONNABORTED', 'ECONNRESET', 'EPIPE']
          const suppress = (err: NodeJS.ErrnoException) =>
            (err.code != null && IGNORE_CODES.has(err.code)) ||
            IGNORE_MSGS.some((m) => err.message?.includes(m))

          // Proxy-level errors (e.g. backend unreachable)
          proxy.on('error', (err: NodeJS.ErrnoException) => {
            if (!suppress(err)) console.error('[ws proxy]', err.message)
          })

          // Socket-level write errors from the proxy → backend socket.
          // These fire as "write ECONNABORTED" when the browser disconnects
          // while the proxy is still writing — completely normal, just noise.
          proxy.on('open', (proxySocket: NodeJS.EventEmitter) => {
            proxySocket.on('error', () => { /* suppress normal disconnect errors */ })
          })

          // Socket-level errors on the browser → proxy socket.
          proxy.on('proxyReqWs', (_proxyReq, _req, socket: NodeJS.EventEmitter) => {
            socket.on('error', () => { /* suppress normal disconnect errors */ })
          })
        },
      },
    },
  },
})
