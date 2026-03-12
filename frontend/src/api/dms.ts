import client from './client'
import type { DMConversation } from './types'

export async function getConversations(): Promise<DMConversation[]> {
  const { data } = await client.get<DMConversation[]>('/dms/conversations')
  return data
}

export async function getDMChannel(userId: string): Promise<{ channel_id: string }> {
  const { data } = await client.get<{ channel_id: string }>(`/dms/${userId}/channel`)
  return data
}

export async function markDMRead(channelId: string, lastReadAt?: string): Promise<{ channel_id: string; last_read_at: string }> {
  const { data } = await client.put<{ channel_id: string; last_read_at: string }>(
    `/dms/channels/${channelId}/read`,
    { last_read_at: lastReadAt },
  )
  return data
}
