import client from './client'
import type { User } from './types'

export async function register(username: string, password: string, inviteCode?: string): Promise<User> {
  const body = inviteCode ? { username, password, invite_code: inviteCode } : { username, password }
  const { data } = await client.post<User>('/auth/register', body)
  return data
}

export type RegistrationMode = 'open' | 'invite' | 'closed'

/** Public: who may sign up on this instance (backend REGISTRATION_MODE). */
export async function getRegistrationMode(): Promise<RegistrationMode> {
  const { data } = await client.get<{ registration_mode: RegistrationMode }>('/auth/config')
  return data.registration_mode
}

/** Logs in; the refresh token comes back as an HttpOnly cookie, not in the body (S15). */
export async function login(username: string, password: string): Promise<{ access_token: string }> {
  const form = new URLSearchParams({ username, password })
  const { data } = await client.post<{ access_token: string }>('/auth/login', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Refresh-Cookie': '1' },
  })
  return data
}

/** Ends this browser's session (the server reads and clears the cookie). */
export async function logout(): Promise<void> {
  await client.post('/auth/logout').catch(() => {})
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

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await client.post('/users/me/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  })
}
