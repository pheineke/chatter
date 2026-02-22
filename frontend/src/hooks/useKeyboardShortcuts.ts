import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

interface Options {
  onOpenQuickSwitcher: () => void
  onOpenShortcuts: () => void
  /** Ordered list of channel nav paths (e.g. "/channels/serverId/channelId") */
  channelPaths?: string[]
  currentPath?: string
}

/**
 * Global keyboard shortcuts:
 *  - Ctrl+K / Cmd+K  → open quick switcher
 *  - Ctrl+/           → open shortcuts cheat-sheet
 *  - Alt+↑            → navigate to previous channel
 *  - Alt+↓            → navigate to next channel
 */
export function useKeyboardShortcuts({ onOpenQuickSwitcher, onOpenShortcuts, channelPaths = [], currentPath = '' }: Options) {
  const navigate = useNavigate()

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Skip when user is typing in an input/textarea/select
    const tag = (e.target as HTMLElement)?.tagName
    const isInputFocused = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault()
      onOpenQuickSwitcher()
      return
    }

    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      if (!isInputFocused) {
        e.preventDefault()
        onOpenShortcuts()
      }
      return
    }

    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && channelPaths.length > 0) {
      e.preventDefault()
      const idx = channelPaths.indexOf(currentPath)
      let nextIdx: number
      if (idx === -1) {
        nextIdx = e.key === 'ArrowDown' ? 0 : channelPaths.length - 1
      } else if (e.key === 'ArrowUp') {
        nextIdx = (idx - 1 + channelPaths.length) % channelPaths.length
      } else {
        nextIdx = (idx + 1) % channelPaths.length
      }
      navigate(channelPaths[nextIdx])
    }
  }, [onOpenQuickSwitcher, onOpenShortcuts, channelPaths, currentPath, navigate])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
