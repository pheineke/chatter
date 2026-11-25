import axios from 'axios'
import { forceLogout, refreshAccessToken } from './refresh'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export const client = axios.create({ baseURL: BASE_URL, timeout: 15_000 })

// Attach JWT to every request when present
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
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
    const originalRequest = err.config
    if (
      err.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      originalRequest.url?.includes('/auth/')
    ) {
      return Promise.reject(err)
    }

    if (!localStorage.getItem('refreshToken')) {
      forceLogout()
      return Promise.reject(err)
    }

    originalRequest._retry = true
    const result = await refreshAccessToken()
    if (!result.ok) {
      if (result.reason === 'invalid') forceLogout()
      return Promise.reject(err)
    }
    originalRequest.headers.Authorization = `Bearer ${result.token}`
    return client(originalRequest)
  },
)

export default client
