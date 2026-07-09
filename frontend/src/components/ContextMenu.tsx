import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { BottomSheet } from './BottomSheet'

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
  beforeItems?: ReactNode
}

export function ContextMenu({ x, y, items, onClose, slideDown, width, beforeItems }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  const triggerClose = useCallback(() => {
    if (!slideDown) { onClose(); return }
    setClosing(true)
  }, [slideDown, onClose])

  // Bottom sheet on mobile
  if (isMobile) {
    return (
      <BottomSheet open onClose={onClose}>
        {beforeItems}
        <div className="py-1">
          {items.map((item, i) => (
            item.separator
              ? <div key={`sep-${i}`} className="my-2 mx-2 border-t border-sp-divider/60" />
              : <button
                  key={item.label}
                  onClick={() => { item.onClick?.(); onClose() }}
                  className={`flex items-center gap-3 px-4 py-3 mx-1 text-left rounded-xl w-[calc(100%-8px)] transition-colors
                    ${item.danger
                      ? 'text-red-400 hover:bg-red-500/15 active:bg-red-500/20'
                      : item.active
                        ? 'text-sp-mention bg-sp-mention/15'
                        : 'text-sp-text hover:bg-sp-hover active:bg-sp-hover'}`}
                >
                  {item.icon && <Icon name={item.icon} size={20} className="shrink-0" />}
                  <span className="flex-1 text-[15px]">{item.label}</span>
                  {item.active && <Icon name="checkmark" size={18} className="shrink-0 text-sp-mention" />}
                </button>
          ))}
        </div>
      </BottomSheet>
    )
  }

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
    if (rect.left < 0) {
      menu.style.left = '8px'
    }
    if (rect.top < 0) {
      menu.style.top = '8px'
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
      className={`fixed z-[9999] bg-sp-popup border border-sp-divider/60 shadow-sp-3 py-1.5 md:text-sm text-[15px]${
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
              className={`flex items-center gap-2.5 md:px-3 px-4 md:py-1.5 py-2.5 mx-1 text-left transition-all rounded-full w-[calc(100%-8px)]
                ${item.danger
                  ? 'text-red-400 hover:bg-red-500/15 hover:text-red-300'
                  : item.active
                    ? 'text-sp-mention bg-sp-mention/15'
                    : 'text-sp-text hover:bg-sp-hover'}`}
            >
              {item.icon && <Icon name={item.icon} size={18} className="shrink-0" />}
              <span className="flex-1">{item.label}</span>
              {item.active && <Icon name="checkmark" size={16} className="shrink-0 text-sp-mention" />}
            </button>
      ))}
    </div>,
    document.body,
  )
}
