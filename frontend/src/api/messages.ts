import client from './client'
import type { Message, PinnedMessage } from './types'

export async function getMessages(channelId: string, before?: string, limit = 50): Promise<Message[]> {
  const { data } = await client.get<Message[]>(`/channels/${channelId}/messages`, {
    params: { before, limit },
  })
  return data
}

export async function sendMessage(channelId: string, content: string | null, replyToId?: string): Promise<Message> {
  const { data } = await client.post<Message>(`/channels/${channelId}/messages`, {
    content: content || null,
    reply_to_id: replyToId ?? null,
  })
  return data
}

export async function editMessage(channelId: string, messageId: string, content: string): Promise<Message> {
  const { data } = await client.patch<Message>(`/channels/${channelId}/messages/${messageId}`, { content })
  return data
}

export async function deleteMessage(channelId: string, messageId: string): Promise<void> {
  await client.delete(`/channels/${channelId}/messages/${messageId}`)
}

export async function addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
  await client.post(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`)
}

export async function removeReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
  await client.delete(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`)
}

export async function uploadAttachment(channelId: string, messageId: string, file: File): Promise<Message> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await client.post<Message>(`/channels/${channelId}/messages/${messageId}/attachments`, form)
  return data
}

export async function getPins(channelId: string): Promise<PinnedMessage[]> {
  const { data } = await client.get<PinnedMessage[]>(`/channels/${channelId}/pins`)
  return data
}

export async function pinMessage(channelId: string, messageId: string): Promise<void> {
  await client.put(`/channels/${channelId}/messages/${messageId}/pin`)
}

export async function unpinMessage(channelId: string, messageId: string): Promise<void> {
  await client.delete(`/channels/${channelId}/messages/${messageId}/pin`)
}

