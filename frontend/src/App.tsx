import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { UnreadChannelsProvider } from './contexts/UnreadChannelsContext'
import { RequireAuth } from './components/RequireAuth'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import AppShell from './pages/AppShell'
import InvitePage from './pages/InvitePage'

export default function App() {
  return (
    <AuthProvider>
      <UnreadChannelsProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/invite/:code" element={<RequireAuth><InvitePage /></RequireAuth>} />
            <Route
              path="/channels/*"
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/channels/@me" replace />} />
          </Routes>
        </BrowserRouter>
      </UnreadChannelsProvider>
    </AuthProvider>
  )
}
