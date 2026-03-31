import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
import type { CustomEmoji } from '../api/types'
import { asCustomEmojiToken } from '../utils/customEmojis'

interface Props {
  /** Called with the native emoji string (e.g. "👍") */
  onPick: (emoji: string) => void
  onClose: () => void
  /** Preferred top-left anchor in viewport coords. The picker repositions itself if it overflows. */
  position: { x: number; y: number }
  customEmojis?: CustomEmoji[]
}

const PICKER_W = 352
const PICKER_H = 435

export function EmojiPicker({ onPick, onClose, position, customEmojis = [] }: Props) {
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
      {customEmojis.length > 0 && (
        <div className="mb-2 w-[352px] rounded-lg border border-sp-divider/50 bg-sp-popup p-2 shadow-sp-2">
          <div className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wider text-sp-muted">Server Emojis</div>
          <div className="grid grid-cols-8 gap-1">
            {customEmojis.slice(0, 48).map((emoji) => (
              <button
                key={emoji.id}
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-sp-hover"
                title={`:${emoji.name}:`}
                onClick={() => {
                  onPick(asCustomEmojiToken(emoji.id))
                  onClose()
                }}
              >
                <img
                  src={`/api/static/${emoji.image_path}`}
                  alt={emoji.name}
                  className="h-6 w-6 object-contain"
                />
              </button>
            ))}
          </div>
        </div>
      )}
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
