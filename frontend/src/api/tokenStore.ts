/**
 * Where the browser keeps credentials (security_pass S15).
 *
 * - The refresh token lives in an HttpOnly cookie the backend sets, scoped to
 *   /api/auth. Script can't read it, so an XSS can't walk off with a
 *   long-lived credential.
 * - The access token (15 min) lives only in this module's memory. A reload
 *   gets a new one from a sibling tab or via /auth/refresh.
 * - localStorage only holds a "hasSession" flag, so we know whether trying a
 *   refresh is worthwhile on startup. It is not a credential.
 *
 * Tokens stored by older versions under `token` / `refreshToken` are picked
 * up once by refresh.ts, exchanged for the cookie and deleted.
 */

const SESSION_FLAG = 'hasSession'
const LEGACY_ACCESS = 'token'
const LEGACY_REFRESH = 'refreshToken'

let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}

/** True if a refresh cookie probably exists (or pre-cookie tokens do). */
export function hasSession(): boolean {
  return localStorage.getItem(SESSION_FLAG) === '1' || localStorage.getItem(LEGACY_REFRESH) !== null
}

export function markSession(active: boolean): void {
  if (active) localStorage.setItem(SESSION_FLAG, '1')
  else localStorage.removeItem(SESSION_FLAG)
}

/** A refresh token stored by a version before the cookie, if any. */
export function legacyRefreshToken(): string | null {
  return localStorage.getItem(LEGACY_REFRESH)
}

export function clearLegacyTokens(): void {
  localStorage.removeItem(LEGACY_ACCESS)
  localStorage.removeItem(LEGACY_REFRESH)
}
