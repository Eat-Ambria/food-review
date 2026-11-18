// =============================================================================
// WHAT THIS FILE IS
//   A route guard that decides whether a page may be shown.
// WHY IT EXISTS
//   • Not signed in → go to /login.
//   • Still on the default PIN → go to /change-pin first. Nothing else opens
//     until the PIN is changed.
//   • Wrong role (e.g. a Recording User opening /admin) → go to their own home.
//   This only controls which SCREEN appears. The data itself is protected by RLS.
// USED BY
//   App.tsx
// =============================================================================
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { hasAnyRole, homeFor, type Role } from '../types/auth'
import { FullScreenLoader } from '../components/FullScreenLoader'

export function RequireAuth({ roles, allowPinChange = false, children }: {
  roles?: Role[]
  allowPinChange?: boolean   // true only for the /change-pin page itself
  children: ReactNode
}) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.must_change_pin && !allowPinChange) return <Navigate to="/change-pin" replace />
  // A user with several roles may open the page if ANY of their roles is allowed.
  if (roles && !hasAnyRole(user, roles)) return <Navigate to={homeFor(user)} replace />
  return <>{children}</>
}
