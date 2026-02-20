import client from './client'

export interface ServerInvite {
  code: string
  server_id: string
  server_title: string
  server_image: string | null
  created_by: string
  expires_at: string | null
  uses: number
  max_uses: number | null
  created_at: string
}

export interface InviteCreate {
  max_uses?: number | null
  expires_hours?: number | null
}

export async function createInvite(
  serverId: string,
  body: InviteCreate = {},
): Promise<ServerInvite> {
  const { data } = await client.post<ServerInvite>(`/servers/${serverId}/invites`, body)
  return data
}

export async function getInvite(code: string): Promise<ServerInvite> {
  const { data } = await client.get<ServerInvite>(`/invites/${code}`)
  return data
}

export async function joinViaInvite(code: string): Promise<{ server_id: string }> {
  const { data } = await client.post<{ server_id: string }>(`/invites/${code}/join`)
  return data
}

export async function listInvites(serverId: string): Promise<ServerInvite[]> {
  const { data } = await client.get<ServerInvite[]>(`/servers/${serverId}/invites`)
  return data
}

export async function revokeInvite(code: string): Promise<void> {
  await client.delete(`/invites/${code}`)
}
