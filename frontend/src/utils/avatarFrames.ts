/** Registry of available avatar decoration frames. */

export interface AvatarFrame {
  /** Unique key stored in the database (e.g. "lotus") */
  id: string
  /** Display name shown in the picker */
  label: string
  /** Path under /avatar-frames/ to the SVG file */
  src: string
}

export const AVATAR_FRAMES: AvatarFrame[] = [
  { id: 'lotus', label: 'Lotus', src: '/avatar-frames/lotus.svg' },
]
