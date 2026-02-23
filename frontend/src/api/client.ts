import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export const client = axios.create({ baseURL: BASE_URL, timeout: 15_000 })

// Attach JWT to every request when present
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Token refresh logic ──────────────────────────────────────────────────────
let _isRefreshing = false
let _refreshQueue: Array<(token: string | null) => void> = []

function _processQueue(newToken: string | null) {
  _refreshQueue.forEach((resolve) => resolve(newToken))
  _refreshQueue = []
}

client.interceptors.response.use(
  (res) => res,
  async (err) => {
    const originalRequest = err.config

    // Only attempt refresh for 401s that haven't already been retried
    if (
      err.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/')
    ) {
      const refreshToken = localStorage.getItem('refreshToken')

      if (!refreshToken) {
        // No refresh token – go to login
        localStorage.removeItem('token')
        if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
          window.location.href = '/login'
        }
        return Promise.reject(err)
      }

      if (_isRefreshing) {
        // Queue subsequent 401s while a refresh is in flight
        return new Promise((resolve, reject) => {
          _refreshQueue.push((token) => {
            if (token) {
              originalRequest.headers.Authorization = `Bearer ${token}`
              resolve(client(originalRequest))
            } else {
              reject(err)
            }
          })
        })
      }

      originalRequest._retry = true
      _isRefreshing = true

      try {
        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        })
        localStorage.setItem('token', data.access_token)
        localStorage.setItem('refreshToken', data.refresh_token)
        client.defaults.headers.common.Authorization = `Bearer ${data.access_token}`
        originalRequest.headers.Authorization = `Bearer ${data.access_token}`
        _processQueue(data.access_token)
        return client(originalRequest)
      } catch {
        _processQueue(null)
        localStorage.removeItem('token')
        localStorage.removeItem('refreshToken')
        if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
          window.location.href = '/login'
        }
        return Promise.reject(err)
      } finally {
        _isRefreshing = false
      }
    }

    return Promise.reject(err)
  },
)

export default client
