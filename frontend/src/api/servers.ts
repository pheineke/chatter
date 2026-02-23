import client from './client'
import type { Server, Member, Role } from './types'

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

export async function updateServer(id: string, patch: { title?: string; description?: string }): Promise<Server> {
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
