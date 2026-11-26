import { render, screen } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'

/**
 * React Router v7 resolves relative paths inside splat (`*`) routes against the
 * full matched URL, where v6 ignored the splat part. AppShell nests three
 * `<Routes>` under splat routes and redirects `/channels` with a relative
 * `<Navigate to="@me">`; this mirrors that shape so an upgrade that changes the
 * resolution shows up here instead of as a redirect loop in the browser.
 */
function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function Shell() {
  return (
    <Routes>
      <Route
        path="*"
        element={
          <Routes>
            <Route path="settings" element={<Where />} />
            <Route
              path="*"
              element={
                <Routes>
                  <Route index element={<Navigate to="@me" replace />} />
                  <Route path="@me" element={<Where />} />
                  <Route path=":serverId/:channelId" element={<Where />} />
                </Routes>
              }
            />
          </Routes>
        }
      />
    </Routes>
  )
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/channels/*" element={<Shell />} />
      </Routes>
    </MemoryRouter>,
  )
  return screen.getByTestId('where').textContent
}

describe('AppShell-style nested splat routes', () => {
  it('redirects /channels to /channels/@me', () => {
    expect(renderAt('/channels')).toBe('/channels/@me')
  })

  it('redirects /channels/ (trailing slash) to /channels/@me', () => {
    expect(renderAt('/channels/')).toBe('/channels/@me')
  })

  it('still matches the settings route', () => {
    expect(renderAt('/channels/settings')).toBe('/channels/settings')
  })

  it('still matches a server channel route', () => {
    expect(renderAt('/channels/s1/c1')).toBe('/channels/s1/c1')
  })
})
