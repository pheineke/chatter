import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Shown at the bottom of the screen when Workbox detects a new app version.
 * The user can reload immediately or dismiss the prompt.
 */
export function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      // Poll for updates every 60 minutes while the tab is open
      if (r) {
        setInterval(() => r.update(), 60 * 60 * 1000)
      }
    },
  })

  if (!needRefresh) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-lg bg-discord-sidebar border border-discord-border shadow-xl text-sm">
      <span className="text-discord-text">A new version of Chat is available.</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
      >
        Reload
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        className="px-3 py-1.5 rounded bg-discord-input hover:bg-discord-muted/30 text-discord-muted hover:text-discord-text transition-colors"
      >
        Dismiss
      </button>
    </div>
  )
}
