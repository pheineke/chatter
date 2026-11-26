import { describe, it, expect } from 'vitest'
import { staticCssUrl } from './staticUrl'

describe('staticCssUrl', () => {
  it('accepts server-generated upload paths', () => {
    expect(staticCssUrl('banners/0b6f2c1e-4d1a-4a39-9d3e-2f0c8a7b1e55.png'))
      .toBe('url("/api/static/banners/0b6f2c1e-4d1a-4a39-9d3e-2f0c8a7b1e55.png")')
    expect(staticCssUrl('servers/abc/banner.webp')).toBe('url("/api/static/servers/abc/banner.webp")')
  })

  it.each([
    'x.png), url(https://evil.example/track.gif',
    'banners/a.png") ; background:red',
    '../../etc/passwd',
    'banners/../avatars/x.png',
    'https://evil.example/a.png',
    '/absolute/path.png',
    "banners/it's.png",
    '',
    null,
    undefined,
  ])('rejects %j', (bad) => {
    expect(staticCssUrl(bad as string | null | undefined)).toBeUndefined()
  })
})
