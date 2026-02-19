import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Icon } from '../components/Icon'
import { UserAvatar } from '../components/UserAvatar'

export function SettingsPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex flex-col h-full bg-discord-bg text-discord-text p-8">
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

        <div className="bg-discord-sidebar rounded-lg p-4 mb-8">
            <div className="bg-discord-header h-24 rounded-t-lg mb-16 relative">
                 <div className="absolute -bottom-10 left-4">
                    <div className="rounded-full p-1.5 bg-discord-sidebar">
                        <UserAvatar user={user} size={80} />
                    </div>
                 </div>
            </div>
            
            <div className="mt-4 px-4 pb-4">
                <h2 className="text-xl font-bold mb-1">{user?.username}</h2>
                <div className="text-sm text-discord-muted mb-6">#{user?.id.slice(0, 4)}</div>

                <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-discord-bg rounded hover:bg-discord-input transition-colors cursor-pointer group">
                         <div>
                             <div className="text-xs font-bold text-discord-muted uppercase mb-1">Display Name</div>
                             <div className="text-sm">{user?.username}</div>
                         </div>
                         <button className="bg-discord-sidebar px-4 py-1.5 rounded text-sm hover:underline">Edit</button>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-discord-bg rounded hover:bg-discord-input transition-colors cursor-pointer group">
                         <div>
                             <div className="text-xs font-bold text-discord-muted uppercase mb-1">Email</div>
                             <div className="text-sm">*******@example.com</div>
                         </div>
                         <button className="bg-discord-sidebar px-4 py-1.5 rounded text-sm hover:underline">Edit</button>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-discord-bg rounded hover:bg-discord-input transition-colors cursor-pointer group">
                         <div>
                             <div className="text-xs font-bold text-discord-muted uppercase mb-1">Phone Number</div>
                             <div className="text-sm">Not set</div>
                         </div>
                         <button className="bg-discord-sidebar px-4 py-1.5 rounded text-sm hover:underline">Add</button>
                    </div>
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
