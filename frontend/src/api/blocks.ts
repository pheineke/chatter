import client from './client'
import type { User } from './types'

export async function getBlocks(): Promise<User[]> {
  const { data } = await client.get<User[]>('/users/me/blocks')
  return data
}

export async function blockUser(userId: string): Promise<void> {
  await client.post(`/users/${userId}/block`)
}

export async function unblockUser(userId: string): Promise<void> {
  await client.delete(`/users/${userId}/block`)
}
