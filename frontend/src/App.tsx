import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { RequireAuth } from './components/RequireAuth'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import AppShell from './pages/AppShell'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
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
    </AuthProvider>
  )
}
