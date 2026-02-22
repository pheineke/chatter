import { createContext, useContext, useCallback, useState, type ReactNode } from 'react'

interface UnreadCtx {
  unreadChannels: Set<string>
  markRead: (channelId: string) => void
  notifyMessage: (channelId: string) => void
}

const Ctx = createContext<UnreadCtx>({
  unreadChannels: new Set(),
  markRead: () => {},
  notifyMessage: () => {},
})

export function UnreadChannelsProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState<Set<string>>(new Set())

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

  return (
    <Ctx.Provider value={{ unreadChannels: unread, markRead, notifyMessage }}>
      {children}
    </Ctx.Provider>
  )
}

export function useUnreadChannels() {
  return useContext(Ctx)
}
