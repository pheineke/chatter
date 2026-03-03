/**
 * Sound manager hook — plays client-side audio cues for voice/chat events,
 * respecting the per-sound enable/disable settings stored in localStorage.
 *
 * Sound keys (localStorage):
 *   connectSound    → sp-join.mp3
 *   disconnectSound → sp-leave.mp3
 *   muteSound       → sp-mute.mp3
 *   unmuteSound     → sp-unmute.mp3
 *   deafenSound     → sp-deafen.mp3
 *   undeafenSound   → sp-undeafen.mp3
 *   notificationSound → sp-notification.mp3
 *   callSound       → sp-call-sound.mp3
 */

import { useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'

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
  connectSound:      '/sounds/sp-join.mp3',
  disconnectSound:   '/sounds/sp-leave.mp3',
  muteSound:         '/sounds/sp-mute.mp3',
  unmuteSound:       '/sounds/sp-unmute.mp3',
  deafenSound:       '/sounds/sp-deafen.mp3',
  undeafenSound:     '/sounds/sp-undeafen.mp3',
  notificationSound: '/sounds/sp-notification.mp3',
  callSound:         '/sounds/sp-call-sound.mp3',
}

/** Returns true if the given sound is enabled (default: true). */
function isSoundEnabled(key: SoundKey): boolean {
  return localStorage.getItem(key) !== 'false'
}

/** Returns the current sound volume as a 0–1 float (default: 0.5). */
function getSoundVolume(): number {
  const stored = localStorage.getItem('soundVolume')
  return stored !== null ? Math.min(1, Math.max(0, Number(stored) / 100)) : 0.5
}

export function useSoundManager() {
  const { user } = useAuth()
  // Cache Audio instances to avoid re-creation allocations
  const cache = useRef<Partial<Record<SoundKey, HTMLAudioElement>>>({})
  // Use a ref so playSound (empty-dep callback) can always read the latest status
  const userRef = useRef(user)
  userRef.current = user

  const playSound = useCallback((key: SoundKey) => {
    // DND mode: suppress all notification/chat sounds (but allow voice sounds like mute)
    if (userRef.current?.status === 'dnd' && (key === 'notificationSound' || key === 'callSound')) return
    if (!isSoundEnabled(key)) return

    try {
      let audio = cache.current[key]
      if (!audio) {
        audio = new Audio(SOUND_FILES[key])
        cache.current[key] = audio
      }
      // Read volume fresh each play so settings changes take effect immediately
      audio.volume = getSoundVolume()
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
