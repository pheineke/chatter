import client from './client'
import type { Channel, Category, ChannelPermission, VoiceParticipant } from './types'

export async function getChannels(serverId: string): Promise<Channel[]> {
  const { data } = await client.get<Channel[]>(`/servers/${serverId}/channels`)
  return data
}

export async function createChannel(
  serverId: string,
  body: { title: string; type?: 'text' | 'voice'; description?: string; category_id?: string; nsfw?: boolean; user_limit?: number; bitrate?: number },
): Promise<Channel> {
  const { data } = await client.post<Channel>(`/servers/${serverId}/channels`, body)
  return data
}

export async function updateChannel(
  serverId: string,
  channelId: string,
  patch: { title?: string; description?: string | null; slowmode_delay?: number; nsfw?: boolean; user_limit?: number | null; bitrate?: number | null },
): Promise<Channel> {
  const { data } = await client.patch<Channel>(`/servers/${serverId}/channels/${channelId}`, patch)
  return data
}

export async function reorderChannels(
  serverId: string,
  items: { id: string; position: number; category_id: string | null }[],
): Promise<void> {
  await client.put(`/servers/${serverId}/channels/reorder`, items)
}

export async function reorderCategories(
  serverId: string,
  items: { id: string; position: number }[],
): Promise<void> {
  await client.put(`/servers/${serverId}/categories/reorder`, items)
}

export async function deleteChannel(serverId: string, channelId: string): Promise<void> {
  await client.delete(`/servers/${serverId}/channels/${channelId}`)
}

export async function getPermissions(serverId: string, channelId: string): Promise<ChannelPermission[]> {
  const { data } = await client.get<ChannelPermission[]>(
    `/servers/${serverId}/channels/${channelId}/permissions`,
  )
  return data
}

export async function setPermission(
  serverId: string,
  channelId: string,
  roleId: string,
  body: { allow_bits: number; deny_bits: number },
): Promise<ChannelPermission> {
  const { data } = await client.put<ChannelPermission>(
    `/servers/${serverId}/channels/${channelId}/permissions/${roleId}`,
    body,
  )
  return data
}

export async function getCategories(serverId: string): Promise<Category[]> {
  const { data } = await client.get<Category[]>(`/servers/${serverId}/categories`)
  return data
}

export async function createCategory(serverId: string, title: string): Promise<Category> {
  const { data } = await client.post<Category>(`/servers/${serverId}/categories`, { title })
  return data
}

/** Returns a map of channelId → participants for all active voice channels in the server. */
export async function getServerVoicePresence(serverId: string): Promise<Record<string, VoiceParticipant[]>> {
  const { data } = await client.get<Record<string, VoiceParticipant[]>>(`/servers/${serverId}/voice-presence`)
  return data
}
