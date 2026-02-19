import client from './client'
import type { DM } from './types'

export async function getDMs(userId: string, before?: string, limit = 50): Promise<DM[]> {
  const { data } = await client.get<DM[]>(`/dms/${userId}`, { params: { before, limit } })
  return data
}

export async function sendDM(userId: string, content: string): Promise<DM> {
  const { data } = await client.post<DM>(`/dms/${userId}`, { content })
  return data
}

export async function deleteDM(dmId: string): Promise<void> {
  await client.delete(`/dms/${dmId}`)
}
