import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export const client = axios.create({ baseURL: BASE_URL })

// Attach JWT to every request when present
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// On 401 redirect to login (unless already on an auth page)
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const path = window.location.pathname
      if (path !== '/login' && path !== '/register') {
        localStorage.removeItem('token')
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  },
)

export default client
