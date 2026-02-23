import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UserAvatar } from './UserAvatar'
import type { User } from '../api/types'

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'u1',
  username: 'alice',
  status: 'online',
  avatar: null,
  banner: null,
  bio: '',
  display_name: null,
  preferred_status: null,
  hide_status: false,
  ...overrides,
})

describe('UserAvatar', () => {
  it('renders an empty div when user is null', () => {
    const { container } = render(<UserAvatar user={null} />)
    // Should be a div without text content
    const el = container.firstElementChild as HTMLElement
    expect(el.tagName.toLowerCase()).toBe('div')
    expect(el.textContent).toBe('')
  })

  it('shows the uppercased first letter of username when no avatar', () => {
    const { container } = render(<UserAvatar user={makeUser({ username: 'alice', avatar: null })} />)
    expect(container.textContent).toBe('A')
  })

  it('capitalizes the first letter correctly', () => {
    const { container } = render(<UserAvatar user={makeUser({ username: 'zara', avatar: null })} />)
    expect(container.textContent).toBe('Z')
  })

  it('renders an <img> tag when user has a non-gif avatar', () => {
    const user = makeUser({ avatar: 'avatars/alice.png' })
    render(<UserAvatar user={user} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', '/api/static/avatars/alice.png')
    expect(img).toHaveAttribute('alt', 'alice')
  })

  it('applies the given size as inline style', () => {
    const { container } = render(<UserAvatar user={makeUser()} size={56} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.style.width).toBe('56px')
    expect(el.style.height).toBe('56px')
  })
})
