import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Icon } from '../components/Icon'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      navigate('/channels/@me', { replace: true })
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-discord-bg">
      <div className="w-full max-w-md rounded-lg bg-discord-sidebar p-8 shadow-xl">
        <h1 className="mb-2 text-center text-2xl font-bold text-white">Welcome back!</h1>
        <p className="mb-6 text-center text-discord-muted">We're so excited to see you again!</p>

        {error && (
          <div className="mb-4 rounded bg-discord-dnd/20 px-4 py-2 text-sm text-red-400 flex items-center gap-2">
            <Icon name="alert-circle" size={16} className="text-red-400 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-discord-muted">
              <Icon name="person" size={14} />
              Username
            </label>
            <input
              type="text"
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded bg-discord-input px-3 py-2 text-white placeholder-discord-muted focus:outline-none focus:ring-2 focus:ring-discord-mention"
              placeholder="Enter your username"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-discord-muted">
              <Icon name="lock" size={14} />
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded bg-discord-input px-3 py-2 text-white placeholder-discord-muted focus:outline-none focus:ring-2 focus:ring-discord-mention"
              placeholder="Enter your password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-discord-mention py-2 font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <Icon name="log-in" size={18} />
            {loading ? 'Logging in…' : 'Log In'}
          </button>
        </form>

        <p className="mt-4 text-sm text-discord-muted">
          Need an account?{' '}
          <Link to="/register" className="text-discord-mention hover:underline">
            Register
          </Link>
        </p>
      </div>
    </div>
  )
}
