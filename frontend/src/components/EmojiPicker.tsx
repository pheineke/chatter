import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'

interface Props {
  /** Called with the native emoji string (e.g. "👍") */
  onPick: (emoji: string) => void
  onClose: () => void
  /** Preferred top-left anchor in viewport coords. The picker repositions itself if it overflows. */
  position: { x: number; y: number }
}

const PICKER_W = 352
const PICKER_H = 435

export function EmojiPicker({ onPick, onClose, position }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Clamp to viewport
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.min(position.x, vw - PICKER_W - 8)
  const top = position.y + PICKER_H > vh ? position.y - PICKER_H : position.y

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    // Use mousedown so it fires before the button's onClick potentially re-opens the picker
    window.addEventListener('mousedown', handleMouseDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('mousedown', handleMouseDown)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', left, top, zIndex: 9999 }}
      // Stop propagation so mousedown inside the picker doesn't close it
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Picker
        data={data}
        theme="dark"
        onEmojiSelect={(e: { native: string }) => {
          onPick(e.native)
          onClose()
        }}
        previewPosition="none"
        skinTonePosition="search"
        navPosition="top"
        perLine={9}
        emojiSize={28}
        emojiButtonSize={36}
      />
    </div>,
    document.body,
  )
}
