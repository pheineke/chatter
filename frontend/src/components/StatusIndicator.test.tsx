import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { StatusIndicator } from './StatusIndicator'

describe('StatusIndicator', () => {
  it('renders bg-sp-online for online status', () => {
    const { container } = render(<StatusIndicator status="online" />)
    expect(container.firstElementChild?.className).toContain('bg-sp-online')
  })

  it('renders bg-sp-idle for away status', () => {
    const { container } = render(<StatusIndicator status="away" />)
    expect(container.firstElementChild?.className).toContain('bg-sp-idle')
  })

  it('renders bg-sp-dnd for dnd status', () => {
    const { container } = render(<StatusIndicator status="dnd" />)
    expect(container.firstElementChild?.className).toContain('bg-sp-dnd')
  })

  it('renders bg-sp-offline for offline status', () => {
    const { container } = render(<StatusIndicator status="offline" />)
    expect(container.firstElementChild?.className).toContain('bg-sp-offline')
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
