import client from './client'

export interface ApiToken {
  id: string
  name: string
  token_prefix: string
  created_at: string
  last_used_at: string | null
}

/** Returned only on token creation – includes the raw token (shown once). */
export interface ApiTokenCreated extends ApiToken {
  token: string
}

export async function getTokens(): Promise<ApiToken[]> {
  const { data } = await client.get<ApiToken[]>('/me/tokens')
  return data
}

export async function createToken(name: string): Promise<ApiTokenCreated> {
  const { data } = await client.post<ApiTokenCreated>('/me/tokens', { name })
  return data
}

export async function revokeToken(tokenId: string): Promise<void> {
  await client.delete(`/me/tokens/${tokenId}`)
}
