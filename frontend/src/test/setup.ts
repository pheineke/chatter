import '@testing-library/jest-dom'
import { vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Clean up after each test to prevent state leakage between tests
afterEach(() => {
  cleanup()
})

// Mock DOMPurify so tests don't depend on a full browser DOM (jsdom is partial)
vi.mock('dompurify', () => ({
  default: {
    sanitize: (input: string, opts?: { ALLOWED_TAGS: string[]; KEEP_CONTENT: boolean }) => {
      if (!input) return ''
      if (opts && opts.ALLOWED_TAGS && opts.ALLOWED_TAGS.length === 0) {
        // Strip all tags, keep content (plain-text mode)
        return input.replace(/<[^>]+>/g, '')
      }
      // Allowlist mode — just return as-is for tests
      return input
    },
  },
}))

// Stub window.matchMedia which jsdom doesn't implement
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Stub IntersectionObserver which jsdom doesn't implement
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
})) as unknown as typeof IntersectionObserver

// Suppress noisy console.error from expected React/test errors
const originalError = console.error.bind(console.error)
console.error = (...args: unknown[]) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('Warning:') || args[0].includes('Error: Not implemented'))
  ) return
  originalError(...args)
}
