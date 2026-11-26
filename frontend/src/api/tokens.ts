import client from './client'

export interface ApiToken {
  id: string
  name: string
  token_prefix: string
  created_at: string
  last_used_at: string | null
  /** null = never expires */
  expires_at: string | null
  scopes: TokenScope[]
}

/** read = GET + WebSocket; send = messages/reactions; manage = every other write. */
export type TokenScope = 'read' | 'send' | 'manage'

/** Returned only on token creation – includes the raw token (shown once). */
export interface ApiTokenCreated extends ApiToken {
  token: string
}

export async function getTokens(): Promise<ApiToken[]> {
  const { data } = await client.get<ApiToken[]>('/me/tokens')
  return data
}

export async function createToken(
  name: string,
  scopes: TokenScope[],
  expiresInDays: number | null,
): Promise<ApiTokenCreated> {
  const { data } = await client.post<ApiTokenCreated>('/me/tokens', {
    name,
    scopes,
    expires_in_days: expiresInDays,
  })
  return data
}

export async function revokeToken(tokenId: string): Promise<void> {
  await client.delete(`/me/tokens/${tokenId}`)
}
