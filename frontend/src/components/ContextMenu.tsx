import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export interface ContextMenuItem {
  label: string
  icon: string
  onClick: () => void
  danger?: boolean
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Adjust position so menu stays within viewport
  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      menu.style.left = `${x - rect.width}px`
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${y - rect.height}px`
    }
  }, [x, y])

  // Close on outside click or Escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      style={{ top: y, left: x }}
      className="fixed z-[9999] min-w-[180px] bg-discord-bg border border-black/30 rounded-md shadow-xl py-1 text-sm"
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => { item.onClick(); onClose() }}
          className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors
            ${item.danger
              ? 'text-red-400 hover:bg-red-500 hover:text-white'
              : 'text-discord-text hover:bg-discord-mention'}`}
        >
          <Icon name={item.icon} size={16} className="shrink-0" />
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
