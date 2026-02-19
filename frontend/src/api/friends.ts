import client from './client'
import type { FriendRequest, Friend } from './types'

export async function getFriends(): Promise<Friend[]> {
  const { data } = await client.get<Friend[]>('/friends/')
  return data
}

export async function getFriendRequests(): Promise<FriendRequest[]> {
  const { data } = await client.get<FriendRequest[]>('/friends/requests')
  return data
}

export async function sendFriendRequest(recipientId: string): Promise<FriendRequest> {
  const { data } = await client.post<FriendRequest>('/friends/requests', { recipient_id: recipientId })
  return data
}

export async function acceptFriendRequest(requestId: string): Promise<FriendRequest> {
  const { data } = await client.post<FriendRequest>(`/friends/requests/${requestId}/accept`)
  return data
}

export async function declineFriendRequest(requestId: string): Promise<FriendRequest> {
  const { data } = await client.post<FriendRequest>(`/friends/requests/${requestId}/decline`)
  return data
}

export async function removeFriend(userId: string): Promise<void> {
  await client.delete(`/friends/${userId}`)
}
