import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export interface ContextMenuItem {
  label?: string
  icon?: string
  onClick?: () => void
  danger?: boolean
  active?: boolean
  separator?: boolean
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
  slideDown?: boolean
  width?: number
}

export function ContextMenu({ x, y, items, onClose, slideDown, width }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)

  const triggerClose = useCallback(() => {
    if (!slideDown) { onClose(); return }
    setClosing(true)
  }, [slideDown, onClose])

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
        triggerClose()
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') triggerClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [triggerClose])

  return createPortal(
    <div
      ref={menuRef}
      style={{ top: y, left: x, ...(width ? { width } : {}) }}
      onAnimationEnd={closing ? onClose : undefined}
      className={`fixed z-[9999] bg-sp-popup border border-sp-divider/60 shadow-sp-3 py-1.5 text-sm${
        slideDown
          ? ` border-t-0 rounded-b-sp-lg ${closing ? 'context-slide-up' : 'context-slide-down'}`
          : ' min-w-[180px] rounded-sp-lg'
      }`}
    >
      {items.map((item, i) => (
        item.separator
          ? <div key={`sep-${i}`} className="my-1.5 border-t border-sp-divider/60" />
          : <button
              key={item.label}
              onClick={() => { item.onClick?.(); onClose() }}
              className={`flex items-center gap-2.5 px-3 py-1.5 mx-1 text-left transition-all rounded-full w-[calc(100%-8px)]
                ${item.danger
                  ? 'text-red-400 hover:bg-red-500/15 hover:text-red-300'
                  : item.active
                    ? 'text-sp-mention bg-sp-mention/15'
                    : 'text-sp-text hover:bg-sp-hover'}`}
            >
              {item.icon && <Icon name={item.icon} size={16} className="shrink-0" />}
              <span className="flex-1">{item.label}</span>
              {item.active && <Icon name="checkmark" size={14} className="shrink-0 text-sp-mention" />}
            </button>
      ))}
    </div>,
    document.body,
  )
}
