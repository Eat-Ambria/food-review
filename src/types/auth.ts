// Types for users, roles and login.
export type Role = 'admin' | 'recorder' | 'poc'

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  recorder: 'Recording User',
  poc: 'POC',
}

export const ROLE_HOME: Record<Role, string> = {
  admin: '/admin',
  recorder: '/record',
  poc: '/issues',
}

export const ROLE_ORDER: Role[] = ['admin', 'recorder', 'poc']

export const rolesOf = (u: { role: Role; roles?: Role[] | null }): Role[] => (u.roles && u.roles.length ? u.roles : [u.role])

export const hasAnyRole = (u: { role: Role; roles?: Role[] | null }, wanted: Role[]) => rolesOf(u).some((r) => wanted.includes(r))

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
  role: Role
  roles: Role[]
  mobile_number: string | null
  email: string | null
  is_active: boolean
  must_change_pin: boolean
  last_login_at: string | null
}

export type LoginFailReason = 'invalid' | 'locked' | 'inactive' | 'rate_limited' | 'slow_down' | 'network' | 'unknown'

export type LoginResult =
  | { ok: true; username?: string }
  | { ok: false; reason: LoginFailReason; message: string }
