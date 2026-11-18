// =============================================================================
// WHAT THIS FILE IS
//   The app's route map: which URL shows which screen, and who may open it.
// WHY IT EXISTS
//   It keeps every route and its role rule in one readable place.
//     /login        anyone
//     /change-pin   any signed-in user (forced while on default PIN)
//     /record       Recording User + Admin
//     /issues       POC + Admin: every issue, grouped date → venue → event
//     /my-submissions Recording User (+ Admin): own complaints
//     /admin        Admin
//     /admin/users  Admin: user management (+ /import for CSV)
//     /admin/venues Admin: venues + aliases (import from Event Calendar)
// USED BY
//   main.tsx
// =============================================================================
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { RequireAuth } from './routes/RequireAuth'
import { AppLayout } from './layouts/AppLayout'
import { LoginPage } from './pages/Login/LoginPage'
import { ChangePinPage } from './pages/ChangePin/ChangePinPage'
import { UserManagementPage } from './pages/UserManagement/UserManagementPage'
import { ImportUsersPage } from './pages/UserManagement/ImportUsersPage'
import { RecordPage } from './pages/Recording/RecordPage'
import { VenuesPage } from './pages/Venues/VenuesPage'
import { IssuesPage } from './pages/Issues/IssuesPage'
import { MySubmissionsPage } from './pages/MySubmissions/MySubmissionsPage'
import { AdminDashboardPage } from './pages/AdminDashboard/AdminDashboardPage'
import { AlertsPage } from './pages/Alerts/AlertsPage'
import { OfflineBanner } from './components/OfflineBanner'
import { UpdateNotice } from './components/UpdateNotice'
import { PullToRefresh } from './components/PullToRefresh'
import { FullScreenLoader } from './components/FullScreenLoader'
import { homeFor } from './types/auth'

function HomeRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenLoader />
  return <Navigate to={user ? homeFor(user) : '/login'} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <OfflineBanner />
        <UpdateNotice />
        <PullToRefresh />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/change-pin" element={<RequireAuth allowPinChange><ChangePinPage /></RequireAuth>} />

          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route path="/record" element={
              <RequireAuth roles={['recorder', 'admin']}>
                <RecordPage />
              </RequireAuth>} />
            <Route path="/issues" element={<RequireAuth roles={['poc', 'admin']}><IssuesPage /></RequireAuth>} />
            <Route path="/my-submissions" element={<RequireAuth roles={['recorder', 'admin']}><MySubmissionsPage /></RequireAuth>} />
            <Route path="/poc" element={<Navigate to="/issues" replace />} />
            <Route path="/admin" element={
              <RequireAuth roles={['admin']}>
                <AdminDashboardPage />
              </RequireAuth>} />
            <Route path="/admin/users" element={<RequireAuth roles={['admin']}><UserManagementPage /></RequireAuth>} />
            <Route path="/admin/venues" element={<RequireAuth roles={['admin']}><VenuesPage /></RequireAuth>} />
            <Route path="/admin/alerts" element={<RequireAuth roles={['admin']}><AlertsPage /></RequireAuth>} />
            <Route path="/admin/users/import" element={<RequireAuth roles={['admin']}><ImportUsersPage /></RequireAuth>} />
          </Route>

          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
