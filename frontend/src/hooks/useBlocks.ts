import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getBlocks, blockUser, unblockUser } from '../api/blocks'

export function useBlocks() {
  const qc = useQueryClient()

  const { data: blockedUsers = [] } = useQuery({
    queryKey: ['blocks'],
    queryFn: getBlocks,
    staleTime: 30_000,
  })

  const blockedIds = new Set(blockedUsers.map((u) => u.id))

  const blockMut = useMutation({
    mutationFn: (id: string) => blockUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blocks'] }),
  })

  const unblockMut = useMutation({
    mutationFn: (id: string) => unblockUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blocks'] }),
  })

  return {
    blockedIds,
    blockedUsers,
    block: (id: string) => blockMut.mutate(id),
    unblock: (id: string) => unblockMut.mutate(id),
    isPending: blockMut.isPending || unblockMut.isPending,
  }
}
