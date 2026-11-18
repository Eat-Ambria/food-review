// =============================================================================
// WHAT THIS FILE IS
//   React context that knows who is signed in, and their role.
// WHY IT EXISTS
//   Every screen needs to know who the user is. This loads it once, keeps it
//   in sync with Supabase session changes (refresh, sign-out in another tab),
//   and exposes login/logout/refresh helpers.
//   The profile is also cached. If the network is down when the app opens, the
//   user stays signed in using the cached profile instead of being thrown back
//   to the login page. Their session is still valid; only the profile fetch
//   failed. A definite "inactive" or "no such user" answer from the server
//   still signs them out.
//   NOTE: this is for showing the right screens only. Real security is in RLS.
//   A user who edits this state in DevTools still gets nothing from the database.
// USED BY
//   App.tsx (provider), routes/RequireAuth.tsx, layouts, pages
// DEPENDS ON
//   services/authService.ts, lib/supabase.ts
// =============================================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getRememberMe, supabase } from '../lib/supabase'
import * as auth from '../services/authService'
import type { AppUser, LoginResult } from '../types/auth'

interface AuthState {
  user: AppUser | null
  loading: boolean
  login: (username: string, pin: string) => Promise<LoginResult>
  logout: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

const PROFILE_KEY = 'issue-desk-profile'
const store = () => (getRememberMe() ? localStorage : sessionStorage)

function readCachedProfile(): AppUser | null {
  try { const raw = store().getItem(PROFILE_KEY); return raw ? (JSON.parse(raw) as AppUser) : null } catch { return null }
}
function writeCachedProfile(p: AppUser | null): void {
  try {
    localStorage.removeItem(PROFILE_KEY); sessionStorage.removeItem(PROFILE_KEY)
    if (p) store().setItem(PROFILE_KEY, JSON.stringify(p))
  } catch { /* storage blocked: caching is only a convenience */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) { setUser(null); writeCachedProfile(null); return }
    try {
      const profile = await auth.fetchMyProfile(userId)
      // The server says: no row, or deactivated. Not allowed in; sign out.
      if (!profile || !profile.is_active) {
        await auth.logout()
        setUser(null)
        writeCachedProfile(null)
        return
      }
      setUser(profile)
      writeCachedProfile(profile)
    } catch (e) {
      // Network or server hiccup: keep the user signed in with the cached profile.
      console.error('Failed to load profile', e)
      const cached = readCachedProfile()
      setUser(cached && cached.id === userId ? cached : null)
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      await loadProfile(data.session?.user.id)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Token refreshes don't change who the user is, so only react to sign-out
      // (e.g. from another tab). Sign-in is handled by login() below.
      if (event === 'SIGNED_OUT') { setUser(null); writeCachedProfile(null) }
      // Deferred: calling Supabase inside this callback can deadlock the client.
      if (event === 'USER_UPDATED') setTimeout(() => { void loadProfile(session?.user.id) }, 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const login = useCallback(async (username: string, pin: string) => {
    const result = await auth.login(username, pin)
    if (result.ok) {
      const { data } = await supabase.auth.getSession()
      await loadProfile(data.session?.user.id)
    }
    return result
  }, [loadProfile])

  const logout = useCallback(async () => {
    await auth.logout()
    setUser(null)
    writeCachedProfile(null)
  }, [])

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    await loadProfile(data.session?.user.id)
  }, [loadProfile])

  const value = useMemo(() => ({ user, loading, login, logout, refreshProfile }),
    [user, loading, login, logout, refreshProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
