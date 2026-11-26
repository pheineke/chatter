import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { adoptRefreshToken, endSession, refreshAccessToken } from './refresh'
import { getAccessToken, hasSession, setAccessToken } from './tokenStore'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const sentBody = (fetchMock: ReturnType<typeof vi.fn>, i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body)

describe('refreshAccessToken (cookie session, S15)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let peer: BroadcastChannel | null = null

  beforeEach(() => {
    setAccessToken(null)
    localStorage.clear()
    localStorage.setItem('hasSession', '1')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    peer?.close()
    peer = null
    localStorage.clear()
  })

  it('refreshes with the cookie only and keeps the token in memory', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { access_token: 'a2', refresh_token: null }))
    expect(await refreshAccessToken()).toEqual({ ok: true, token: 'a2' })
    expect(getAccessToken()).toBe('a2')
    expect(localStorage.getItem('token')).toBeNull()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/refresh')
    expect(init.credentials).toBe('same-origin')
    expect(init.headers['X-Refresh-Cookie']).toBe('1')
    expect(sentBody(fetchMock)).toEqual({})
  })

  it('migrates a refresh token stored by an older version into the cookie', async () => {
    localStorage.clear()
    localStorage.setItem('token', 'old-access')
    localStorage.setItem('refreshToken', 'old-refresh')
    expect(hasSession()).toBe(true)
    fetchMock.mockResolvedValue(jsonResponse(200, { access_token: 'a2', refresh_token: null }))
    expect(await refreshAccessToken()).toEqual({ ok: true, token: 'a2' })
    expect(sentBody(fetchMock)).toEqual({ refresh_token: 'old-refresh' })
    expect(localStorage.getItem('refreshToken')).toBeNull()
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('hasSession')).toBe('1')
  })

  it('falls back to the cookie when the old stored token was already migrated', async () => {
    localStorage.setItem('refreshToken', 'already-used')
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'nope' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'a3' }))
    expect(await refreshAccessToken()).toEqual({ ok: true, token: 'a3' })
    expect(sentBody(fetchMock, 1)).toEqual({})
    expect(localStorage.getItem('refreshToken')).toBeNull()
  })

  it('shares one request between concurrent callers in a tab', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { access_token: 'a2' }))
    const results = await Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(results.every((r) => r.ok && r.token === 'a2')).toBe(true)
  })

  it('uses a token another tab already replaced the failed one with', async () => {
    setAccessToken('from-other-tab')
    expect(await refreshAccessToken('expired')).toEqual({ ok: true, token: 'from-other-tab' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a fresh tab asks the other tabs before rotating the session', async () => {
    peer = new BroadcastChannel('chatter-auth')
    peer.onmessage = (e) => {
      if (e.data?.type === 'ask') peer!.postMessage({ type: 'token', token: 'peer-token' })
    }
    expect(await refreshAccessToken(null)).toEqual({ ok: true, token: 'peer-token' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('tells the other tabs about a new token', async () => {
    peer = new BroadcastChannel('chatter-auth')
    const got = new Promise((resolve) => {
      peer!.onmessage = (e) => { if (e.data?.type === 'token') resolve(e.data.token) }
    })
    fetchMock.mockResolvedValue(jsonResponse(200, { access_token: 'a2' }))
    await refreshAccessToken()
    expect(await got).toBe('a2')
  })

  it('uses the Web Lock when available', async () => {
    const request = vi.fn((_name: string, fn: () => Promise<unknown>) => fn())
    vi.stubGlobal('navigator', { locks: { request } })
    fetchMock.mockResolvedValue(jsonResponse(200, { access_token: 'a2' }))
    await refreshAccessToken()
    expect(request).toHaveBeenCalledWith('chatter-token-refresh', expect.any(Function))
  })

  it('retries once with the cookie on 401 (another tab rotated it mid-request)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'rotated' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'a4' }))
    expect(await refreshAccessToken()).toEqual({ ok: true, token: 'a4' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports an invalid session when the cookie is rejected twice', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: 'nope' }))
    expect(await refreshAccessToken()).toEqual({ ok: false, reason: 'invalid' })
  })

  it.each([
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a 502', () => Promise.resolve(jsonResponse(502, {}))],
  ])('treats %s as transient, keeping the session', async (_label, impl) => {
    fetchMock.mockImplementation(impl)
    expect(await refreshAccessToken()).toEqual({ ok: false, reason: 'network' })
    expect(hasSession()).toBe(true)
  })
})

describe('adoptRefreshToken', () => {
  beforeEach(() => {
    setAccessToken(null)
    localStorage.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('hands the token to the server once and keeps only the cookie session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { access_token: 'qr-access' }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await adoptRefreshToken('from-qr')).toEqual({ ok: true, token: 'qr-access' })
    expect(sentBody(fetchMock)).toEqual({ refresh_token: 'from-qr' })
    expect(getAccessToken()).toBe('qr-access')
    expect(hasSession()).toBe(true)
  })
})

describe('endSession', () => {
  it('forgets the token and the session flag', () => {
    setAccessToken('x')
    localStorage.setItem('hasSession', '1')
    localStorage.setItem('refreshToken', 'legacy')
    endSession()
    expect(getAccessToken()).toBeNull()
    expect(hasSession()).toBe(false)
  })
})
