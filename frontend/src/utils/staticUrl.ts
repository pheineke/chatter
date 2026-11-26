/**
 * Build a CSS `url(...)` for an uploaded file path stored on a user or server
 * (e.g. "banners/<uuid>.png"). Server-generated paths only ever contain these
 * characters; anything else (a ")" that would close the url() and inject more
 * CSS, quotes, "..", a scheme) yields undefined, so no image is shown rather
 * than attacker-controlled CSS (security_pass S17).
 */
const SAFE_STATIC_PATH = /^[a-z_]+(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)+$/

export function isSafeStaticPath(path: string | null | undefined): path is string {
  return !!path && SAFE_STATIC_PATH.test(path) && !path.includes('..')
}

export function staticCssUrl(path: string | null | undefined): string | undefined {
  return isSafeStaticPath(path) ? `url("/api/static/${path}")` : undefined
}
