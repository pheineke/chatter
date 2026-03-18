import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useMatch } from 'react-router-dom'
import { useState, useEffect } from 'react'
import type { MouseEvent } from 'react'
import { getConversations, markDMRead } from '../api/dms'
import { getBlocks, blockUser, unblockUser } from '../api/blocks'
import { updateMe } from '../api/users'
import { useAuth } from '../contexts/AuthContext'
import { useNotificationSettings } from '../hooks/useNotificationSettings'
import { AvatarWithStatus } from './AvatarWithStatus'
import { Icon } from './Icon'
import { ContextMenu } from './ContextMenu'
import { ProfileCard } from './ProfileCard'
import type { ContextMenuItem } from './ContextMenu'
import type { DMConversation } from '../api/types'
import { cacheConversations, getCachedConversations } from '../db/dmCache'

interface DMSidebarProps {}

export function DMSidebar() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user, refreshUser } = useAuth()
  const match = useMatch('/channels/@me/:dmUserId')
  const activeDmUserId = match?.params.dmUserId ?? null
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  const [activeProfile, setActiveProfile] = useState<{ userId: string; position: { x: number; y: number } } | null>(null)
  const { channelLevel, setChannelLevel } = useNotificationSettings()
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [cachedConversations, setCachedConversations] = useState<DMConversation[]>([])

  const { data: blocks = [] } = useQuery({
    queryKey: ['blocks'],
    queryFn: getBlocks,
  })

  const markReadMut = useMutation({
    mutationFn: ({ channelId, lastReadAt }: { channelId: string; lastReadAt?: string }) =>
      markDMRead(channelId, lastReadAt),
    onSuccess: ({ channel_id, last_read_at }) => {
      qc.setQueryData<DMConversation[]>(['dmConversations'], old =>
        old?.map(c =>
          c.channel_id === channel_id ? { ...c, last_read_at } : c
        )
      )
    },
  })

  // Track online/offline
  useEffect(() => {
    const onOnline = () => setIsOffline(false)
    const onOffline = () => {
      setIsOffline(true)
      getCachedConversations().then(setCachedConversations)
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    // Load cache immediately if already offline on mount
    if (!navigator.onLine) getCachedConversations().then(setCachedConversations)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const { data: netConversations = [] } = useQuery({
    queryKey: ['dmConversations'],
    queryFn: getConversations,
    staleTime: 30_000,
    enabled: !isOffline,
  })

  // Mirror freshly fetched conversations to IndexedDB
  useEffect(() => {
    if (netConversations.length) cacheConversations(netConversations).catch(() => {})
  }, [netConversations])

  const conversations = isOffline ? cachedConversations : netConversations

  // Subscribe to personal WS — handled globally by useUnreadDMs in AppShell.
  // This component just reacts to cache changes already applied by that hook.

  // Mark active channel as read whenever it becomes active or new messages arrive
  useEffect(() => {
    if (!activeDmUserId) return
    const conv = conversations.find(c => c.other_user.id === activeDmUserId)
    if (!conv) return
    if (!conv.last_message_at) return
    if (conv.last_read_at && conv.last_read_at >= conv.last_message_at) return
    markReadMut.mutate({ channelId: conv.channel_id, lastReadAt: conv.last_message_at })
  }, [activeDmUserId, conversations, markReadMut])

  const isFriendsActive = !activeDmUserId

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 pt-2">
        <button
          onClick={() => navigate('/channels/@me')}
          className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors mb-2
            ${isFriendsActive
              ? 'bg-sp-surface-variant text-sp-text'
              : 'text-sp-muted hover:bg-sp-surface-variant/50 hover:text-sp-text'}`}
        >
          <div className="w-7 h-7 rounded-full bg-sp-primary/10 flex items-center justify-center">
            <Icon name="people" size={16} className="text-sp-primary" />
          </div>
          <span>Friends</span>
        </button>
      </div>

      <div className="flex items-center justify-between px-4 pb-1 pt-2 text-xs font-bold text-sp-muted uppercase tracking-wider group">
        <span>Direct Messages</span>
        <button
          className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-sp-text"
          title="Create DM"
          onClick={() => navigate('/channels/@me')}
        >
          <Icon name="plus" size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-0.5 mt-1">
        {conversations.map(conv => {
          const isActive = conv.other_user.id === activeDmUserId
          const lr = conv.last_read_at
          // Show unread badge if there are messages after the last read time (and not currently viewing)
          const hasUnread =
            !!conv.last_message_at && (!lr || conv.last_message_at > lr) && !isActive
          const isMuted = channelLevel(conv.channel_id) === 'mute'

          function openConvContextMenu(e: MouseEvent<HTMLButtonElement>) {
            e.preventDefault()
            e.stopPropagation()
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              items: [
                {
                  label: 'Profile',
                  icon: 'user',
                  onClick: () => {
                    setActiveProfile({
                      userId: conv.other_user.id,
                      position: { x: e.clientX, y: e.clientY }
                    })
                  }
                },
                ...(hasUnread ? [{
                  label: 'Mark as Read',
                  icon: 'check-circle' as const,
                  onClick: () => {
                    markReadMut.mutate({
                      channelId: conv.channel_id,
                      lastReadAt: conv.last_message_at ?? new Date().toISOString(),
                    })
                  },
                }, { separator: true as const }] : []),
                {
                  label: isMuted ? 'Unmute Conversation' : 'Mute Conversation',
                  icon: isMuted ? 'bell' : 'bell-off',
                  onClick: () => setChannelLevel(conv.channel_id, isMuted ? 'all' : 'mute'),
                },
                { separator: true },
                {
                  label: 'Copy ID',
                  icon: 'copy',
                  onClick: () => navigator.clipboard.writeText(conv.other_user.id),
                },
                { separator: true },
                {
                   label: blocks.some(b => b.id === conv.other_user.id) ? 'Unblock' : 'Block',
                   icon: 'slash',
                   danger: true,
                   onClick: async () => {
                      const isBlocked = blocks.some(b => b.id === conv.other_user.id)
                      if (isBlocked) await unblockUser(conv.other_user.id)
                      else await blockUser(conv.other_user.id)
                      qc.invalidateQueries({ queryKey: ['blocks'] })
                   }
                }
              ],
            })
          }

          return (
            <button
              key={conv.channel_id}
              onClick={() => navigate(`/channels/@me/${conv.other_user.id}`)}
              onContextMenu={openConvContextMenu}
              data-avatar-ring
              style={{ '--avatar-ring': isActive ? 'transparent' : 'transparent', '--avatar-ring-hover': 'transparent' } as React.CSSProperties}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-full text-sm transition-all
                ${isActive
                  ? 'bg-sp-mention/15 text-sp-mention font-semibold'
                  : 'text-sp-muted hover:bg-sp-channel-hover hover:text-sp-text'}`}
            >
              <AvatarWithStatus user={conv.other_user} size={32} />
              <span className={`flex-1 text-left truncate ${hasUnread ? 'text-sp-text font-semibold' : ''}`}>
                {conv.other_user.username}
              </span>
              {isMuted && (
                <span className="text-sp-muted" title="Notifications muted">
                  <Icon name="bell-off" size={14} />
                </span>
              )}
              {hasUnread && !isMuted && (
                <span className="w-2 h-2 rounded-full bg-sp-mention shrink-0" aria-label="Unread messages" />
              )}
            </button>
          )
        })}
        {conversations.length === 0 && (
          <p className="text-xs text-sp-muted px-2 py-1">No conversations yet.</p>
        )}
      </div>

      {/* User panel MOVED to AppShell */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
      
      {activeProfile && (
        <ProfileCard
          userId={activeProfile.userId}
          position={activeProfile.position}
          onClose={() => setActiveProfile(null)}
        />
      )}
    </div>
  )
}
