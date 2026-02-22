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
