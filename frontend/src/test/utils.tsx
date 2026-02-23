/**
 * Custom render helper that wraps components in all required providers:
 * - QueryClientProvider (React Query)
 * - MemoryRouter      (React Router)
 * - AuthProvider
 * - UnreadChannelsProvider
 *
 * Usage:
 *   const { getByText } = renderWithProviders(<MyComponent />)
 */
import { type ReactElement } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { UnreadChannelsProvider } from '../contexts/UnreadChannelsContext'

interface WrapperOptions {
  initialEntries?: string[]
}

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function renderWithProviders(
  ui: ReactElement,
  {
    initialEntries = ['/'],
    queryClient = createTestQueryClient(),
    ...renderOptions
  }: WrapperOptions & { queryClient?: QueryClient } & Omit<RenderOptions, 'wrapper'> = {},
) {
  function Wrapper({ children }: { children: ReactElement }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <UnreadChannelsProvider>
            {children}
          </UnreadChannelsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
  return { ...render(ui, { wrapper: Wrapper as React.ComponentType, ...renderOptions }), queryClient }
}

// Convenience: make a fake User object (override any field via partial)
export function makeUser(overrides: Partial<import('../api/types').User> = {}): import('../api/types').User {
  return {
    id: 'user-1',
    username: 'testuser',
    avatar: null,
    banner: null,
    description: null,
    pronouns: null,
    status: 'online',
    preferred_status: 'online',
    dm_permission: 'everyone',
    hide_status: false,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// Convenience: make a fake Message object
export function makeMessage(
  overrides: Partial<import('../api/types').Message> = {},
): import('../api/types').Message {
  return {
    id: 'msg-1',
    channel_id: 'chan-1',
    content: 'Hello world',
    author: makeUser(),
    author_nickname: null,
    reply_to_id: null,
    reply_to: null,
    is_deleted: false,
    is_edited: false,
    edited_at: null,
    created_at: '2024-01-01T12:00:00Z',
    attachments: [],
    reactions: [],
    mentions: [],
    ...overrides,
  }
}

// Re-export everything from RTL for convenience
export * from '@testing-library/react'
export { vi } from 'vitest'

import React from 'react'
export { React }
