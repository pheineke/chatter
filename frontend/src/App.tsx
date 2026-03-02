import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { UnreadChannelsProvider } from './contexts/UnreadChannelsContext'
import { DesktopNotificationsProvider } from './contexts/DesktopNotificationsContext'
import { RequireAuth } from './components/RequireAuth'
import { ReloadPrompt } from './components/ReloadPrompt'
import { E2EEWrapper } from './components/E2EEWrapper'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import AppShell from './pages/AppShell'
import InvitePage from './pages/InvitePage'
import QRLoginPage from './pages/QRLoginPage'

export default function App() {
  return (
    <AuthProvider>
      <UnreadChannelsProvider>
        <DesktopNotificationsProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/qr-login" element={<QRLoginPage />} />
            <Route path="/invite/:code" element={<RequireAuth><InvitePage /></RequireAuth>} />
            <Route
              path="/channels/*"
              element={
                <RequireAuth>
                  <E2EEWrapper>
                    <AppShell />
                  </E2EEWrapper>
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/channels/@me" replace />} />
          </Routes>
        </BrowserRouter>
        </DesktopNotificationsProvider>
      </UnreadChannelsProvider>
      <ReloadPrompt />
    </AuthProvider>
  )
}
