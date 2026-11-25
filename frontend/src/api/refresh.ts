/**
 * The one place that exchanges the refresh token (security_pass S7).
 *
 * Refresh tokens are single-use. If two callers (the axios interceptor and a
 * WebSocket, or two tabs) refresh with the same token at once, only one can
 * win; the other used to get a 401 and wipe the stored tokens, logging the
 * user out. So:
 *
 *  - within a tab, concurrent callers share one in-flight request;
 *  - across tabs, the exchange runs under a Web Lock, and a tab that waited
 *    for the lock first checks whether the token it saw has already been
 *    rotated by another tab; if so it just uses the new tokens;
 *  - a 401 from /auth/refresh also re-checks storage before giving up, for
 *    browsers without Web Locks;
 *  - network errors don't log the user out, only a rejected token does.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'
const LOCK_NAME = 'chatter-token-refresh'

export type RefreshResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'invalid' | 'network' }

let inflight: Promise<RefreshResult> | null = null

/** Refresh the access token. Concurrent calls share one request. */
export function refreshAccessToken(): Promise<RefreshResult> {
  if (!inflight) {
    const seen = localStorage.getItem('refreshToken')
    inflight = withLock(() => exchange(seen)).finally(() => { inflight = null })
  }
  return inflight
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks?.request ? (locks.request(LOCK_NAME, fn) as Promise<T>) : fn()
}

/** Tokens another tab stored after we read `seen`, if any. */
function rotatedElsewhere(seen: string | null): RefreshResult | null {
  const current = localStorage.getItem('refreshToken')
  const token = localStorage.getItem('token')
  return current && current !== seen && token ? { ok: true, token } : null
}

async function exchange(seen: string | null): Promise<RefreshResult> {
  const won = rotatedElsewhere(seen)
  if (won) return won

  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken) return { ok: false, reason: 'invalid' }

  let res: Response
  try {
    res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
  } catch {
    return { ok: false, reason: 'network' }
  }

  if (res.status === 401 || res.status === 400 || res.status === 422) {
    return rotatedElsewhere(refreshToken) ?? { ok: false, reason: 'invalid' }
  }
  if (!res.ok) return { ok: false, reason: 'network' }

  const data = await res.json()
  localStorage.setItem('token', data.access_token)
  localStorage.setItem('refreshToken', data.refresh_token)
  return { ok: true, token: data.access_token }
}

/** Drop stored credentials and go to the login page. */
export function forceLogout() {
  localStorage.removeItem('token')
  localStorage.removeItem('refreshToken')
  const path = window.location.pathname
  if (path !== '/login' && path !== '/register') {
    window.location.href = '/login'
  }
}
