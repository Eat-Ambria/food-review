// Server function that checks the username + PIN and signs the user in.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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

const MESSAGES: Record<string, string> = {
  invalid: 'Incorrect username or PIN.',
  locked: 'Too many wrong PINs. This account is locked for a while. Ask an admin to unlock it, or try later.',
  inactive: 'This account has been deactivated. Please contact your admin.',
  rate_limited: 'Too many login attempts from this network. Please wait 15 minutes and try again.',
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return reply(origin, 405, { error: 'Method not allowed' })

  let username = ''
  let pin = ''
  try {
    const body = await req.json()
    username = String(body?.username ?? '').trim().toLowerCase()
    pin = String(body?.pin ?? '')
  } catch {
    return reply(origin, 400, { error: 'Invalid request.' })
  }
  if (!username || username.length > 64 || !/^\d{4}$/.test(pin)) {
    return reply(origin, 400, { error: 'Enter your username and 4-digit PIN.' })
  }

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: check, error: checkErr } = await admin.rpc('auth_check_pin', {
    p_username: username, p_pin: pin, p_ip: ip,
  })
  if (checkErr) {
    console.error('auth_check_pin failed', checkErr)
    return reply(origin, 500, { error: 'Login is temporarily unavailable. Please try again.' })
  }
  if (!check?.ok) {
    const reason = String(check?.reason ?? 'invalid')
    const status = reason === 'rate_limited' ? 429 : reason === 'invalid' ? 401 : 403
    return reply(origin, status, {
      error: MESSAGES[reason] ?? MESSAGES.invalid,
      reason,
      attempts_left: check?.attempts_left ?? undefined,
      locked_until: check?.locked_until ?? undefined,
    })
  }

  try {
    const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(check.user_id)
    if (userErr || !userRes?.user?.email) throw userErr ?? new Error('Auth user has no email')

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: userRes.user.email,
    })
    if (linkErr || !link?.properties?.hashed_token) throw linkErr ?? new Error('No token returned')

    const pub = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: verified, error: verifyErr } = await pub.auth.verifyOtp({
      type: 'magiclink',
      token_hash: link.properties.hashed_token,
    })
    if (verifyErr || !verified?.session) throw verifyErr ?? new Error('No session returned')

    return reply(origin, 200, {
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
    })
  } catch (e) {
    console.error('session creation failed', e)
    return reply(origin, 500, { error: 'Login is temporarily unavailable. Please try again.' })
  }
})
