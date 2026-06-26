import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { applyColorOverrides, loadColorOverrides, DEFAULT_DARK_OVERRIDES } from './utils/colorOverrides'

// Apply persisted color theme before first render.
// If we have a cached user with server-side theme, prefer that to avoid flash.
;(() => {
  try {
    const cached = localStorage.getItem('cachedUser')
    if (cached) {
      const u = JSON.parse(cached)
      if (u.theme_colors) {
        applyColorOverrides(JSON.parse(u.theme_colors))
        return
      }
    }
  } catch { /* ignore */ }
  applyColorOverrides(loadColorOverrides())
})()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
