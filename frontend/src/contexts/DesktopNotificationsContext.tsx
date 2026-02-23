import { createContext, useContext, type ReactNode } from 'react'
import { useDesktopNotifications, type DesktopNotificationsHook } from '../hooks/useDesktopNotifications'

const Ctx = createContext<DesktopNotificationsHook | null>(null)

export function DesktopNotificationsProvider({ children }: { children: ReactNode }) {
  const value = useDesktopNotifications()
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDesktopNotificationsContext(): DesktopNotificationsHook {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDesktopNotificationsContext must be used within DesktopNotificationsProvider')
  return ctx
}
