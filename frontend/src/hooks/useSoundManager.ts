/**
 * Sound manager hook — plays client-side audio cues for voice/chat events,
 * respecting the per-sound enable/disable settings stored in localStorage.
 *
 * Sound keys (localStorage):
 *   connectSound    → discord-join.mp3
 *   disconnectSound → discord-leave.mp3
 *   muteSound       → discord-mute.mp3
 *   unmuteSound     → discord-unmute.mp3
 *   deafenSound     → discord-deafen.mp3
 *   undeafenSound   → discord-undeafen.mp3
 *   notificationSound → discord-notification.mp3
 *   callSound       → discord-call-sound.mp3
 */

import { useCallback, useRef } from 'react'

export type SoundKey =
  | 'connectSound'
  | 'disconnectSound'
  | 'muteSound'
  | 'unmuteSound'
  | 'deafenSound'
  | 'undeafenSound'
  | 'notificationSound'
  | 'callSound'

const SOUND_FILES: Record<SoundKey, string> = {
  connectSound:      '/sounds/discord-join.mp3',
  disconnectSound:   '/sounds/discord-leave.mp3',
  muteSound:         '/sounds/discord-mute.mp3',
  unmuteSound:       '/sounds/discord-unmute.mp3',
  deafenSound:       '/sounds/discord-deafen.mp3',
  undeafenSound:     '/sounds/discord-undeafen.mp3',
  notificationSound: '/sounds/discord-notification.mp3',
  callSound:         '/sounds/discord-call-sound.mp3',
}

/** Returns true if the given sound is enabled (default: true). */
function isSoundEnabled(key: SoundKey): boolean {
  return localStorage.getItem(key) !== 'false'
}

export function useSoundManager() {
  // Cache Audio instances to avoid re-creation allocations
  const cache = useRef<Partial<Record<SoundKey, HTMLAudioElement>>>({})

  const playSound = useCallback((key: SoundKey) => {
    if (!isSoundEnabled(key)) return

    try {
      let audio = cache.current[key]
      if (!audio) {
        audio = new Audio(SOUND_FILES[key])
        audio.volume = 0.5
        cache.current[key] = audio
      }
      // Rewind if already playing so overlapping events still trigger
      audio.currentTime = 0
      audio.play().catch(() => {
        // Autoplay may be blocked before user interaction — silently ignore
      })
    } catch {
      // Ignore
    }
  }, [])

  return { playSound }
}
