/**
 * Updates the browser tab title and favicon to indicate unread messages.
 *
 * - Title: "(N) Chat" when unread, "Chat" when clear
 * - Favicon: small red dot badge overlaid on the app icon
 * - Suppressed while the user is in Do Not Disturb mode
 */
import { useEffect } from 'react'

const APP_NAME = 'Chat'

function drawFavicon(hasUnread: boolean): void {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Dark rounded background
  ctx.fillStyle = '#36393f'
  ctx.beginPath()
  ctx.roundRect(0, 0, 32, 32, 6)
  ctx.fill()

  // Purple speech bubble
  ctx.fillStyle = '#7289da'
  ctx.beginPath()
  ctx.roundRect(4, 4, 20, 15, 4)
  ctx.fill()
  // Bubble tail
  ctx.beginPath()
  ctx.moveTo(7, 19)
  ctx.lineTo(4, 26)
  ctx.lineTo(14, 19)
  ctx.closePath()
  ctx.fill()

  // Red dot badge (bottom-right) — only when unread
  if (hasUnread) {
    // White outline ring for contrast
    ctx.fillStyle = '#36393f'
    ctx.beginPath()
    ctx.arc(25, 25, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#f04747'
    ctx.beginPath()
    ctx.arc(25, 25, 7, 0, Math.PI * 2)
    ctx.fill()
  }

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = canvas.toDataURL('image/png')
}

export function useTabBadge(count: number, isDND = false): void {
  useEffect(() => {
    const hasUnread = count > 0 && !isDND
    document.title = hasUnread ? `(${count}) ${APP_NAME}` : APP_NAME
    drawFavicon(hasUnread)

    return () => {
      document.title = APP_NAME
      drawFavicon(false)
    }
  }, [count, isDND])
}
