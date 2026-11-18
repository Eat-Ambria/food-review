// =============================================================================
// WHAT THIS FILE IS
//   The single Supabase client the whole app shares, plus the "Keep me signed
//   in" storage switch.
// WHY IT EXISTS
//   One client means one session. When auth-login hands us tokens we call
//   setSession() on it, and from then on every query is sent as that user, so
//   RLS sees auth.uid(). The publishable key is safe in the browser; real
//   protection comes from RLS + the GRANTs in the migrations.
//
//   Keep me signed in:
//     ON  (default) → session saved in localStorage. The user stays signed in
//                     until they press Sign out, even after closing the app or
//                     restarting the phone. The token refreshes automatically.
//     OFF           → session saved in sessionStorage, so the user is signed out
//                     when the browser/tab is closed (for shared phones).
// USED BY
//   services/*, contexts/AuthContext.tsx, pages/Login
// DEPENDS ON
//   VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY in .env
// =============================================================================
import { createClient, type SupportedStorage } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Lets the login page show a clear setup error instead of a blank screen.
export const supabaseConfigured = Boolean(url && key)
if (!supabaseConfigured) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.')
}

const REMEMBER_KEY = 'issue-desk-remember'

// Storage can throw (private mode, blocked site data), so every call is guarded.
function safe<T>(fn: () => T, fallback: T): T {
  try { return fn() } catch { return fallback }
}

export function getRememberMe(): boolean {
  return safe(() => localStorage.getItem(REMEMBER_KEY) !== '0', true)
}

/** Call BEFORE login so the new session lands in the right storage. */
export function setRememberMe(remember: boolean): void {
  safe(() => localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0'), undefined)
}

/**
 * Writes to localStorage or sessionStorage depending on the choice above.
 * Reads check both, and removes clear both, so switching the option never
 * leaves an old session behind.
 */
const switchingStorage: SupportedStorage = {
  getItem: (k) => safe(() => (getRememberMe() ? localStorage : sessionStorage).getItem(k)
    ?? localStorage.getItem(k) ?? sessionStorage.getItem(k), null),
  setItem: (k, v) => safe(() => {
    if (getRememberMe()) { localStorage.setItem(k, v); sessionStorage.removeItem(k) }
    else { sessionStorage.setItem(k, v); localStorage.removeItem(k) }
  }, undefined),
  removeItem: (k) => safe(() => { localStorage.removeItem(k); sessionStorage.removeItem(k) }, undefined),
}

export const supabase = createClient(url || 'http://localhost', key || 'missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // we never use email links in the browser
    storageKey: 'issue-desk-auth',
    storage: switchingStorage,
  },
})
