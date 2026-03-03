import { useState, FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Icon } from '../components/Icon'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as any)?.from?.pathname ?? '/channels/@me'
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
      navigate(from, { replace: true })
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-sp-bg">
      <div className="w-full max-w-md rounded-sp-xl bg-sp-popup border border-sp-divider/50 p-8 shadow-sp-3">
        <h1 className="mb-2 text-center text-2xl font-bold text-sp-text">Welcome back!</h1>
        <p className="mb-6 text-center text-sp-muted">We're so excited to see you again!</p>

        {error && (
          <div className="mb-4 rounded bg-sp-dnd/20 px-4 py-2 text-sm text-red-400 flex items-center gap-2">
            <Icon name="alert-circle" size={16} className="text-red-400 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sp-muted">
              <Icon name="person" size={14} />
              Username
            </label>
            <input
              type="text"
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-full bg-sp-input px-4 py-2 text-sp-text placeholder-sp-muted focus:outline-none focus:ring-2 focus:ring-sp-mention/30 border border-sp-divider/60"
              placeholder="Enter your username"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sp-muted">
              <Icon name="lock" size={14} />
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-full bg-sp-input px-4 py-2 text-sp-text placeholder-sp-muted focus:outline-none focus:ring-2 focus:ring-sp-mention/30 border border-sp-divider/60"
              placeholder="Enter your password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-sp-mention py-2 font-semibold text-white transition hover:bg-sp-mention/85 disabled:opacity-60 flex items-center justify-center gap-2 shadow-sp-1"
          >
            <Icon name="log-in" size={18} />
            {loading ? 'Logging in…' : 'Log In'}
          </button>
        </form>

        <p className="mt-4 text-sm text-sp-muted">
          Need an account?{' '}
          <Link to="/register" className="text-sp-mention hover:underline">
            Register
          </Link>
        </p>

        <div className="mt-3 border-t border-sp-divider/50 pt-3">
          <Link
            to="/qr-login"
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded bg-sp-input hover:bg-sp-muted/20 text-sm text-sp-muted hover:text-sp-text transition-colors"
          >
            <Icon name="qr-code" size={16} />
            Log in with QR code
          </Link>
        </div>
      </div>
    </div>
  )
}
