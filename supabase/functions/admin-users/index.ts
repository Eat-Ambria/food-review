// Server function that creates users, one at a time or from a CSV.
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
  index: number
  name: string
  username: string
  role?: string
  roles?: string[]
  mobile_number?: string | null
  email?: string | null
}

interface RowResult { index: number; ok: boolean; user_id?: string; username?: string; error?: string }

const USERNAME_RE = /^[a-z0-9]+([ .][a-z0-9]+)*$/
const ROLES = new Set(['admin', 'recorder', 'poc'])

function validate(r: InRow): string | null {
  const name = String(r.name ?? '').trim()
  const username = String(r.username ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!name) return 'Name is empty'
  if (name.length > 120) return 'Name is longer than 120 characters'
  if (!username) return 'Username is empty'
  if (username.length > 64 || !USERNAME_RE.test(username)) {
    return 'Username can only use small letters, numbers and single spaces'
  }
  const roles = rolesOf(r)
  if (roles.length === 0) return 'Choose at least one role'
  const bad = roles.find((x) => !ROLES.has(x))
  if (bad) return `Invalid role "${bad}"`
  if (r.mobile_number && String(r.mobile_number).length > 20) return 'Mobile number is too long'
  if (r.email && String(r.email).length > 200) return 'Email is too long'
  return null
}

function rolesOf(r: InRow): string[] {
  const list = Array.isArray(r.roles) && r.roles.length ? r.roles : (r.role ? [r.role] : [])
  return [...new Set(list.map(String))]
}
const primaryRole = (roles: string[]) => (roles.includes('admin') ? 'admin' : roles.includes('poc') ? 'poc' : 'recorder')

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

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: caller, error: callerErr } = await admin.auth.getUser(token)
  if (callerErr || !caller?.user) return reply(origin, 401, { error: 'Please sign in again.' })

  const { data: me } = await admin.from('app_users')
    .select('id, role, roles, is_active').eq('id', caller.user.id).maybeSingle()
  if (!me || !me.is_active || !(me.roles ?? [me.role]).includes('admin')) {
    return reply(origin, 403, { error: 'Only an admin can manage users.' })
  }

  let rows: InRow[] = []
  let deleteId = ''
  try {
    const body = await req.json()
    rows = Array.isArray(body?.rows) ? body.rows : []
    deleteId = typeof body?.delete_user_id === 'string' ? body.delete_user_id : ''
  } catch {
    return reply(origin, 400, { error: 'Invalid request.' })
  }

  if (deleteId) {
    if (deleteId === me.id) return reply(origin, 400, { error: 'You cannot delete your own account.' })
    const { data: target } = await admin.from('app_users').select('id').eq('id', deleteId).maybeSingle()
    if (!target) return reply(origin, 404, { error: 'This user no longer exists.' })

    const { error: rowErr } = await admin.from('app_users').delete().eq('id', deleteId)
    if (rowErr) {
      if (rowErr.code === '23503') {
        return reply(origin, 409, {
          error: 'This user has history in the app (such as complaints), so they cannot be deleted. Deactivate them instead.',
          reason: 'has_history',
        })
      }
      console.error('delete app_user failed', rowErr)
      return reply(origin, 500, { error: 'Could not delete the user.' })
    }
    const { error: authErr } = await admin.auth.admin.deleteUser(deleteId)
    if (authErr) console.error('delete auth user failed', authErr)
    return reply(origin, 200, { ok: true })
  }
  if (rows.length === 0) return reply(origin, 400, { error: 'No users to create.' })
  if (rows.length > MAX_ROWS_PER_REQUEST) {
    return reply(origin, 400, { error: `Send at most ${MAX_ROWS_PER_REQUEST} users per request.` })
  }

  const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const firstName = (s: string) => letters(String(s ?? '').trim().split(/[\s.]+/)[0] ?? '')
  const { data: everyone } = await admin.from('app_users').select('name, username, is_active')
  const clashOf = (username: string): string | null => {
    const key = letters(username)
    for (const u of everyone ?? []) {
      if (u.username === username) continue
      if (letters(u.username as string) === key) return `Too close to the existing username "${u.username}"`
      if (u.is_active && firstName(u.name as string) === key) return `"${username}" is how ${u.name} signs in. Choose a longer username`
    }
    return null
  }

  const results: RowResult[] = []
  for (const r of rows) {
    const problem = validate(r)
    if (problem) { results.push({ index: r.index, ok: false, error: problem }); continue }

    const username = String(r.username).trim().toLowerCase().replace(/\s+/g, ' ')
    const clash = clashOf(username)
    if (clash) { results.push({ index: r.index, ok: false, error: clash }); continue }

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
      p_name: String(r.name).trim(),
      p_username: username,
      p_role: primaryRole(rolesOf(r)),
      p_roles: rolesOf(r),
      p_mobile: r.mobile_number ? String(r.mobile_number).trim() || null : null,
      p_email: r.email ? String(r.email).trim() || null : null,
      p_created_by: me.id,
    })
    if (dbErr) {

      await admin.auth.admin.deleteUser(created.user.id).catch((e) => console.error('rollback failed', e))
      const msg = dbErr.code === '23505' ? (/too close/i.test(dbErr.message) ? dbErr.message : `Username "${username}" already exists`) : 'Could not save the user'
      if (dbErr.code !== '23505') console.error('auth_create_app_user failed', dbErr)
      results.push({ index: r.index, ok: false, error: msg })
      continue
    }

    results.push({ index: r.index, ok: true, user_id: created.user.id, username })
  }

  return reply(origin, 200, { results })
})
