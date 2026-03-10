import { createContext, useContext, useCallback, useState, useRef, type ReactNode } from 'react'

interface UnreadCtx {
  unreadChannels: Set<string>
  unreadServers: Set<string>
  markRead: (channelId: string) => void
  notifyMessage: (channelId: string, serverId?: string) => void
  notifyServer: (serverId: string) => void
  markServerRead: (serverId: string) => void
  markAllServerRead: (serverId: string) => void
}

const Ctx = createContext<UnreadCtx>({
  unreadChannels: new Set(),
  unreadServers: new Set(),
  markRead: () => {},
  notifyMessage: () => {},
  notifyServer: () => {},
  markServerRead: () => {},
  markAllServerRead: () => {},
})

export function UnreadChannelsProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState<Set<string>>(new Set())
  const [unreadServers, setUnreadServers] = useState<Set<string>>(new Set())
  // Tracks which server each unread channel belongs to
  const channelServerMap = useRef<Map<string, string>>(new Map())

  const markRead = useCallback((channelId: string) => {
    const serverId = channelServerMap.current.get(channelId)
    channelServerMap.current.delete(channelId)
    setUnread((prev) => {
      if (!prev.has(channelId)) return prev
      const next = new Set(prev)
      next.delete(channelId)
      // Auto-clear the server dot if this was its last unread channel
      if (serverId) {
        const serverStillHasUnread = [...channelServerMap.current.values()].some(s => s === serverId)
        if (!serverStillHasUnread) {
          setUnreadServers(ps => {
            if (!ps.has(serverId)) return ps
            const ns = new Set(ps)
            ns.delete(serverId)
            return ns
          })
        }
      }
      return next
    })
  }, [])

  const notifyMessage = useCallback((channelId: string, serverId?: string) => {
    if (serverId) channelServerMap.current.set(channelId, serverId)
    setUnread((prev) => {
      if (prev.has(channelId)) return prev
      return new Set(prev).add(channelId)
    })
  }, [])

  const notifyServer = useCallback((serverId: string) => {
    setUnreadServers((prev) => {
      if (prev.has(serverId)) return prev
      return new Set(prev).add(serverId)
    })
  }, [])

  const markServerRead = useCallback((serverId: string) => {
    // Only clears the server-level dot; individual channel dots remain
    // until the user opens each channel or uses "Mark as Read".
    setUnreadServers((prev) => {
      if (!prev.has(serverId)) return prev
      const next = new Set(prev)
      next.delete(serverId)
      return next
    })
  }, [])

  const markAllServerRead = useCallback((serverId: string) => {
    // Clears the server dot AND all unread channel dots for this server.
    // Used by the "Mark as Read" context menu action.
    const toRemove: string[] = []
    channelServerMap.current.forEach((sId, chId) => {
      if (sId === serverId) toRemove.push(chId)
    })
    toRemove.forEach(chId => channelServerMap.current.delete(chId))
    if (toRemove.length > 0) {
      setUnread(prev => {
        const next = new Set(prev)
        toRemove.forEach(chId => next.delete(chId))
        return next.size === prev.size ? prev : next
      })
    }
    setUnreadServers((prev) => {
      if (!prev.has(serverId)) return prev
      const next = new Set(prev)
      next.delete(serverId)
      return next
    })
  }, [])

  return (
    <Ctx.Provider value={{ unreadChannels: unread, unreadServers, markRead, notifyMessage, notifyServer, markServerRead, markAllServerRead }}>
      {children}
    </Ctx.Provider>
  )
}

export function useUnreadChannels() {
  return useContext(Ctx)
}
