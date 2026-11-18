// =============================================================================
// WHAT THIS FILE IS
//   Edge Function "admin-users": creates new app users, one at a time (Add User)
//   or in batches (CSV import).
//
// WHY IT EXISTS
//   Creating a user means creating a Supabase Auth account, and that needs the
//   service-role key, which must never reach the browser. So the browser sends
//   the rows here and this function:
//     1. confirms the caller is an ACTIVE ADMIN (checked from their token and
//        the database, not trusted from the request)
//     2. re-validates every row (the browser preview is only a convenience)
//     3. per row: creates the Auth account (dummy email, random unknown
//        password), then the app_users row with default PIN 0000 and
//        must_change_pin = true
//     4. if step 3's database insert fails, deletes the Auth account it just
//        created, so no half-made users are left behind
//   Each row succeeds or fails on its own, and the result for every row is
//   returned so the screen can show Imported / Failed with reasons.
//   Duplicate protection: the username is unique in the database, so even if
//   the same batch is sent twice (e.g. a network retry), the second attempt
//   fails with "username already taken" instead of creating a duplicate.
//
// USED BY
//   src/services/userAdminService.ts → createUsers()
//
// DEPENDS ON
//   • SQL: auth_create_app_user (migration 3)
//   • Auto-provided secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   • Optional secrets: ALLOWED_ORIGINS (same as auth-login),
//     AUTH_EMAIL_DOMAIN (default "food-review.invalid")
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EMAIL_DOMAIN = Deno.env.get('AUTH_EMAIL_DOMAIN') || 'food-review.invalid'
const MAX_ROWS_PER_REQUEST = 50

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map((o) => o.trim()).filter(Boolean)

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = allowedOrigins.length === 0
    ? '*'
    : (origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0])
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function reply(origin: string | null, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

interface InRow {
  index: number          // the row's position in the admin's list, echoed back
  name: string
  username: string
  role?: string             // single role (older callers)
  roles?: string[]          // every role (migration 11)
  mobile_number?: string | null
  email?: string | null
}

interface RowResult { index: number; ok: boolean; user_id?: string; username?: string; error?: string }

const USERNAME_RE = /^[a-z0-9]+(\.[a-z0-9]+)*$/
const ROLES = new Set(['admin', 'recorder', 'poc'])

/** Re-check a row on the server. Returns an error message, or null when OK. */
function validate(r: InRow): string | null {
  const name = String(r.name ?? '').trim()
  const username = String(r.username ?? '').trim().toLowerCase()
  if (!name) return 'Name is empty'
  if (name.length > 120) return 'Name is longer than 120 characters'
  if (!username) return 'Username is empty'
  if (username.length > 64 || !USERNAME_RE.test(username)) {
    return 'Username can only use lowercase letters, numbers and dots'
  }
  const roles = rolesOf(r)
  if (roles.length === 0) return 'Choose at least one role'
  const bad = roles.find((x) => !ROLES.has(x))
  if (bad) return `Invalid role "${bad}"`
  if (r.mobile_number && String(r.mobile_number).length > 20) return 'Mobile number is too long'
  if (r.email && String(r.email).length > 200) return 'Email is too long'
  return null
}

/** Every role for a row: the roles list if given, else the single role. Duplicates removed. */
function rolesOf(r: InRow): string[] {
  const list = Array.isArray(r.roles) && r.roles.length ? r.roles : (r.role ? [r.role] : [])
  return [...new Set(list.map(String))]
}
const primaryRole = (roles: string[]) => (roles.includes('admin') ? 'admin' : roles.includes('poc') ? 'poc' : 'recorder')

/** 32 random bytes, used as a password that nobody ever sees or uses. */
function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return reply(origin, 405, { error: 'Method not allowed' })

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // ---- 1. Who is calling? Must be an active admin. -------------------------
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: caller, error: callerErr } = await admin.auth.getUser(token)
  if (callerErr || !caller?.user) return reply(origin, 401, { error: 'Please sign in again.' })

  const { data: me } = await admin.from('app_users')
    .select('id, role, roles, is_active').eq('id', caller.user.id).maybeSingle()
  if (!me || !me.is_active || !(me.roles ?? [me.role]).includes('admin')) {
    return reply(origin, 403, { error: 'Only an admin can create users.' })
  }

  // ---- 2. Read the rows ----------------------------------------------------
  let rows: InRow[] = []
  try {
    const body = await req.json()
    rows = Array.isArray(body?.rows) ? body.rows : []
  } catch {
    return reply(origin, 400, { error: 'Invalid request.' })
  }
  if (rows.length === 0) return reply(origin, 400, { error: 'No users to create.' })
  if (rows.length > MAX_ROWS_PER_REQUEST) {
    return reply(origin, 400, { error: `Send at most ${MAX_ROWS_PER_REQUEST} users per request.` })
  }

  // ---- 3. Create each user. One at a time, so one bad row never blocks the rest.
  const results: RowResult[] = []
  for (const r of rows) {
    const problem = validate(r)
    if (problem) { results.push({ index: r.index, ok: false, error: problem }); continue }

    const username = r.username.trim().toLowerCase()

    // Cheap pre-check, so we don't create an Auth account just to delete it again.
    const { data: taken } = await admin.from('app_users').select('id').eq('username', username).maybeSingle()
    if (taken) { results.push({ index: r.index, ok: false, error: `Username "${username}" already exists` }); continue }

    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email: `${crypto.randomUUID()}@${EMAIL_DOMAIN}`,
      password: randomPassword(),
      email_confirm: true,
    })
    if (authErr || !created?.user) {
      console.error('createUser failed', authErr)
      results.push({ index: r.index, ok: false, error: 'Could not create the login account' })
      continue
    }

    const { error: dbErr } = await admin.rpc('auth_create_app_user', {
      p_id: created.user.id,
      p_name: r.name.trim(),
      p_username: username,
      p_role: primaryRole(rolesOf(r)),
      p_roles: rolesOf(r),
      p_mobile: r.mobile_number ? String(r.mobile_number).trim() || null : null,
      p_email: r.email ? String(r.email).trim() || null : null,
      p_created_by: me.id,
    })
    if (dbErr) {
      // Roll back the Auth account so no half-created user remains.
      await admin.auth.admin.deleteUser(created.user.id).catch((e) => console.error('rollback failed', e))
      const msg = dbErr.code === '23505' ? `Username "${username}" already exists` : 'Could not save the user'
      if (dbErr.code !== '23505') console.error('auth_create_app_user failed', dbErr)
      results.push({ index: r.index, ok: false, error: msg })
      continue
    }

    results.push({ index: r.index, ok: true, user_id: created.user.id, username })
  }

  return reply(origin, 200, { results })
})
