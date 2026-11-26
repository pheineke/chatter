import client from './client'

export interface Session {
  id: string
  created_at: string
  last_used_at: string | null
  user_agent: string | null
  expires_at: string
  is_current: boolean
}

export async function getSessions(): Promise<Session[]> {
  const { data } = await client.get<Session[]>('/auth/sessions')
  return data
}

export async function revokeSession(sessionId: string): Promise<void> {
  await client.delete(`/auth/sessions/${sessionId}`)
}

/** The server keeps the session this request's access token belongs to. */
export async function revokeAllOtherSessions(): Promise<void> {
  await client.delete('/auth/sessions')
}
