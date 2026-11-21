// Admin actions on users: list, create, edit, reset PIN, unlock, delete.
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { CreateResult, ManagedUser, NewUserInput } from '../types/users'
import type { Role } from '../types/auth'

export async function listUsers(): Promise<ManagedUser[]> {
  const { data, error } = await supabase.rpc('admin_list_users')
  if (error) throw new Error('Could not load users. ' + error.message)
  return (data ?? []) as ManagedUser[]
}

export async function existingUsernames(): Promise<Set<string>> {
  const users = await listUsers()
  return new Set(users.map((u) => u.username))
}

export async function createUsers(rows: NewUserInput[]): Promise<CreateResult[]> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body: { rows } })
  if (error) {
    let message = 'Could not reach the server.'
    if (error instanceof FunctionsHttpError) {
      try { message = (await error.context.json())?.error ?? message } catch { }
    }

    return rows.map((r) => ({ index: r.index, ok: false, error: message }))
  }
  return (data?.results ?? []) as CreateResult[]
}

export async function updateUser(u: {
  id: string; name: string; username: string; roles: Role[]
  mobile_number: string | null; email: string | null; is_active: boolean
}): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('admin_update_user', {
    p_user_id: u.id,
    p_name: u.name,
    p_username: u.username,
    p_roles: u.roles,
    p_mobile: u.mobile_number,
    p_email: u.email,
    p_is_active: u.is_active,
  })
  if (error) return { ok: false, error: 'Could not save changes. ' + error.message }
  return data as { ok: boolean; error?: string }
}

export async function resetPin(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_reset_pin', { p_user_id: userId })
  if (error) throw new Error('Could not reset PIN. ' + error.message)
}

export async function unlockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_unlock_user', { p_user_id: userId })
  if (error) throw new Error('Could not unlock user. ' + error.message)
}

export async function deleteUser(userId: string): Promise<{ ok: true } | { ok: false; error: string; hasHistory: boolean }> {
  const { error } = await supabase.functions.invoke('admin-users', { body: { delete_user_id: userId } })
  if (!error) return { ok: true }
  let message = 'Could not reach the server.'
  let hasHistory = false
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json()
      message = body?.error ?? message
      hasHistory = body?.reason === 'has_history'
    } catch { }
  }
  return { ok: false, error: message, hasHistory }
}
