/**
 * Desktop push notification manager.
 *
 * - Wraps the Web Notifications API.
 * - Persists user opt-in/out to localStorage.
 * - Respects DND status (no notifications when user is DND).
 * - notify() is a no-op when the tab is focused AND the user is in the target channel.
 */
import { useState, useCallback, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

const PREF_KEY = 'desktopNotificationsEnabled'
const DISMISSED_DENIED_KEY = 'desktopNotificationsDeniedDismissed'

function loadEnabled(): boolean {
  try {
    const v = localStorage.getItem(PREF_KEY)
    return v === null ? false : v === 'true'
  } catch {
    return false
  }
}

function loadDeniedDismissed(): boolean {
  try { return localStorage.getItem(DISMISSED_DENIED_KEY) === 'true' } catch { return false }
}

export interface DesktopNotificationsHook {
  /** User has opted in AND permission is granted */
  isActive: boolean
  /** User opted in but permission is not yet requested */
  isEnabled: boolean
  /** Browser permission state */
  permission: NotificationPermission | 'unsupported'
  /** User dismissed the "permission denied" banner */
  deniedDismissed: boolean
  dismissDenied: () => void
  enable: () => Promise<void>
  disable: () => void
  notify: (opts: NotifyOpts) => void
}

export interface NotifyOpts {
  title: string
  body?: string
  icon?: string
  /** React Router path to navigate to when notification is clicked */
  channelPath?: string
  /** channelId — suppresses notification when tab is focused and user is already there */
  channelId?: string
}

export function useDesktopNotifications(): DesktopNotificationsHook {
  const { user } = useAuth()
  const [isEnabled, setIsEnabled] = useState(loadEnabled)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof Notification === 'undefined') return 'unsupported'
    return Notification.permission
  })
  const [deniedDismissed, setDeniedDismissed] = useState(loadDeniedDismissed)

  // Keep permission state in sync if another tab changes it
  useEffect(() => {
    if (typeof Notification === 'undefined') return
    const id = setInterval(() => {
      setPermission(Notification.permission)
    }, 3000)
    return () => clearInterval(id)
  }, [])

  const enable = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    let perm = Notification.permission
    if (perm === 'default') {
      perm = await Notification.requestPermission()
      setPermission(perm)
    }
    if (perm === 'granted') {
      localStorage.setItem(PREF_KEY, 'true')
      setIsEnabled(true)
    }
  }, [])

  const disable = useCallback(() => {
    localStorage.setItem(PREF_KEY, 'false')
    setIsEnabled(false)
  }, [])

  const dismissDenied = useCallback(() => {
    localStorage.setItem(DISMISSED_DENIED_KEY, 'true')
    setDeniedDismissed(true)
  }, [])

  const notify = useCallback((opts: NotifyOpts) => {
    if (typeof Notification === 'undefined') return
    if (!isEnabled || permission !== 'granted') return
    // Suppress when DND
    if (user?.status === 'dnd') return
    // Suppress when tab is focused and the user is already in this channel
    if (!document.hidden && opts.channelId) {
      const path = window.location.pathname
      if (path.endsWith(opts.channelId)) return
    }

    const n = new Notification(opts.title, {
      body: opts.body,
      icon: opts.icon ?? '/icons/favicon.png',
      silent: true, // we already play a sound via useSoundManager
    })

    n.onclick = () => {
      window.focus()
      if (opts.channelPath) {
        window.location.hash = '' // force re-render if needed
        // Use history API so React Router picks it up
        window.history.pushState({}, '', opts.channelPath)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }
      n.close()
    }
  }, [isEnabled, permission, user?.status])

  const isActive = isEnabled && permission === 'granted'

  return { isActive, isEnabled, permission, deniedDismissed, dismissDenied, enable, disable, notify }
}
