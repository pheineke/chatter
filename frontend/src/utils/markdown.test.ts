import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown images (S16)', () => {
  it('turns ![alt](url) into a link instead of an <img>', () => {
    const html = renderMarkdown('look ![a cat](https://tracker.example/pixel.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('href="https://tracker.example/pixel.png"')
    expect(html).toContain('>a cat</a>')
  })

  it('escapes the alt text', () => {
    const html = renderMarkdown('![<b>x</b>](https://a.example/i.png)')
    expect(html).not.toContain('<b>')
  })

  it('still escapes raw <img> HTML', () => {
    const html = renderMarkdown('<img src="https://tracker.example/p.gif">')
    expect(html).not.toContain('<img')
  })
})
