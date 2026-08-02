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
import { MLSContext, type MLSContextValue } from '../contexts/MLSContext'
import { AuthContext, type AuthContextValue } from '../contexts/AuthContext'

interface WrapperOptions {
  initialEntries?: string[]
}

/**
 * Inert MLS context for component tests.
 *
 * The real MLSProvider generates keys, talks to IndexedDB and hits the MLS
 * endpoints on mount — none of which belongs in a unit test for, say, whether
 * Enter submits a textarea. `ready: false` is the honest state for a stub:
 * components treat it as "encryption isn't available yet" and fall back to
 * their plaintext path, so tests exercise rendering and interaction without
 * depending on crypto. Tests that specifically care about encrypted content
 * can pass their own `mls` override.
 */
export const stubMLS: MLSContextValue = {
  ready: false,
  ensureChannelReady: async () => {},
  encryptForChannel: async () => null,
  decryptForChannel: async () => ({ status: 'failed' }),
  addMember: async () => {},
  removeMember: async () => {},
  hasGroup: async () => false,
}

/** Signed-in auth context for component tests, without the real provider's
 * /users/me fetch on mount. Pass `makeStubAuth({ user: null })` to exercise
 * signed-out rendering. */
export function makeStubAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: makeUser(),
    loading: false,
    login: async () => {},
    loginWithTokens: async () => {},
    register: async () => {},
    logout: () => {},
    refreshUser: async () => {},
    updateUser: () => {},
    ...overrides,
  }
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
    mls = stubMLS,
    ...renderOptions
  }: WrapperOptions & { queryClient?: QueryClient; mls?: MLSContextValue } & Omit<
    RenderOptions,
    'wrapper'
  > = {},
) {
  function Wrapper({ children }: { children: ReactElement }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <MLSContext.Provider value={mls}>
            <UnreadChannelsProvider>
              {children}
            </UnreadChannelsProvider>
          </MLSContext.Provider>
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
    avatar_decoration: null,
    description: null,
    pronouns: null,
    custom_status: null,
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
    is_encrypted: false,
    nonce: null,
    ...overrides,
  }
}

// Re-export everything from RTL for convenience
export * from '@testing-library/react'
export { vi } from 'vitest'

import React from 'react'
export { React }
