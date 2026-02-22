import client from './client'
import type { Message, DMConversation } from './types'

export async function getConversations(): Promise<DMConversation[]> {
  const { data } = await client.get<DMConversation[]>('/dms/conversations')
  return data
}

export async function getDMChannel(userId: string): Promise<{ channel_id: string }> {
  const { data } = await client.get<{ channel_id: string }>(`/dms/${userId}/channel`)
  return data
}

export async function getDMs(userId: string, before?: string, limit = 50): Promise<Message[]> {
  const { data } = await client.get<Message[]>(`/dms/${userId}`, { params: { before, limit } })
  return data
}

export async function sendDM(userId: string, content: string): Promise<Message> {
  const { data } = await client.post<Message>(`/dms/${userId}`, { content })
  return data
}

export async function deleteDM(dmId: string): Promise<void> {
  await client.delete(`/dms/${dmId}`)
}

export async function uploadDMAttachment(dmId: string, file: File): Promise<Message> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await client.post<DM>(`/dms/${dmId}/attachments`, form)
  return data
}
