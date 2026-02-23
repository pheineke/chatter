import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMatch } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ServerSidebar } from '../components/ServerSidebar'
import { ChannelSidebar } from '../components/ChannelSidebar'
import { MessagePane } from '../components/MessagePane'
import { FriendsPane } from '../components/FriendsPane'
import { DMPane } from '../components/DMPane'
import { DMSidebar } from '../components/DMSidebar'
import { VoiceChannelBar } from '../components/VoiceChannelBar'
import { VoiceCallProvider } from '../contexts/VoiceCallContext'
import { SettingsPage } from './SettingsPage'
import { ServerSettingsPage } from './ServerSettingsPage'
import { QuickSwitcher } from '../components/QuickSwitcher'
import { KeyboardShortcutsDialog } from '../components/KeyboardShortcutsDialog'
import { useUnreadDMs } from '../hooks/useUnreadDMs'
import { useTabBadge } from '../hooks/useTabBadge'
import { useUnreadChannels } from '../contexts/UnreadChannelsContext'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { getChannels } from '../api/channels'
import { getMyServers } from '../api/servers'
import { DesktopNotificationsProvider, useDesktopNotificationsContext } from '../contexts/DesktopNotificationsContext'

/** The active voice session, if any (channelId + channelName). */
export interface VoiceSession {
  channelId: string
  channelName: string
  serverId: string
}

export default function AppShell() {
  const { user } = useAuth()
  const [voiceSession, setVoiceSession] = useState<VoiceSession | null>(null)
  const hasUnreadDMs = useUnreadDMs()
  const { unreadChannels } = useUnreadChannels()
  useTabBadge(unreadChannels.size + (hasUnreadDMs ? 1 : 0), user?.status === 'dnd')
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const location = useLocation()

  // Build channel path list for Alt+↑/↓ navigation
  const channelMatch = useMatch('/channels/:serverId/:channelId')
  const currentServerId = channelMatch?.params.serverId
  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: getMyServers, staleTime: 60_000 })
  const { data: channels = [] } = useQuery({
    queryKey: ['channels', currentServerId],
    queryFn: () => getChannels(currentServerId!),
    enabled: !!currentServerId,
    staleTime: 60_000,
  })
  const channelPaths = channels
    .filter((c) => c.type === 'text')
    .map((c) => `/channels/${currentServerId}/${c.id}`)

  useKeyboardShortcuts({
    onOpenQuickSwitcher: () => setShowQuickSwitcher(true),
    onOpenShortcuts: () => setShowShortcuts(true),
    channelPaths,
    currentPath: location.pathname,
  })

  function handleLeaveVoice() {
    setVoiceSession(null)
  }

  return (
    <DesktopNotificationsProvider>
    <div className="flex flex-col h-screen bg-discord-bg text-discord-text overflow-hidden">
      <DesktopNotificationBanner />
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Global overlays */}
      {showQuickSwitcher && <QuickSwitcher onClose={() => setShowQuickSwitcher(false)} />}
      {showShortcuts && <KeyboardShortcutsDialog onClose={() => setShowShortcuts(false)} />}

      <Routes>
        <Route path="settings" element={<SettingsPage />} />
        <Route path=":serverId/settings" element={<ServerSettingsPage />} />
        <Route path="*" element={
          <VoiceCallProvider session={voiceSession} userId={user?.id ?? ''}>
            {/* Far-left: server icons */}
            <ServerSidebar hasUnreadDMs={hasUnreadDMs} />

            {/* Second column: channel/DM list */}
            <div className="flex flex-col w-60 shrink-0 bg-discord-sidebar overflow-hidden">
              <Routes>
                <Route path="@me/*" element={<DMSidebar />} />
                <Route
                  path=":serverId/*"
                  element={
                    <ChannelSidebar
                      voiceSession={voiceSession}
                      onJoinVoice={setVoiceSession}
                      onLeaveVoice={handleLeaveVoice}
                    />
                  }
                />
              </Routes>
            </div>

            {/* Main area */}
            <div className="flex flex-col flex-1 min-w-0">
              <div className="flex-1 min-h-0 overflow-hidden">
                <Routes>
                  <Route index element={<Navigate to="@me" replace />} />
                  <Route path="@me" element={<FriendsPane />} />
                  <Route path="@me/:dmUserId" element={<DMPane />} />
                  <Route path=":serverId" element={
                    <div className="h-full flex items-center justify-center text-discord-muted">
                      Select a channel to start chatting.
                    </div>
                  } />
                  <Route
                    path=":serverId/:channelId"
                    element={<MessagePane voiceSession={voiceSession} onJoinVoice={setVoiceSession} onLeaveVoice={handleLeaveVoice} />}
                  />
                </Routes>
              </div>

              {/* Voice status bar at the very bottom */}
              {voiceSession && (
                <VoiceChannelBar
                  session={voiceSession}
                  onLeave={handleLeaveVoice}
                />
              )}
            </div>
          </VoiceCallProvider>
        } />
      </Routes>
    </div>
    </div>
    </DesktopNotificationsProvider>
  )
}

/** Banner shown when desktop notifications are enabled but browser permission was denied. */
function DesktopNotificationBanner() {
  const { isEnabled, permission, deniedDismissed, dismissDenied } = useDesktopNotificationsContext()
  if (!isEnabled || permission !== 'denied' || deniedDismissed) return null
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 bg-red-500/20 border-b border-red-500/30 text-sm text-red-300 shrink-0">
      <span>
        Desktop notifications are blocked by the browser. To enable them, update the permission in your browser&apos;s site settings then reload.
      </span>
      <button
        onClick={dismissDenied}
        className="shrink-0 text-red-300 hover:text-white transition-colors"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}

/** Minimal DM sidebar shown when on the @me route. Real list is inside FriendsPane/DMPane. */
function _DMSidebarUnused() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 text-xs font-semibold uppercase text-discord-muted tracking-wider">
        Direct Messages
      </div>
      {/* DMPane renders its own sidebar list; this is just a placeholder header */}
    </div>
  )
}
