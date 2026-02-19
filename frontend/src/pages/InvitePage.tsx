import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getInvite, joinViaInvite } from '../api/invites'
import type { ServerInvite } from '../api/invites'
import { useAuth } from '../contexts/AuthContext'

export default function InvitePage() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [invite, setInvite] = useState<ServerInvite | null>(null)
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    if (!code) return
    getInvite(code)
      .then(setInvite)
      .catch((err) => {
        const detail = err?.response?.data?.detail
        setError(detail ?? 'This invite is invalid or has expired.')
      })
  }, [code])

  async function handleJoin() {
    if (!code) return
    setJoining(true)
    try {
      const { server_id } = await joinViaInvite(code)
      navigate(`/channels/${server_id}`, { replace: true })
    } catch {
      setError('Failed to join server.')
      setJoining(false)
    }
  }

  // Not logged in → send to login then back
  if (!user) {
    navigate(`/login?next=/invite/${code}`, { replace: true })
    return null
  }

  return (
    <div className="min-h-screen bg-discord-bg flex items-center justify-center">
      <div className="bg-discord-sidebar rounded-xl p-8 w-full max-w-sm text-center shadow-2xl">
        {error ? (
          <>
            <p className="text-red-400 font-semibold mb-4">{error}</p>
            <button className="btn" onClick={() => navigate('/channels/@me')}>Go Home</button>
          </>
        ) : !invite ? (
          <p className="text-discord-muted">Loading invite…</p>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-discord-input mx-auto mb-4 flex items-center justify-center text-2xl font-bold overflow-hidden">
              {invite.server_image
                ? <img src={invite.server_image} alt={invite.server_title} className="w-full h-full object-cover" />
                : invite.server_title.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <p className="text-discord-muted text-sm mb-1">You've been invited to join</p>
            <h1 className="text-xl font-bold mb-6">{invite.server_title}</h1>
            <button className="btn w-full" onClick={handleJoin} disabled={joining}>
              {joining ? 'Joining…' : 'Accept Invite'}
            </button>
            <button className="mt-3 text-sm text-discord-muted hover:underline block w-full" onClick={() => navigate('/channels/@me')}>
              No thanks
            </button>
          </>
        )}
      </div>
    </div>
  )
}
