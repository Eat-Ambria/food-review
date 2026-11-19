// Keeps track of who is signed in and their roles, for the whole app.
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
  } catch { }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) { setUser(null); writeCachedProfile(null); return }
    try {
      const profile = await auth.fetchMyProfile(userId)

      if (!profile || !profile.is_active) {
        await auth.logout()
        setUser(null)
        writeCachedProfile(null)
        return
      }
      setUser(profile)
      writeCachedProfile(profile)
    } catch (e) {

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

      if (event === 'SIGNED_OUT') { setUser(null); writeCachedProfile(null) }

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
