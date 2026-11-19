// Connects the app to Supabase, and remembers the "Keep me signed in" choice.
import { createClient, type SupportedStorage } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabaseConfigured = Boolean(url && key)
if (!supabaseConfigured) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.')
}

const REMEMBER_KEY = 'issue-desk-remember'

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn() } catch { return fallback }
}

export function getRememberMe(): boolean {
  return safe(() => localStorage.getItem(REMEMBER_KEY) !== '0', true)
}

export function setRememberMe(remember: boolean): void {
  safe(() => localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0'), undefined)
}

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
    detectSessionInUrl: false,
    storageKey: 'issue-desk-auth',
    storage: switchingStorage,
  },
})
