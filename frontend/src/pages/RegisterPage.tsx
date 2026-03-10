import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Icon } from '../components/Icon'

export default function RegisterPage() {
  const { register, login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setError('')
    setLoading(true)
    try {
      await register(username, password)
      await login(username, password)
      navigate('/channels/@me', { replace: true })
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-sp-bg">
      <div className="w-full max-w-md rounded-sp-xl bg-sp-popup border border-sp-divider/50 p-8 shadow-sp-3">
        <h1 className="mb-2 text-center text-2xl font-bold text-sp-text">Create an account</h1>
        <p className="mb-6 text-center text-sp-muted">Join the conversation today!</p>

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
              placeholder="Choose a username"
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
              placeholder="Create a password"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sp-muted">
              <Icon name="lock" size={14} />
              Confirm Password
            </label>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-full bg-sp-input px-4 py-2 text-sp-text placeholder-sp-muted focus:outline-none focus:ring-2 focus:ring-sp-mention/30 border border-sp-divider/60"
              placeholder="Confirm your password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-sp-mention py-2 font-semibold text-white transition hover:bg-sp-mention/85 disabled:opacity-60 flex items-center justify-center gap-2 shadow-sp-1"
          >
            <Icon name="person-add" size={18} />
            {loading ? 'Creating account…' : 'Continue'}
          </button>
        </form>

        <p className="mt-4 text-sm text-sp-muted">
          Already have an account?{' '}
          <Link to="/login" className="text-sp-mention hover:underline">
            Log In
          </Link>
        </p>
      </div>
    </div>
  )
}
