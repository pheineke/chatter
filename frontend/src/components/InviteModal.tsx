import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createInvite, type ServerInvite } from '../api/invites'
import { Icon } from './Icon'

interface Props {
  serverId: string
  serverName: string
  onClose: () => void
}

const EXPIRY_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Never', value: null },
  { label: '30 minutes', value: 0.5 },
  { label: '1 hour', value: 1 },
  { label: '6 hours', value: 6 },
  { label: '12 hours', value: 12 },
  { label: '24 hours', value: 24 },
  { label: '7 days', value: 168 },
]

const MAX_USES_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Unlimited', value: null },
  { label: '1 use', value: 1 },
  { label: '5 uses', value: 5 },
  { label: '10 uses', value: 10 },
  { label: '25 uses', value: 25 },
  { label: '50 uses', value: 50 },
  { label: '100 uses', value: 100 },
]

export function InviteModal({ serverId, serverName, onClose }: Props) {
  const [expiresHours, setExpiresHours] = useState<number | null>(24)
  const [maxUses, setMaxUses] = useState<number | null>(null)
  const [invite, setInvite] = useState<ServerInvite | null>(null)
  const [copied, setCopied] = useState(false)

  const generateMut = useMutation({
    mutationFn: () => createInvite(serverId, { expires_hours: expiresHours, max_uses: maxUses }),
    onSuccess: (data) => setInvite(data),
  })

  function inviteLink(code: string) {
    return `${window.location.origin}/invite/${code}`
  }

  async function handleCopy() {
    if (!invite) return
    await navigator.clipboard.writeText(inviteLink(invite.code))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function formatExpiry(invite: ServerInvite) {
    if (!invite.expires_at) return 'Never'
    const d = new Date(invite.expires_at)
    return d.toLocaleString()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-discord-sidebar w-full max-w-md rounded-xl shadow-2xl p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-discord-text">Invite to <span className="text-discord-mention">{serverName}</span></h2>
            <p className="text-xs text-discord-muted mt-0.5">Share a link so friends can join this server</p>
          </div>
          <button onClick={onClose} className="text-discord-muted hover:text-discord-text transition-colors mt-0.5">
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Options */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-discord-muted">Expire after</label>
            <select
              value={expiresHours ?? 'null'}
              onChange={(e) => {
                const v = e.target.value
                setExpiresHours(v === 'null' ? null : Number(v))
                setInvite(null)
              }}
              className="bg-discord-input text-discord-text text-sm rounded-lg px-3 py-2 border border-white/10 outline-none focus:border-discord-mention transition"
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={String(o.value)} value={o.value ?? 'null'}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-discord-muted">Max uses</label>
            <select
              value={maxUses ?? 'null'}
              onChange={(e) => {
                const v = e.target.value
                setMaxUses(v === 'null' ? null : Number(v))
                setInvite(null)
              }}
              className="bg-discord-input text-discord-text text-sm rounded-lg px-3 py-2 border border-white/10 outline-none focus:border-discord-mention transition"
            >
              {MAX_USES_OPTIONS.map((o) => (
                <option key={String(o.value)} value={o.value ?? 'null'}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Generate button */}
        {!invite && (
          <button
            onClick={() => generateMut.mutate()}
            disabled={generateMut.isPending}
            className="bg-discord-mention text-white font-semibold rounded-lg py-2.5 text-sm hover:bg-discord-mention/80 disabled:opacity-50 transition-colors"
          >
            {generateMut.isPending ? 'Generating…' : 'Generate Invite Link'}
          </button>
        )}

        {/* Generated link */}
        {invite && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 bg-discord-input rounded-lg px-3 py-2.5">
              <span className="flex-1 text-sm text-discord-text truncate font-mono select-all">
                {inviteLink(invite.code)}
              </span>
              <button
                onClick={handleCopy}
                className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors shrink-0
                  ${copied ? 'bg-green-600 text-white' : 'bg-discord-mention text-white hover:bg-discord-mention/80'}`}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>

            <div className="flex gap-4 text-xs text-discord-muted">
              <span>
                <span className="font-semibold text-discord-text">{invite.uses}</span> uses
                {invite.max_uses != null && <> / {invite.max_uses}</>}
              </span>
              <span>
                Expires: <span className="font-semibold text-discord-text">{formatExpiry(invite)}</span>
              </span>
            </div>

            <button
              onClick={() => { setInvite(null) }}
              className="text-xs text-discord-muted hover:text-discord-text transition-colors self-start underline underline-offset-2"
            >
              Generate a new link with different settings
            </button>
          </div>
        )}

        {generateMut.isError && (
          <p className="text-xs text-red-400">Failed to generate invite. Please try again.</p>
        )}
      </div>
    </div>
  )
}
