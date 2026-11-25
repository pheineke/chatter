import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { refreshAccessToken } from './refresh'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('refreshAccessToken', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.setItem('token', 'old-access')
    localStorage.setItem('refreshToken', 'old-refresh')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('stores the new pair on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { access_token: 'a2', refresh_token: 'r2' }))
    expect(await refreshAccessToken()).toEqual({ ok: true, token: 'a2' })
    expect(localStorage.getItem('token')).toBe('a2')
    expect(localStorage.getItem('refreshToken')).toBe('r2')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refresh_token: 'old-refresh' })
  })

  it('shares one request between concurrent callers in a tab', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { access_token: 'a2', refresh_token: 'r2' }))
    const results = await Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(results.every((r) => r.ok && r.token === 'a2')).toBe(true)
  })

  it('skips the request when another tab rotated while we waited for the lock', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    // A lock that another tab holds until `release()`; it rotates the tokens meanwhile.
    vi.stubGlobal('navigator', {
      locks: { request: async (_name: string, fn: () => Promise<unknown>) => { await held; return fn() } },
    })
    const pending = refreshAccessToken()
    localStorage.setItem('token', 'tab-b-access')
    localStorage.setItem('refreshToken', 'tab-b-refresh')
    release()
    expect(await pending).toEqual({ ok: true, token: 'tab-b-access' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the Web Lock when available', async () => {
    const request = vi.fn((_name: string, fn: () => Promise<unknown>) => fn())
    vi.stubGlobal('navigator', { locks: { request } })
    fetchMock.mockResolvedValue(jsonResponse(200, { access_token: 'a2', refresh_token: 'r2' }))
    await refreshAccessToken()
    expect(request).toHaveBeenCalledWith('chatter-token-refresh', expect.any(Function))
  })

  it('on 401, uses tokens another tab stored during the request', async () => {
    fetchMock.mockImplementation(async () => {
      localStorage.setItem('token', 'tab-b-access')
      localStorage.setItem('refreshToken', 'tab-b-refresh')
      return jsonResponse(401, { detail: 'Invalid or revoked refresh token' })
    })
    expect(await refreshAccessToken()).toEqual({ ok: true, token: 'tab-b-access' })
  })

  it('reports an invalid token on 401 when nothing changed', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: 'nope' }))
    expect(await refreshAccessToken()).toEqual({ ok: false, reason: 'invalid' })
  })

  it.each([
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a 502', () => Promise.resolve(jsonResponse(502, {}))],
  ])('treats %s as transient, keeping the stored tokens', async (_label, impl) => {
    fetchMock.mockImplementation(impl)
    expect(await refreshAccessToken()).toEqual({ ok: false, reason: 'network' })
    expect(localStorage.getItem('refreshToken')).toBe('old-refresh')
  })
})
