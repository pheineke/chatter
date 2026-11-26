import client from './client'

/**
 * Remote images (image links in messages) are loaded through the backend's
 * signed proxy so viewers' browsers never contact the remote host, which
 * would hand it their IP address (security_pass S16).
 *
 * The API signs URLs in batches of up to 20; requests made in the same tick
 * are coalesced into one call.
 */

const MAX_BATCH = 20
let pending: Map<string, Array<(path: string | null) => void>> | null = null

function flush() {
  const batch = pending
  pending = null
  if (!batch) return
  const urls = [...batch.keys()]
  for (let i = 0; i < urls.length; i += MAX_BATCH) {
    const chunk = urls.slice(i, i + MAX_BATCH)
    client
      .post<{ urls: Record<string, string> }>('/meta/image-urls', { urls: chunk })
      .then(({ data }) => {
        for (const u of chunk) batch.get(u)?.forEach((resolve) => resolve(data.urls[u] ?? null))
      })
      .catch(() => {
        for (const u of chunk) batch.get(u)?.forEach((resolve) => resolve(null))
      })
  }
}

/** Proxy path (prefixed for the browser, e.g. `/api/meta/image?...`) or null if the URL can't be proxied. */
export function proxiedImageUrl(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!pending) {
      pending = new Map()
      queueMicrotask(flush)
    }
    const waiters = pending.get(url) ?? []
    waiters.push((path) => resolve(path ? `/api${path}` : null))
    pending.set(url, waiters)
  })
}

/** For proxy paths the API already returned (link previews): make it browser-relative, or drop anything else. */
export function apiProxyPath(path: string | null | undefined): string | null {
  return path && path.startsWith('/meta/image?') ? `/api${path}` : null
}
