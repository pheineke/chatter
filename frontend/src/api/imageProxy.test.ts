import { beforeEach, describe, expect, it, vi } from 'vitest'

const post = vi.fn()
vi.mock('./client', () => ({ default: { post: (...a: unknown[]) => post(...a) } }))

import { apiProxyPath, proxiedImageUrl } from './imageProxy'

describe('proxiedImageUrl', () => {
  beforeEach(() => {
    post.mockReset()
  })

  it('coalesces lookups from the same tick into one request', async () => {
    post.mockResolvedValue({
      data: { urls: { 'https://a.example/1.png': '/meta/image?url=1', 'https://a.example/2.png': '/meta/image?url=2' } },
    })
    const [one, two, again] = await Promise.all([
      proxiedImageUrl('https://a.example/1.png'),
      proxiedImageUrl('https://a.example/2.png'),
      proxiedImageUrl('https://a.example/1.png'),
    ])
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][1]).toEqual({ urls: ['https://a.example/1.png', 'https://a.example/2.png'] })
    expect(one).toBe('/api/meta/image?url=1')
    expect(two).toBe('/api/meta/image?url=2')
    expect(again).toBe('/api/meta/image?url=1')
  })

  it('splits more than 20 URLs into several requests', async () => {
    post.mockResolvedValue({ data: { urls: {} } })
    await Promise.all(Array.from({ length: 25 }, (_, i) => proxiedImageUrl(`https://a.example/${i}.png`)))
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('resolves null when the URL is refused or the call fails', async () => {
    post.mockResolvedValueOnce({ data: { urls: {} } })
    expect(await proxiedImageUrl('ftp://x/y.png')).toBeNull()
    post.mockRejectedValueOnce(new Error('offline'))
    expect(await proxiedImageUrl('https://a.example/z.png')).toBeNull()
  })
})

describe('apiProxyPath', () => {
  it('only accepts proxy paths', () => {
    expect(apiProxyPath('/meta/image?url=x')).toBe('/api/meta/image?url=x')
    expect(apiProxyPath('https://tracker.example/p.png')).toBeNull()
    expect(apiProxyPath(null)).toBeNull()
  })
})
