import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AvatarWithStatus } from './AvatarWithStatus'
import { Icon } from './Icon'
import { Linkified } from '../utils/linkify'
import { getNote, setNote } from '../api/users'
import { useAuth } from '../contexts/AuthContext'
import type { User } from '../api/types'

interface Props {
  user: User
  onClose: () => void
  focusNote?: boolean
}

export function ProfileFullModal({ user, onClose, focusNote }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const qc = useQueryClient()
  const { user: currentUser } = useAuth()
  const isSelf = !!currentUser && currentUser.id === user.id
  const [noteText, setNoteText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: savedNote } = useQuery({
    queryKey: ['note', user.id],
    queryFn: () => getNote(user.id),
    enabled: !isSelf,
  })

  useEffect(() => {
    if (savedNote !== undefined) setNoteText(savedNote)
  }, [savedNote])

  const noteMut = useMutation({
    mutationFn: (content: string) => setNote(user.id, content),
    onSuccess: () => {
      setNoteSaving(false)
      qc.invalidateQueries({ queryKey: ['note', user.id] })
    },
  })

  function handleNoteChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setNoteText(e.target.value)
    setNoteSaving(true)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      noteMut.mutate(e.target.value)
    }, 800)
  }

  // Focus note field when requested
  useEffect(() => {
    if (focusNote) {
      // Wait for render + data load
      const timer = setTimeout(() => noteRef.current?.focus(), 200)
      return () => clearTimeout(timer)
    }
  }, [focusNote, savedNote])

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
        className="w-[480px] max-h-[80vh] overflow-y-auto bg-discord-sidebar rounded-2xl shadow-2xl flex flex-col animate-fade-in-up"
      >
        {/* Banner */}
        <div
          className="h-24 relative shrink-0"
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

        <div className="px-5 pb-5 relative">
          {/* Avatar */}
          <div className="absolute -top-10 left-5 rounded-full p-1 bg-discord-sidebar">
            <AvatarWithStatus user={user} size={72} ringColor="#1e1f22" />
          </div>

          <div className="mt-14">
            <div className="text-xl font-bold leading-tight">{user.username}</div>
            <div className="text-xs text-discord-muted mt-0.5 font-mono">{user.id}</div>
            {user.pronouns && (
              <div className="text-xs text-discord-muted mt-0.5">{user.pronouns}</div>
            )}

            <div className="mt-3 border-t border-discord-input pt-3">
              <div className="text-xs font-bold text-discord-muted uppercase mb-1 tracking-wider">About Me</div>
              <div className="text-sm text-discord-text/90 whitespace-pre-wrap leading-relaxed">
                {user.description
                  ? <Linkified text={user.description} noMentions />
                  : <span className="italic text-discord-muted">No bio yet.</span>}
              </div>
            </div>

            <div className="mt-3 border-t border-discord-input pt-3 flex items-center gap-3">
              <div className="flex flex-col gap-0.5">
                <div className="text-xs font-bold text-discord-muted uppercase tracking-wider">Status</div>
                <div className="text-sm capitalize text-discord-text">
                  {user.status === 'dnd' ? 'Do Not Disturb' : user.status}
                </div>
              </div>
            </div>

            {!isSelf && (
              <div className="mt-3 border-t border-discord-input pt-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs font-bold text-discord-muted uppercase tracking-wider">Note</div>
                  {noteSaving && <span className="text-[10px] text-discord-muted">Saving…</span>}
                </div>
                <textarea
                  ref={noteRef}
                  className="input w-full text-sm bg-black/20 border-0 px-3 py-2 placeholder:text-discord-muted resize-none rounded-md"
                  rows={3}
                  value={noteText}
                  onChange={handleNoteChange}
                  placeholder="Click to add a note"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
