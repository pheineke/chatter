import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Linkified } from './linkify'

describe('Linkified', () => {
  it('renders plain text as-is', () => {
    const { container } = render(<Linkified text="hello world" />)
    expect(container.textContent).toBe('hello world')
    expect(container.querySelector('a')).toBeNull()
  })

  it('renders an https URL as an anchor', () => {
    render(<Linkified text="visit https://example.com now" />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link.textContent).toBe('https://example.com')
  })

  it('prepends https:// to bare www. URLs', () => {
    render(<Linkified text="see www.example.com" />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://www.example.com')
    expect(link.textContent).toBe('www.example.com')
  })

  it('renders @mentions as styled spans', () => {
    const { container } = render(<Linkified text="hello @alice!" />)
    const mention = container.querySelector('span.mention')
    expect(mention).not.toBeNull()
    expect(mention!.textContent).toBe('@alice')
  })

  it('does not render @mentions when noMentions is true', () => {
    const { container } = render(<Linkified text="hello @alice!" noMentions />)
    expect(container.querySelector('span.mention')).toBeNull()
    expect(container.textContent).toContain('@alice')
  })

  it('renders both a URL and a mention in one string', () => {
    render(<Linkified text="@alice check https://example.com" />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://example.com')
  })

  it('renders text with no special content as plain spans', () => {
    const { container } = render(<Linkified text="just text" />)
    expect(container.textContent).toBe('just text')
    expect(container.querySelector('a')).toBeNull()
  })
})
