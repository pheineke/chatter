import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getNotificationSettings,
  setChannelNotification,
  setServerNotification,
  type NotificationLevel,
} from '../api/notifications'

const QUERY_KEY = ['notificationSettings']

/**
 * Fetch and cache per-channel / per-server notification preferences.
 *
 * Returns:
 *   channelLevel(id)   → 'all' | 'mentions' | 'mute'  (defaults to 'all')
 *   serverLevel(id)    → 'all' | 'mentions' | 'mute'  (defaults to 'all')
 *   setChannelLevel(id, level)  → fires mutation + optimistic update
 *   setServerLevel(id, level)   → fires mutation + optimistic update
 */
export function useNotificationSettings() {
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getNotificationSettings,
    staleTime: 60_000,
    // Return empty maps as a safe default so callers never crash.
    placeholderData: { channels: {}, servers: {} },
  })

  const channelMutation = useMutation({
    mutationFn: ({ id, level }: { id: string; level: NotificationLevel }) =>
      setChannelNotification(id, level),
    onMutate: async ({ id, level }) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY })
      const prev = qc.getQueryData(QUERY_KEY)
      qc.setQueryData(QUERY_KEY, (old: typeof data) => ({
        ...old,
        channels: { ...(old?.channels ?? {}), [id]: level },
      }))
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(QUERY_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  })

  const serverMutation = useMutation({
    mutationFn: ({ id, level }: { id: string; level: NotificationLevel }) =>
      setServerNotification(id, level),
    onMutate: async ({ id, level }) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY })
      const prev = qc.getQueryData(QUERY_KEY)
      qc.setQueryData(QUERY_KEY, (old: typeof data) => ({
        ...old,
        servers: { ...(old?.servers ?? {}), [id]: level },
      }))
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(QUERY_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  })

  return {
    channelLevel: (id: string): NotificationLevel => data?.channels[id] ?? 'all',
    serverLevel: (id: string): NotificationLevel => data?.servers[id] ?? 'all',
    setChannelLevel: (id: string, level: NotificationLevel) =>
      channelMutation.mutate({ id, level }),
    setServerLevel: (id: string, level: NotificationLevel) =>
      serverMutation.mutate({ id, level }),
  }
}
