import { useEffect, useRef, type ReactNode } from 'react'
import { Portal } from './Portal'

interface Props {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export function BottomSheet({ open, onClose, children }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const startY = useRef(0)
  const currentY = useRef(0)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  function onTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0].clientY
  }

  function onTouchMove(e: React.TouchEvent) {
    const dy = e.touches[0].clientY - startY.current
    if (dy > 0 && sheetRef.current) {
      currentY.current = dy
      sheetRef.current.style.transform = `translateY(${dy}px)`
    }
  }

  function onTouchEnd() {
    if (currentY.current > 100 && sheetRef.current) {
      sheetRef.current.style.transform = ''
      currentY.current = 0
      onClose()
    } else if (sheetRef.current) {
      sheetRef.current.style.transform = ''
      currentY.current = 0
    }
  }

  if (!open) return null

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[100] flex items-end"
        onClick={onClose}
      >
        <div className="fixed inset-0 bg-black/60" />
        <div
          ref={sheetRef}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-h-[85vh] bg-sp-popup rounded-t-2xl shadow-sp-3 flex flex-col animate-slide-up pb-safe-bottom"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="flex justify-center pt-2 pb-1 shrink-0">
            <div className="w-8 h-1 rounded-full bg-sp-muted/40" />
          </div>
          <div className="overflow-y-auto flex-1 px-2 pb-4">
            {children}
          </div>
        </div>
      </div>
    </Portal>
  )
}
