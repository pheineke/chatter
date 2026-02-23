import client from './client'

export interface Session {
  id: string
  created_at: string
  last_used_at: string | null
  user_agent: string | null
  expires_at: string
}

export async function getSessions(): Promise<Session[]> {
  const { data } = await client.get<Session[]>('/auth/sessions')
  return data
}

export async function revokeSession(sessionId: string): Promise<void> {
  await client.delete(`/auth/sessions/${sessionId}`)
}

export async function revokeAllOtherSessions(): Promise<void> {
  const currentRefreshToken = localStorage.getItem('refreshToken')
  if (!currentRefreshToken) return
  await client.delete('/auth/sessions', {
    data: { current_refresh_token: currentRefreshToken },
  })
}
