import { useNavigate, useParams } from 'react-router-dom'
import client from './client'
import type { Server, Member, Role, AuditLogEntry, CustomEmoji } from './types'

export async function getMyServers(): Promise<Server[]> {
  const { data } = await client.get<Server[]>('/servers/')
  return data
}

export async function getServer(id: string): Promise<Server> {
  const { data } = await client.get<Server>(`/servers/${id}`)
  return data
}

export async function createServer(title: string, description?: string): Promise<Server> {
  const { data } = await client.post<Server>('/servers/', { title, description })
  return data
}

export async function updateServer(
  id: string,
  patch: {
    title?: string
    description?: string
    text_channel_icon?: string
    voice_channel_icon?: string
  },
): Promise<Server> {
  const { data } = await client.patch<Server>(`/servers/${id}`, patch)
  return data
}

export async function deleteServer(id: string): Promise<void> {
  await client.delete(`/servers/${id}`)
}

export async function joinServer(id: string): Promise<Member> {
  const { data } = await client.post<Member>(`/servers/${id}/join`)
  return data
}

export async function leaveServer(serverId: string, userId: string): Promise<void> {
  await client.delete(`/servers/${serverId}/members/${userId}`)
}

export async function getMembers(serverId: string): Promise<Member[]> {
  const { data } = await client.get<Member[]>(`/servers/${serverId}/members`)
  return data
}

export async function kickMember(serverId: string, userId: string): Promise<void> {
  await client.delete(`/servers/${serverId}/members/${userId}`)
}

export async function getRoles(serverId: string): Promise<Role[]> {
  const { data } = await client.get<Role[]>(`/servers/${serverId}/roles`)
  return data
}

export async function createRole(serverId: string, body: { name: string; color?: string; is_admin?: boolean; hoist?: boolean; mentionable?: boolean; position?: number }): Promise<Role> {
  const { data } = await client.post<Role>(`/servers/${serverId}/roles`, body)
  return data
}

export async function updateRole(serverId: string, roleId: string, body: { name?: string; color?: string; is_admin?: boolean; hoist?: boolean; mentionable?: boolean }): Promise<Role> {
  const { data } = await client.patch<Role>(`/servers/${serverId}/roles/${roleId}`, body)
  return data
}

export async function deleteRole(serverId: string, roleId: string): Promise<void> {
  await client.delete(`/servers/${serverId}/roles/${roleId}`)
}

export async function assignRole(serverId: string, userId: string, roleId: string): Promise<void> {
  await client.post(`/servers/${serverId}/members/${userId}/roles/${roleId}`)
}

export async function removeRole(serverId: string, userId: string, roleId: string): Promise<void> {
  await client.delete(`/servers/${serverId}/members/${userId}/roles/${roleId}`)
}

export async function updateMemberNick(serverId: string, userId: string, nickname: string | null): Promise<void> {
  await client.patch(`/servers/${serverId}/members/${userId}/nick`, { nickname })
}

export async function updateMySettings(
  serverId: string,
  patch: { allowDms?: boolean | null; useServerFont?: boolean | null }
): Promise<Member> {
  const body: { allow_dms?: boolean | null; use_server_font?: boolean | null } = {}
  if ('allowDms' in patch) body.allow_dms = patch.allowDms
  if ('useServerFont' in patch) body.use_server_font = patch.useServerFont
  const { data } = await client.patch<Member>(`/servers/${serverId}/members/me/settings`, body)
  return data
}

export async function getAuditLogs(
  serverId: string,
  limit: number = 50,
  offset: number = 0,
  userId?: string,
  actionType?: string
): Promise<AuditLogEntry[]> {
  const params: Record<string, string | number> = { limit, offset }
  if (userId) params.user_id = userId
  if (actionType) params.action_type = actionType
  const { data } = await client.get<AuditLogEntry[]>(`/servers/${serverId}/audit-logs`, {
    params
  })
  return data
}

export async function uploadServerIcon(serverId: string, file: File): Promise<Server> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await client.post<Server>(`/servers/${serverId}/image`, form)
  return data
}

export async function uploadServerBanner(serverId: string, file: File): Promise<Server> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await client.post<Server>(`/servers/${serverId}/banner`, form)
  return data
}

export async function uploadServerFont(serverId: string, name: string, file: File): Promise<Server> {
  const form = new FormData()
  form.append('name', name)
  form.append('file', file)
  const { data } = await client.post<Server>(`/servers/${serverId}/font`, form)
  return data
}

export async function clearServerFont(serverId: string): Promise<Server> {
  const { data } = await client.delete<Server>(`/servers/${serverId}/font`)
  return data
}

export async function getCustomEmojis(serverId: string): Promise<CustomEmoji[]> {
  const { data } = await client.get<CustomEmoji[]>(`/servers/${serverId}/emojis`)
  return data
}

export async function createCustomEmoji(serverId: string, name: string, file: File): Promise<CustomEmoji> {
  const form = new FormData()
  form.append('name', name)
  form.append('file', file)
  const { data } = await client.post<CustomEmoji>(`/servers/${serverId}/emojis`, form)
  return data
}

export async function deleteCustomEmoji(serverId: string, emojiId: string): Promise<void> {
  await client.delete(`/servers/${serverId}/emojis/${emojiId}`)
}

// ── Word Filters ─────────────────────────────────────────────────────────────

export type WordFilterAction = 'delete' | 'warn' | 'kick' | 'ban'

export interface WordFilter {
  id: string
  server_id: string
  pattern: string
  action: WordFilterAction
  created_at: string
}

export async function getWordFilters(serverId: string): Promise<WordFilter[]> {
  const { data } = await client.get<WordFilter[]>(`/servers/${serverId}/word-filters`)
  return data
}

export async function createWordFilter(serverId: string, pattern: string, action: WordFilterAction): Promise<WordFilter> {
  const { data } = await client.post<WordFilter>(`/servers/${serverId}/word-filters`, { pattern, action })
  return data
}

export async function deleteWordFilter(serverId: string, filterId: string): Promise<void> {
  await client.delete(`/servers/${serverId}/word-filters/${filterId}`)
}

// ── Bans ─────────────────────────────────────────────────────────────────────

export interface ServerBan {
  server_id: string
  user_id: string
  reason: string | null
  banned_at: string
}

export async function getBans(serverId: string): Promise<ServerBan[]> {
  const { data } = await client.get<ServerBan[]>(`/servers/${serverId}/bans`)
  return data
}

export async function banMember(serverId: string, userId: string): Promise<void> {
  await client.post(`/servers/${serverId}/bans/${userId}`)
}

export async function unbanMember(serverId: string, userId: string): Promise<void> {
  await client.delete(`/servers/${serverId}/bans/${userId}`)
}
