import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { StatusIndicator } from './StatusIndicator'

describe('StatusIndicator', () => {
  it('renders bg-discord-online for online status', () => {
    const { container } = render(<StatusIndicator status="online" />)
    expect(container.firstElementChild?.className).toContain('bg-discord-online')
  })

  it('renders bg-discord-idle for away status', () => {
    const { container } = render(<StatusIndicator status="away" />)
    expect(container.firstElementChild?.className).toContain('bg-discord-idle')
  })

  it('renders bg-discord-dnd for dnd status', () => {
    const { container } = render(<StatusIndicator status="dnd" />)
    expect(container.firstElementChild?.className).toContain('bg-discord-dnd')
  })

  it('renders bg-discord-offline for offline status', () => {
    const { container } = render(<StatusIndicator status="offline" />)
    expect(container.firstElementChild?.className).toContain('bg-discord-offline')
  })

  it('applies the given size as inline style', () => {
    const { container } = render(<StatusIndicator status="online" size={14} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.style.width).toBe('14px')
    expect(el.style.height).toBe('14px')
  })

  it('defaults to 10px size', () => {
    const { container } = render(<StatusIndicator status="online" />)
    const el = container.firstElementChild as HTMLElement
    expect(el.style.width).toBe('10px')
  })
})
