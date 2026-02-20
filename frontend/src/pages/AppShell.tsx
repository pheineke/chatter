import { Routes, Route, Navigate } from 'react-router-dom'
import { useState } from 'react'
import { ServerSidebar } from '../components/ServerSidebar'
import { ChannelSidebar } from '../components/ChannelSidebar'
import { MessagePane } from '../components/MessagePane'
import { FriendsPane } from '../components/FriendsPane'
import { DMPane } from '../components/DMPane'
import { VoiceChannelBar } from '../components/VoiceChannelBar'
import { SettingsPage } from './SettingsPage'

/** The active voice session, if any (channelId + channelName). */
export interface VoiceSession {
  channelId: string
  channelName: string
  serverId: string
}

export default function AppShell() {
  const [voiceSession, setVoiceSession] = useState<VoiceSession | null>(null)

  function handleLeaveVoice() {
    setVoiceSession(null)
  }

  return (
    <div className="flex h-screen bg-discord-bg text-discord-text overflow-hidden">
      <Routes>
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={
          <>
            {/* Far-left: server icons */}
            <ServerSidebar />

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
                  <Route path=":serverId" element={<Navigate to="." replace />} />
                  <Route
                    path=":serverId/:channelId"
                    element={<MessagePane voiceSession={voiceSession} onJoinVoice={setVoiceSession} />}
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
          </>
        } />
      </Routes>
    </div>
  )
}

/** Minimal DM sidebar shown when on the @me route. Real list is inside FriendsPane/DMPane. */
function DMSidebar() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 text-xs font-semibold uppercase text-discord-muted tracking-wider">
        Direct Messages
      </div>
      {/* DMPane renders its own sidebar list; this is just a placeholder header */}
    </div>
  )
}
