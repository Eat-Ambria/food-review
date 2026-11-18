// =============================================================================
// WHAT THIS FILE IS
//   Everything the app does to log in, log out, load the profile and change
//   the PIN.
// WHY IT EXISTS
//   Keeps auth calls out of the UI. Pages call login() or changePin() and get
//   back a plain result; they never deal with Supabase details.
// USED BY
//   contexts/AuthContext.tsx
// DEPENDS ON
//   Edge Function auth-login; SQL function change_my_pin
// =============================================================================
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { AppUser, LoginFailReason, LoginResult } from '../types/auth'

export async function login(username: string, pin: string): Promise<LoginResult> {
  const { data, error } = await supabase.functions.invoke('auth-login', {
    body: { username: username.trim().toLowerCase(), pin },
  })

  if (error) {
    // The function answered with an error status (401/403/429…): read its message.
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json()
        return {
          ok: false,
          reason: (body?.reason as LoginFailReason) ?? 'unknown',
          message: body?.error ?? 'Login failed.',
          attemptsLeft: body?.attempts_left,
        }
      } catch { /* not JSON — fall through to the generic message */ }
    }
    return {
      ok: false,
      reason: navigator.onLine ? 'unknown' : 'network',
      message: navigator.onLine
        ? 'Could not reach the server. Please try again.'
        : 'You are offline. Connect to the internet and try again.',
    }
  }

  const { error: sessErr } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  })
  if (sessErr) return { ok: false, reason: 'unknown', message: 'Could not start your session. Please try again.' }
  return { ok: true }
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut()
}

/** The signed-in user's own app_users row (RLS only lets them read their own). */
export async function fetchMyProfile(userId: string): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from('app_users')
    .select('id, name, username, role, roles, mobile_number, email, is_active, must_change_pin, last_login_at')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data as AppUser | null
}

export async function changePin(currentPin: string, newPin: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('change_my_pin', {
    p_current_pin: currentPin,
    p_new_pin: newPin,
  })
  if (error) return { ok: false, error: 'Could not change PIN. Please try again.' }
  return data as { ok: boolean; error?: string }
}
