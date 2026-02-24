import { useEffect, useRef } from 'react'
import { AvatarWithStatus } from './AvatarWithStatus'
import { Icon } from './Icon'
import { Linkified } from '../utils/linkify'
import type { User } from '../api/types'

interface Props {
  user: User
  onClose: () => void
}

export function ProfileFullModal({ user, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={ref}
        className="w-[600px] max-h-[85vh] overflow-y-auto bg-discord-sidebar rounded-2xl shadow-2xl flex flex-col animate-fade-in-up"
      >
        {/* Banner */}
        <div
          className="h-36 relative shrink-0"
          style={{
            backgroundColor: user.banner ? undefined : '#5865F2',
            backgroundImage: user.banner ? `url(/api/static/${user.banner})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 text-white/80 hover:text-white hover:bg-black/60 transition-colors"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="px-6 pb-6 relative">
          {/* Avatar */}
          <div className="absolute -top-14 left-6 rounded-full p-1.5 bg-discord-sidebar">
            <AvatarWithStatus user={user} size={100} ringColor="#1e1f22" />
          </div>

          <div className="mt-20">
            <div className="text-2xl font-bold leading-tight">{user.username}</div>
            <div className="text-sm text-discord-muted mt-0.5 font-mono">{user.id}</div>
            {user.pronouns && (
              <div className="text-sm text-discord-muted mt-1">{user.pronouns}</div>
            )}

            <div className="mt-5 border-t border-discord-input pt-4">
              <div className="text-xs font-bold text-discord-muted uppercase mb-2 tracking-wider">About Me</div>
              <div className="text-sm text-discord-text/90 whitespace-pre-wrap leading-relaxed">
                {user.description
                  ? <Linkified text={user.description} noMentions />
                  : <span className="italic text-discord-muted">No bio yet.</span>}
              </div>
            </div>

            <div className="mt-5 border-t border-discord-input pt-4 flex items-center gap-3">
              <div className="flex flex-col gap-0.5">
                <div className="text-xs font-bold text-discord-muted uppercase tracking-wider">Status</div>
                <div className="text-sm capitalize text-discord-text">
                  {user.status === 'dnd' ? 'Do Not Disturb' : user.status}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
