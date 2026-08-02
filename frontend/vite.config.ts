/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    mkcert(),
    VitePWA({
      registerType: 'prompt',
      devOptions: { enabled: true },
      includeAssets: ['icon.svg', 'pwa-180.png'],
      manifest: {
        name: 'Chat',
        short_name: 'Chat',
        description: 'Discord-inspired real-time chat',
        theme_color: '#1e1f22',
        background_color: '#1e1f22',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png',          sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png',          sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache all Vite build output
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // Never cache API, WebSocket, or user-uploaded static files
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/static/, /^\/ws/],
        runtimeCaching: [
          {
            // Serve icons and sounds from cache-first (long TTL)
            urlPattern: /\/public\/(icons|sounds)\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // All API calls are always network-only — never serve stale data
            urlPattern: /^\/api\/.*/,
            handler: 'NetworkOnly',
          },
          {
            // User-uploaded content (avatars, attachments) — network-only
            urlPattern: /^\/static\/.*/,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      // ts-mls's public entry point (index.js) unconditionally re-exports
      // `nobleCryptoProvider` alongside the `defaultCryptoProvider` we
      // actually use (see src/mls/session.ts) — that pulls in a static
      // top-level `import { gcm } from "@noble/ciphers/aes.js"`, which is why
      // `@noble/ciphers` is a real (not externalized) dependency below, pinned
      // to the exact version ts-mls's peerDependencies requires.
      //
      // `@hpke/chacha20poly1305` is different: it's only reached via a
      // dynamic `import()` inside the CHACHA20POLY1305 branch of makeAead.js,
      // guarded by try/catch. We only use the
      // MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 ciphersuite (see
      // CIPHERSUITE_NAME), so that branch never executes — safe to
      // externalize per Rollup's own suggestion rather than installing an
      // unused crypto dependency. If CHACHA20POLY1305 support is ever added,
      // install '@hpke/chacha20poly1305' as a real dependency and drop this.
      external: ['@hpke/chacha20poly1305'],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
  server: {
    host: true,
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

          // Remove Vite's built-in proxy error listener (logs "[vite] ws proxy error:")
          // and replace it with our filtered version so disconnect noise is silenced.
          proxy.removeAllListeners('error')
          proxy.on('error', (err: NodeJS.ErrnoException, _req, socket) => {
            if (suppress(err)) return
            console.error('[ws proxy]', err.message)
            if (socket && typeof (socket as any).destroy === 'function') (socket as any).destroy()
          })

          // Proxy → backend socket errors (write ECONNABORTED on browser disconnect).
          proxy.on('open', (proxySocket: NodeJS.EventEmitter) => {
            proxySocket.on('error', () => { /* suppress normal disconnect errors */ })
          })

          // Browser → proxy socket: this listener needs to remove listeners added by other handlers
          // (like Vite's own logger). We use setImmediate/setTimeout to ensure other handlers run first.
          proxy.on('proxyReqWs', (_proxyReq, _req, socket: NodeJS.EventEmitter) => {
            setTimeout(() => {
              socket.removeAllListeners('error')
              socket.on('error', (err: NodeJS.ErrnoException) => {
                if (!suppress(err)) console.error('[ws proxy socket]', err.message)
              })
            }, 0)
          })
        },
      },
    },
  },
})
