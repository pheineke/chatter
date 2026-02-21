import client from './client'
import type { Token, User } from './types'

export async function register(username: string, password: string): Promise<User> {
  const { data } = await client.post<User>('/auth/register', { username, password })
  return data
}

export async function login(username: string, password: string): Promise<Token> {
  const form = new URLSearchParams({ username, password })
  const { data } = await client.post<Token>('/auth/login', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return data
}

export async function getMe(): Promise<User> {
  const { data } = await client.get<User>('/users/me')
  return data
}

export async function updateMe(patch: Partial<User>): Promise<User> {
  const { data } = await client.patch<User>('/users/me', patch)
  return data
}

export async function uploadAvatar(file: File): Promise<User> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await client.post<User>('/users/me/avatar', form)
  return data
}

export async function uploadBanner(file: File): Promise<User> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await client.post<User>('/users/me/banner', form)
  return data
}

export async function getUser(id: string): Promise<User> {
  const { data } = await client.get<User>(`/users/${id}`)
  return data
}

export async function getUserByUsername(username: string): Promise<User> {
  const { data } = await client.get<User>('/users/search', { params: { username } })
  return data
}

export async function getNote(userId: string): Promise<string> {
  const { data } = await client.get<{ content: string }>(`/users/${userId}/note`)
  return data.content
}

export async function setNote(userId: string, content: string): Promise<void> {
  await client.put(`/users/${userId}/note`, { content })
}
