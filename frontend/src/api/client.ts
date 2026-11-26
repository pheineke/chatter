import axios, { type InternalAxiosRequestConfig } from 'axios'
import { forceLogout, refreshAccessToken } from './refresh'
import { getAccessToken, hasSession } from './tokenStore'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export const client = axios.create({ baseURL: BASE_URL, timeout: 15_000 })

type RetryConfig = InternalAxiosRequestConfig & { _retry?: boolean }

const isAuthRoute = (url?: string) => !!url?.includes('/auth/')

// Attach the access token (memory only, see ./tokenStore). Right after a
// reload there is none yet: get one first instead of sending the request
// unauthenticated just to have it fail with a 401.
client.interceptors.request.use(async (config) => {
  let token = getAccessToken()
  if (!token && !isAuthRoute(config.url) && hasSession()) {
    const result = await refreshAccessToken(null)
    if (result.ok) token = result.token
  }
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Token refresh ────────────────────────────────────────────────────────────
// A 401 on a normal request means the access token expired or its session
// was rotated. Refresh once (shared with WebSockets and other tabs, see
// ./refresh) and retry the request with the new token.
client.interceptors.response.use(
  (res) => res,
  async (err) => {
    const originalRequest = err.config as RetryConfig | undefined
    if (
      err.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      isAuthRoute(originalRequest.url)
    ) {
      return Promise.reject(err)
    }

    if (!hasSession()) {
      forceLogout()
      return Promise.reject(err)
    }

    originalRequest._retry = true
    const sent = String(originalRequest.headers.Authorization ?? '').replace(/^Bearer /, '') || null
    const result = await refreshAccessToken(sent)
    if (!result.ok) {
      if (result.reason === 'invalid') forceLogout()
      return Promise.reject(err)
    }
    originalRequest.headers.Authorization = `Bearer ${result.token}`
    return client(originalRequest)
  },
)

export default client
