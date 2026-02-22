import { createContext, useContext, useCallback, useState, type ReactNode } from 'react'

interface UnreadCtx {
  unreadChannels: Set<string>
  unreadServers: Set<string>
  markRead: (channelId: string) => void
  notifyMessage: (channelId: string) => void
  notifyServer: (serverId: string) => void
  markServerRead: (serverId: string) => void
}

const Ctx = createContext<UnreadCtx>({
  unreadChannels: new Set(),
  unreadServers: new Set(),
  markRead: () => {},
  notifyMessage: () => {},
  notifyServer: () => {},
  markServerRead: () => {},
})

export function UnreadChannelsProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState<Set<string>>(new Set())
  const [unreadServers, setUnreadServers] = useState<Set<string>>(new Set())

  const markRead = useCallback((channelId: string) => {
    setUnread((prev) => {
      if (!prev.has(channelId)) return prev
      const next = new Set(prev)
      next.delete(channelId)
      return next
    })
  }, [])

  const notifyMessage = useCallback((channelId: string) => {
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
    setUnreadServers((prev) => {
      if (!prev.has(serverId)) return prev
      const next = new Set(prev)
      next.delete(serverId)
      return next
    })
  }, [])

  return (
    <Ctx.Provider value={{ unreadChannels: unread, unreadServers, markRead, notifyMessage, notifyServer, markServerRead }}>
      {children}
    </Ctx.Provider>
  )
}

export function useUnreadChannels() {
  return useContext(Ctx)
}
