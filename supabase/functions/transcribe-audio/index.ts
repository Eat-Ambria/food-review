// Server function that sends one audio part to Sarvam and returns the text.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SARVAM_KEY = Deno.env.get('SARVAM_API_KEY') ?? ''
const MODEL = Deno.env.get('SARVAM_STT_MODEL') || 'saaras:v4'
const MODE = Deno.env.get('SARVAM_STT_MODE') || 'codemix'
const LANGUAGE = Deno.env.get('SARVAM_LANGUAGE_CODE') || 'hi-IN'
const SARVAM_URL = 'https://api.sarvam.ai/speech-to-text'

const USE_KEYTERMS = (Deno.env.get('SARVAM_KEYTERMS') ?? 'off').toLowerCase() === 'on'

const MAX_BYTES = 2_000_000
const MAX_CHUNK_INDEX = 10
const SARVAM_TIMEOUT_MS = 30_000
const BACKSTOP_CALLS = 60
const BACKSTOP_WINDOW_MIN = 10
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

function reply(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return reply(origin, 405, { error: 'Method not allowed' })

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')

  const formPromise = req.formData().catch(() => null)
  const { data: caller } = await db.auth.getUser(token)
  if (!caller?.user) return reply(origin, 401, { error: 'Please sign in again.', retryable: false })

  const { data: me } = await db.from('app_users').select('id, role, roles, is_active').eq('id', caller.user.id).maybeSingle()
  const myRoles: string[] = me?.roles ?? (me?.role ? [me.role] : [])
  if (!me?.is_active || !myRoles.some((r) => r === 'recorder' || r === 'admin')) {
    return reply(origin, 403, { error: 'You are not allowed to record issues.', retryable: false })
  }

  if (!SARVAM_KEY) {
    return reply(origin, 503, { error: 'Transcription is not set up yet (SARVAM_API_KEY secret missing). Tell your admin.', retryable: false })
  }

  let file: File | null = null
  let chunkIndex = -1
  let clientId = ''
  try {
    const form = await formPromise
    if (!form) throw new Error('bad form')
    const f = form.get('file')
    file = f instanceof File ? f : null
    chunkIndex = Number(form.get('chunk_index'))
    clientId = String(form.get('client_submission_id') ?? '')
  } catch {
    return reply(origin, 400, { error: 'Invalid upload.', retryable: false })
  }
  if (!UUID_RE.test(clientId) || !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > MAX_CHUNK_INDEX) {
    return reply(origin, 400, { error: 'Invalid upload. Please update the app and try again.', retryable: false })
  }
  if (!file || file.size === 0) return reply(origin, 400, { error: 'No audio received.', retryable: true })
  if (file.size > MAX_BYTES) return reply(origin, 413, { error: 'Audio chunk is too large.', retryable: false })

  const audioSeconds = Math.round(Math.max(0, (file.size - 44) / 32000) * 100) / 100

  const since = new Date(Date.now() - BACKSTOP_WINDOW_MIN * 60_000).toISOString()
  const [{ data: slot, error: slotErr }, { count }] = await Promise.all([
    db.rpc('stt_reserve_chunk', {
      p_user_id: me.id, p_client_id: clientId, p_chunk_index: chunkIndex, p_audio_seconds: audioSeconds,
    }),

    db.from('api_usage_log').select('id', { count: 'exact', head: true })
      .eq('provider', 'sarvam').eq('user_id', me.id).gte('created_at', since),
  ])
  if (slotErr || !slot) {
    console.error('stt_reserve_chunk failed', slotErr)
    return reply(origin, 500, { error: 'Transcription is temporarily unavailable. Please retry.', retryable: true })
  }
  switch (slot.status) {
    case 'cached':
      return reply(origin, 200, {
        transcript: slot.transcript ?? '', language_code: slot.language_code ?? null,
        request_id: slot.request_id ?? null, model: MODEL, mode: MODE, cached: true,
      })
    case 'busy':
      return reply(origin, 409, { error: 'This part is already being transcribed.', retryable: true, busy: true })
    case 'limited':
      if (slot.reason === 'forbidden') return reply(origin, 403, { error: 'Not allowed.', retryable: false })
      return reply(origin, 429, {
        error: slot.reason === 'gap'
          ? 'Recordings are being sent too quickly.'
          : slot.reason === 'daily'
            ? `Daily limit of ${slot.max_minutes} minutes of recordings reached.`
            : `Limit reached: ${slot.max} recordings in ${slot.window_minutes} minutes.`,
        limit: slot.reason, retry_after: slot.retry_after, retryable: true,
      })
    case 'go':
      break
    default:
      return reply(origin, 500, { error: 'Unexpected reply. Please retry.', retryable: true })
  }
  const reservationId = slot.id as string

  if ((count ?? 0) >= BACKSTOP_CALLS) {
    await db.rpc('stt_release_chunk', { p_id: reservationId })
    return reply(origin, 429, { error: 'Too many transcriptions in a short time.', limit: 'burst',
      retry_after: new Date(Date.now() + BACKSTOP_WINDOW_MIN * 60_000).toISOString(), retryable: true })
  }

  const keyterms: string[] = []
  if (MODEL === 'saaras:v4' && USE_KEYTERMS) {
    const [{ data: venues }, { data: aliases }] = await Promise.all([
      db.from('venues').select('venue_name').eq('is_active', true).limit(50),
      db.from('venue_aliases').select('alias').limit(100),
    ])
    for (const t of [...(venues ?? []).map((v) => v.venue_name), ...(aliases ?? []).map((a) => a.alias)]) {
      const term = String(t ?? '').trim().slice(0, 64)
      if (term && !keyterms.includes(term) && keyterms.length < 50) keyterms.push(term)
    }
  }

  const body = new FormData()
  body.append('file', file, `chunk-${chunkIndex}.wav`)
  body.append('model', MODEL)
  body.append('mode', MODE)
  body.append('language_code', LANGUAGE)
  if (keyterms.length) body.append('keyterms', JSON.stringify(keyterms))

  const started = Date.now()
  let httpStatus = 0
  let payload: Record<string, unknown> = {}
  let networkError: string | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), SARVAM_TIMEOUT_MS)
    let retryAfterMs = 0
    httpStatus = 0
    payload = {}
    networkError = null
    try {
      const res = await fetch(SARVAM_URL, {
        method: 'POST',
        headers: { 'api-subscription-key': SARVAM_KEY },
        body,
        signal: ctrl.signal,
      })
      httpStatus = res.status
      retryAfterMs = Math.min(5000, Number(res.headers.get('retry-after') ?? 0) * 1000 || 0)
      payload = await res.json().catch(() => ({}))
    } catch (e) {
      networkError = (e as Error).name === 'AbortError' ? 'Sarvam timed out' : `Network error: ${(e as Error).message}`
    } finally {
      clearTimeout(timer)
    }
    if (networkError || !(httpStatus === 429 || httpStatus >= 500)) break
    await new Promise((r) => setTimeout(r, retryAfterMs || 1000 + Math.random() * 2000))
  }
  const latency = Date.now() - started
  const ok = !networkError && httpStatus === 200 && typeof payload.transcript === 'string'
  const sarvamErr = (payload.error ?? {}) as { message?: string; code?: string }

  const saveResult = ok
    ? db.rpc('stt_complete_chunk', {
      p_id: reservationId,
      p_transcript: (payload.transcript as string).trim(),
      p_language: (payload.language_code as string) ?? null,
      p_request_id: (payload.request_id as string) ?? null,
    })
    : db.rpc('stt_release_chunk', { p_id: reservationId })

  const logged = db.from('api_usage_log').insert({
    provider: 'sarvam',
    operation: 'transcribe',
    model: MODEL,
    ok,
    http_status: httpStatus || null,
    latency_ms: latency,
    usage: { audio_seconds: audioSeconds, chunk_index: chunkIndex, client_submission_id: clientId,
             mode: MODE, language: LANGUAGE, keyterms: keyterms.length },
    error: ok ? null : (networkError ?? `${sarvamErr.code ?? httpStatus}: ${sarvamErr.message ?? 'unknown error'}`).slice(0, 500),
    user_id: me.id,
  }).then(() => { })
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(logged)
  await saveResult

  if (ok) {
    return reply(origin, 200, {
      transcript: (payload.transcript as string).trim(),
      language_code: payload.language_code ?? null,
      request_id: payload.request_id ?? null,
      model: MODEL,
      mode: MODE,
    })
  }

  if (networkError) return reply(origin, 504, { error: 'Transcription service did not respond. Please retry.', retryable: true })
  switch (httpStatus) {
    case 401:
    case 403:
      return reply(origin, 502, { error: 'Transcription key is invalid. Tell your admin to check SARVAM_API_KEY.', retryable: false })
    case 402:
      return reply(origin, 502, { error: 'Transcription credits are exhausted. Tell your admin to top up Sarvam.', retryable: false })
    case 422:
      return reply(origin, 422, { error: 'This audio could not be read. Please record again.', retryable: false })
    case 429:
      return reply(origin, 503, { error: 'Transcription service is busy. Retrying in a moment usually works.', retryable: true })
    default:
      return reply(origin, 502, { error: 'Transcription failed. Please retry.', retryable: true })
  }
})
