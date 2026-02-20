import { useNavigate } from 'react-router-dom'
import { useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Icon } from '../components/Icon'
import { UserAvatar } from '../components/UserAvatar'
import { updateMe, uploadAvatar, uploadBanner } from '../api/users'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UserStatus } from '../api/types'

export function SettingsPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const avatarInput = useRef<HTMLInputElement>(null)
  const bannerInput = useRef<HTMLInputElement>(null)
  
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const updateMut = useMutation({
    mutationFn: (patch: any) => updateMe(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      setEditing(null)
      setIsSubmitting(false)
    },
  })

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'banner') {
    if (!e.target.files?.[0]) return
    setIsSubmitting(true)
    try {
      if (type === 'avatar') await uploadAvatar(e.target.files[0])
      else await uploadBanner(e.target.files[0])
      qc.invalidateQueries({ queryKey: ['me'] })
    } finally {
      setIsSubmitting(false)
    }
  }

  function startEdit(field: string, value: string | null) {
    setEditing(field)
    setEditValue(value ?? '')
  }

  async function saveEdit() {
    setIsSubmitting(true)
    if (editing === 'status') {
      updateMut.mutate({ status: editValue as UserStatus })
    } else if (editing) {
      updateMut.mutate({ [editing]: editValue })
    }
  }

  const statusColors: Record<string, string> = {
    online: 'bg-green-500',
    idle: 'bg-yellow-500', 
    dnd: 'bg-red-500',
    offline: 'bg-gray-500',
  }

  return (
    <div className="flex flex-col h-full bg-discord-bg text-discord-text p-8 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">My Account</h1>
          <button 
            onClick={() => navigate(-1)} 
            className="w-9 h-9 rounded-full bg-discord-bg border border-discord-muted flex items-center justify-center hover:bg-discord-input transition-colors group"
          >
            <Icon name="close" size={24} className="text-discord-muted group-hover:text-discord-text" />
          </button>
        </div>

        <div className="bg-discord-sidebar rounded-lg p-4 mb-8 overflow-hidden">
            <div 
              className="h-32 rounded-t-lg mb-16 relative bg-cover bg-center group"
              style={{ backgroundColor: user?.banner ? undefined : '#000', backgroundImage: user?.banner ? `url(/api/static/${user.banner})` : undefined }}
            >
                 <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors cursor-pointer flex items-center justify-center" onClick={() => bannerInput.current?.click()}>
                    <span className="text-white font-semibold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                        <Icon name="image" size={20} /> Change Banner
                    </span>
                 </div>
                 <input ref={bannerInput} type="file" className="hidden" accept="image/*" onChange={(e) => handleFile(e, 'banner')} />

                 <div className="absolute -bottom-10 left-4">
                    <div className="relative group rounded-full p-2 bg-discord-sidebar">
                        <UserAvatar user={user} size={80} className="rounded-full" />
                        <div 
                            className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity m-2"
                            onClick={() => avatarInput.current?.click()}
                        >
                             <span className="text-xs font-bold text-white">EDIT</span>
                        </div>
                        <input ref={avatarInput} type="file" className="hidden" accept="image/*" onChange={(e) => handleFile(e, 'avatar')} />
                        <div className={`absolute bottom-2 right-2 w-6 h-6 rounded-full border-4 border-discord-sidebar ${statusColors[user?.status ?? 'offline']}`} />
                    </div>
                 </div>
            </div>
            
            <div className="mt-8 px-4 pb-4">
                <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
                  {user?.username}
                  {user?.pronouns && <span className="text-sm font-normal text-discord-text bg-discord-bg px-2 py-0.5 rounded">{user.pronouns}</span>}
                </h2>

                <div className="space-y-6 mt-6">

                  {/* Quick Status Selector */}
                  <div className="flex gap-2 mb-6 p-3 bg-discord-bg rounded-lg">
                      {(['online', 'idle', 'dnd', 'offline'] as const).map(s => (
                          <button
                            key={s}
                            onClick={() => updateMut.mutate({ status: s })}
                            className={`flex-1 py-1.5 rounded text-sm font-medium capitalize flex items-center justify-center gap-2 transition-colors
                                ${user?.status === s ? 'bg-discord-mention text-white' : 'bg-discord-input hover:bg-discord-input/80'}`}
                          >
                            <div className={`w-2 h-2 rounded-full ${statusColors[s]}`} />
                            {s === 'dnd' ? 'Do Not Disturb' : s}
                          </button>
                      ))}
                  </div>

                  <EditableField 
                    label="Display Name" 
                    value={user?.username} 
                    field="username" // Actually this might be tricky if backend only allows patch users/me
                    readOnly // Let's make username read-only for now as it's the ID basically? Or handle it later. Backend schema has username in UserUpdate? No.
                    // UserUpdate has description, status, banner, pronouns. Username is immutable for now or needs another endpoint.
                    // Checking backend schema... UserUpdate does NOT have username.
                  />
                  
                  <EditableField 
                    label="Pronouns" 
                    value={user?.pronouns} 
                    field="pronouns"
                    isEditing={editing === 'pronouns'}
                    editValue={editValue}
                    setEditValue={setEditValue}
                    onEdit={() => startEdit('pronouns', user?.pronouns ?? null)}
                    onSave={saveEdit}
                    onCancel={() => setEditing(null)}
                  />

                  <EditableField 
                    label="About Me" 
                    value={user?.description} 
                    field="description"
                    multiline
                    isEditing={editing === 'description'}
                    editValue={editValue}
                    setEditValue={setEditValue}
                    onEdit={() => startEdit('description', user?.description ?? null)}
                    onSave={saveEdit}
                    onCancel={() => setEditing(null)}
                  />
                </div>
            </div>
        </div>

        <hr className="border-discord-input my-8" />

        <button 
            onClick={logout}
            className="flex items-center gap-2 text-red-400 hover:underline font-medium"
        >
            <Icon name="log-out" size={18} />
            Log Out
        </button>

      </div>
    </div>
  )
}

function EditableField({ 
  label, value, field, readOnly, multiline, isEditing, editValue, setEditValue, onEdit, onSave, onCancel 
}: any) {
  return (
    <div className="flex flex-col gap-1 p-3 bg-discord-bg rounded hover:bg-discord-input transition-colors group">
        <div className="flex items-center justify-between">
            <div className="w-full">
                <div className="text-xs font-bold text-discord-muted uppercase mb-1">{label}</div>
                {isEditing ? (
                  <div className="mt-2">
                    {multiline ? (
                      <textarea 
                        className="input w-full min-h-[100px]" 
                        value={editValue} 
                        onChange={e => setEditValue(e.target.value)}
                        autoFocus
                      />
                    ) : (
                      <input 
                        className="input w-full" 
                        value={editValue} 
                        onChange={e => setEditValue(e.target.value)}
                        autoFocus
                        onKeyDown={e => { if(e.key === 'Enter') onSave() }}
                      />
                    )}
                    <div className="flex gap-2 mt-2 justify-end">
                       <button onClick={onCancel} className="text-sm px-3 py-1 hover:underline">Cancel</button>
                       <button onClick={onSave} className="btn py-1 px-4">Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm whitespace-pre-wrap">{value || <span className="italic text-discord-muted">Not set</span>}</div>
                )}
            </div>
            {!isEditing && !readOnly && (
                <button onClick={onEdit} className="bg-discord-sidebar px-4 py-1.5 rounded text-sm hover:underline shrink-0 ml-4 self-start">Edit</button>
            )}
        </div>
    </div>
  )
}
