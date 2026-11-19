// Lets a page open only for signed-in users with the right role.
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { hasAnyRole, homeFor, type Role } from '../types/auth'
import { FullScreenLoader } from '../components/FullScreenLoader'

export function RequireAuth({ roles, allowPinChange = false, children }: {
  roles?: Role[]
  allowPinChange?: boolean
  children: ReactNode
}) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.must_change_pin && !allowPinChange) return <Navigate to="/change-pin" replace />

  if (roles && !hasAnyRole(user, roles)) return <Navigate to={homeFor(user)} replace />
  return <>{children}</>
}
