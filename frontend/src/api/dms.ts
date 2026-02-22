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
