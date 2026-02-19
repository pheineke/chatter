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

export async function getRoles(serverId: string): Promise<Role[]> {
  const { data } = await client.get<Role[]>(`/servers/${serverId}/roles`)
  return data
}

export async function createRole(serverId: string, body: { name: string; color?: string; is_admin?: boolean; position?: number }): Promise<Role> {
  const { data } = await client.post<Role>(`/servers/${serverId}/roles`, body)
  return data
}

export async function deleteRole(serverId: string, roleId: string): Promise<void> {
  await client.delete(`/servers/${serverId}/roles/${roleId}`)
}
