// =============================================================================
// WHAT THIS FILE IS
//   Types for users, roles and login results.
// WHY IT EXISTS
//   Keeps the shape of an app_users row in ONE place, matching the SQL in
//   supabase/migrations/20261116000001_schema.sql.
// USED BY
//   services/authService.ts, contexts/AuthContext.tsx, pages
// =============================================================================
export type Role = 'admin' | 'recorder' | 'poc'

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  recorder: 'Recording User',
  poc: 'POC',
}

/** Where each role lands after login. */
export const ROLE_HOME: Record<Role, string> = {
  admin: '/admin',
  recorder: '/record',
  poc: '/issues',
}

/** Display / priority order. A user's home is their highest role in this order. */
export const ROLE_ORDER: Role[] = ['admin', 'recorder', 'poc']

/** Every role the user has (older data may only have the single role). */
export const rolesOf = (u: { role: Role; roles?: Role[] | null }): Role[] => (u.roles && u.roles.length ? u.roles : [u.role])

export const hasAnyRole = (u: { role: Role; roles?: Role[] | null }, wanted: Role[]) => rolesOf(u).some((r) => wanted.includes(r))

/**
 * Landing page after login: the Record screen for anyone who can record
 * (Recording User or Admin), because recording is the app's main job. A
 * POC-only user lands on Issues. The Admin dashboard is one tap away, never
 * the default.
 */
export const homeFor = (u: { role: Role; roles?: Role[] | null }): string => {
  const mine = rolesOf(u)
  if (mine.includes('recorder') || mine.includes('admin')) return '/record'
  return ROLE_HOME[mine[0] ?? u.role]
}

export const rolesLabel = (u: { role: Role; roles?: Role[] | null }) =>
  ROLE_ORDER.filter((r) => rolesOf(u).includes(r)).map((r) => ROLE_LABEL[r]).join(' + ')

export interface AppUser {
  id: string
  name: string
  username: string
  role: Role          // primary role (admin > poc > recorder), kept in sync by the database
  roles: Role[]       // every role the user has
  mobile_number: string | null
  email: string | null
  is_active: boolean
  must_change_pin: boolean
  last_login_at: string | null
}

export type LoginFailReason = 'invalid' | 'locked' | 'inactive' | 'rate_limited' | 'network' | 'unknown'

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: LoginFailReason; message: string; attemptsLeft?: number }
