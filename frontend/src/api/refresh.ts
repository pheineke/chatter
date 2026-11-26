/**
 * The one place that gets a new access token (security_pass S7, S15).
 *
 * The refresh token is an HttpOnly cookie shared by every tab; each tab keeps
 * its access token in memory. Refreshing rotates the session, which also
 * invalidates the access token that belonged to the old session — so tabs
 * must not each refresh on their own, or they would keep invalidating each
 * other. Hence:
 *
 *  - within a tab, concurrent callers share one in-flight request;
 *  - across tabs, the exchange runs under a Web Lock, and every new access
 *    token is broadcast to the other tabs (BroadcastChannel);
 *  - a tab without a token (just opened, or reloaded) first asks the other
 *    tabs for theirs before rotating;
 *  - a tab that waited for the lock checks whether another tab already
 *    replaced the token that failed; if so it just uses the new one;
 *  - a 401 from /auth/refresh is retried once with only the cookie (another
 *    tab may have rotated it during our request, in browsers without Web
 *    Locks);
 *  - network errors don't log the user out, only a rejected token does.
 */
import {
  clearLegacyTokens,
  getAccessToken,
  legacyRefreshToken,
  markSession,
  setAccessToken,
} from './tokenStore'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'
const LOCK_NAME = 'chatter-token-refresh'
const PEER_WAIT_MS = 150

export type RefreshResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'invalid' | 'network' }

// ── Cross-tab channel ────────────────────────────────────────────────────────

type AuthMessage =
  | { type: 'token'; token: string }
  | { type: 'ask' }
  | { type: 'logout' }

const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('chatter-auth') : null

const peerWaiters = new Set<(token: string) => void>()

if (channel) {
  channel.onmessage = (e: MessageEvent<AuthMessage>) => {
    const msg = e.data
    if (msg?.type === 'token' && msg.token) {
      setAccessToken(msg.token)
      peerWaiters.forEach((resolve) => resolve(msg.token))
    } else if (msg?.type === 'ask') {
      const token = getAccessToken()
      if (token) channel.postMessage({ type: 'token', token } satisfies AuthMessage)
    } else if (msg?.type === 'logout') {
      setAccessToken(null)
      redirectToLogin()
    }
  }
}

/** Tell the other tabs about a token this tab just obtained. */
export function shareAccessToken(token: string): void {
  channel?.postMessage({ type: 'token', token } satisfies AuthMessage)
}

/** Ask the other tabs for their access token; null if none answers in time. */
function askPeers(): Promise<string | null> {
  if (!channel) return Promise.resolve(null)
  return new Promise((resolve) => {
    const done = (token: string | null) => {
      peerWaiters.delete(onToken)
      clearTimeout(timer)
      resolve(token)
    }
    const onToken = (token: string) => done(token)
    peerWaiters.add(onToken)
    const timer = setTimeout(() => done(null), PEER_WAIT_MS)
    channel.postMessage({ type: 'ask' } satisfies AuthMessage)
  })
}

// ── Refresh ──────────────────────────────────────────────────────────────────

let inflight: Promise<RefreshResult> | null = null

/**
 * Get a fresh access token. *failed* is the token a request was just
 * rejected with (if any); if another tab has already replaced it, that
 * replacement is returned without contacting the server.
 */
export function refreshAccessToken(failed: string | null = getAccessToken()): Promise<RefreshResult> {
  if (!inflight) {
    inflight = withLock(() => exchange(failed)).finally(() => { inflight = null })
  }
  return inflight
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks?.request ? (locks.request(LOCK_NAME, fn) as Promise<T>) : fn()
}

async function exchange(failed: string | null): Promise<RefreshResult> {
  const current = getAccessToken()
  if (current && current !== failed) return { ok: true, token: current }
  if (!current) {
    const fromPeer = await askPeers()
    if (fromPeer && fromPeer !== failed) return { ok: true, token: fromPeer }
  }

  const legacy = legacyRefreshToken()
  let res = await postRefresh(legacy)
  if (res === 'network') return { ok: false, reason: 'network' }
  if (res === 'rejected') {
    // A legacy token may already have been migrated by another tab, or the
    // cookie rotated by one during our request: try once with the cookie.
    if (legacy) clearLegacyTokens()
    res = await postRefresh(null)
    if (res === 'network') return { ok: false, reason: 'network' }
    if (res === 'rejected') return { ok: false, reason: 'invalid' }
  }
  if (legacy) clearLegacyTokens()
  markSession(true)
  setAccessToken(res)
  shareAccessToken(res)
  return { ok: true, token: res }
}

/** POST /auth/refresh in cookie mode; *bodyToken* is adopted into the cookie. */
async function postRefresh(bodyToken: string | null): Promise<string | 'rejected' | 'network'> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Refresh-Cookie': '1' },
      body: JSON.stringify(bodyToken ? { refresh_token: bodyToken } : {}),
    })
  } catch {
    return 'network'
  }
  if (res.status === 401 || res.status === 400 || res.status === 422) return 'rejected'
  if (!res.ok) return 'network'
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

/**
 * Turn a refresh token we were handed (QR login) into this browser's cookie
 * session. It's rotated on the way, so the handed-over value stops working.
 */
export async function adoptRefreshToken(refreshToken: string): Promise<RefreshResult> {
  const res = await postRefresh(refreshToken)
  if (res === 'network') return { ok: false, reason: 'network' }
  if (res === 'rejected') return { ok: false, reason: 'invalid' }
  clearLegacyTokens()
  markSession(true)
  setAccessToken(res)
  shareAccessToken(res)
  return { ok: true, token: res }
}

// ── Logout ───────────────────────────────────────────────────────────────────

function redirectToLogin() {
  const path = window.location.pathname
  if (path !== '/login' && path !== '/register') {
    window.location.href = '/login'
  }
}

/** Forget this browser's session in every tab (other tabs go to /login). */
export function endSession() {
  setAccessToken(null)
  markSession(false)
  clearLegacyTokens()
  channel?.postMessage({ type: 'logout' } satisfies AuthMessage)
}

/** endSession() and go to the login page. */
export function forceLogout() {
  endSession()
  redirectToLogin()
}
