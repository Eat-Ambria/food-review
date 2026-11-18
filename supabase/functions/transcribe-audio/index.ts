// =============================================================================
// WHAT THIS FILE IS
//   Edge Function "transcribe-audio": sends ONE audio chunk (≤ 30 s WAV) to
//   Sarvam Saaras v4 and returns the text.
//
// WHY IT EXISTS
//   • The Sarvam API key must stay on the server (Supabase secret), never in the
//     browser.
//   • Sarvam's real-time API accepts at most 30 seconds per request. The
//     browser cuts a 2-minute recording into ≤29 s WAV chunks, at quiet moments
//     so words aren't cut, and calls this function once per chunk.
//   • Spend protection (SQL migration 6):
//       – each chunk is RESERVED before Sarvam is called and its text SAVED
//         after. A repeated chunk (double tap, two tabs, a retry after a lost
//         response) returns the saved text and is never paid for twice.
//       – anti-spam only (migration 7): at least 20 s between two NEW
//         recordings from one user, and at most 20 new recordings per 15 min.
//         No daily cap (4–5 functions a day mean many genuine recordings).
//         All of this is changeable in app_settings. When a limit is hit, the
//         reply says WHEN the user may continue; the app keeps the recording
//         and transcribes it automatically at that time.
//       – backstop: at most 60 Sarvam calls per user per 10 minutes.
//   • Every Sarvam call is written to api_usage_log (seconds of audio, time
//     taken, errors), so real usage and cost are visible.
//
//   Sarvam settings (official docs, checked 2026-11-16):
//     POST https://api.sarvam.ai/speech-to-text, header api-subscription-key,
//     multipart fields: file, model, mode, language_code, keyterms (v4 only,
//     JSON array, ≤ 50 terms of ≤ 64 chars).
//   mode "codemix" keeps Hinglish as spoken: Hindi words in Devanagari, English
//   words in English ("मेरा phone number है"). Each setting can be changed with
//   a secret, without a code change.
//
// USED BY
//   src/services/sarvamService.ts
//
// DEPENDS ON
//   Secrets: SARVAM_API_KEY (required)
//            SARVAM_STT_MODEL      default "saaras:v4"
//            SARVAM_STT_MODE       default "codemix"  (transcribe | codemix | translit | verbatim)
//            SARVAM_LANGUAGE_CODE  default "hi-IN"    ("unknown" = auto-detect)
//            ALLOWED_ORIGINS
//   Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   SQL: stt_reserve_chunk / stt_complete_chunk / stt_release_chunk (migration 6)
//   Tables: app_users, venues, venue_aliases (key terms), api_usage_log
//
// DASHBOARD SETTING
//   Verify JWT: OFF. The function checks the caller's session itself.
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SARVAM_KEY = Deno.env.get('SARVAM_API_KEY') ?? ''
const MODEL = Deno.env.get('SARVAM_STT_MODEL') || 'saaras:v4'
const MODE = Deno.env.get('SARVAM_STT_MODE') || 'codemix'
const LANGUAGE = Deno.env.get('SARVAM_LANGUAGE_CODE') || 'hi-IN'
const SARVAM_URL = 'https://api.sarvam.ai/speech-to-text'
// Venue names as Sarvam "keyterms" bias recognition so strongly that a venue
// name can appear in the transcript even when it was NOT said (seen in testing:
// "N P Singh" came out as "Ambria Pushpanjali"). Off by default; the transcript
// must be what was said. Venues are still recognised later from our aliases.
// Set the secret SARVAM_KEYTERMS=on to switch it back on.
const USE_KEYTERMS = (Deno.env.get('SARVAM_KEYTERMS') ?? 'off').toLowerCase() === 'on'

const MAX_BYTES = 2_000_000            // 29 s of 16 kHz mono 16-bit WAV ≈ 0.93 MB
const MAX_CHUNK_INDEX = 10             // 2 min / 29 s = 5 chunks; anything far above is not ours
const SARVAM_TIMEOUT_MS = 30_000
const BACKSTOP_CALLS = 60              // Sarvam calls …
const BACKSTOP_WINDOW_MIN = 10         // … per this many minutes, per user
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

/** `retryable` tells the app whether trying again could help; `retry_after` says when. */
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

  // ---- 1. Caller must be an active Recording User or Admin -----------------
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  // Checking the sign-in and reading the upload don't depend on each other.
  const formPromise = req.formData().catch(() => null)
  const { data: caller } = await db.auth.getUser(token)
  if (!caller?.user) return reply(origin, 401, { error: 'Please sign in again.', retryable: false })
  // roles = every role the user has (migration 11); a POC who also records is allowed.
  const { data: me } = await db.from('app_users').select('id, role, roles, is_active').eq('id', caller.user.id).maybeSingle()
  const myRoles: string[] = me?.roles ?? (me?.role ? [me.role] : [])
  if (!me?.is_active || !myRoles.some((r) => r === 'recorder' || r === 'admin')) {
    return reply(origin, 403, { error: 'You are not allowed to record issues.', retryable: false })
  }

  if (!SARVAM_KEY) {
    return reply(origin, 503, { error: 'Transcription is not set up yet (SARVAM_API_KEY secret missing). Tell your admin.', retryable: false })
  }

  // ---- 2. Read and check the chunk ------------------------------------------
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
  // 16 kHz × 2 bytes, minus the 44-byte WAV header
  const audioSeconds = Math.round(Math.max(0, (file.size - 44) / 32000) * 100) / 100

  // ---- 3. Reserve the chunk (duplicate protection + per-user limits) --------
  const since = new Date(Date.now() - BACKSTOP_WINDOW_MIN * 60_000).toISOString()
  const [{ data: slot, error: slotErr }, { count }] = await Promise.all([
    db.rpc('stt_reserve_chunk', {
      p_user_id: me.id, p_client_id: clientId, p_chunk_index: chunkIndex, p_audio_seconds: audioSeconds,
    }),
    // Backstop against hammering, counted from the usage log (checked below).
    db.from('api_usage_log').select('id', { count: 'exact', head: true })
      .eq('provider', 'sarvam').eq('user_id', me.id).gte('created_at', since),
  ])
  if (slotErr || !slot) {
    console.error('stt_reserve_chunk failed', slotErr)
    return reply(origin, 500, { error: 'Transcription is temporarily unavailable. Please retry.', retryable: true })
  }
  switch (slot.status) {
    case 'cached':     // already transcribed earlier → free
      return reply(origin, 200, {
        transcript: slot.transcript ?? '', language_code: slot.language_code ?? null,
        request_id: slot.request_id ?? null, model: MODEL, mode: MODE, cached: true,
      })
    case 'busy':       // the same chunk is being transcribed right now (other tab / double tap)
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

  // Backstop against hammering (count fetched together with the reservation).
  if ((count ?? 0) >= BACKSTOP_CALLS) {
    await db.rpc('stt_release_chunk', { p_id: reservationId })
    return reply(origin, 429, { error: 'Too many transcriptions in a short time.', limit: 'burst',
      retry_after: new Date(Date.now() + BACKSTOP_WINDOW_MIN * 60_000).toISOString(), retryable: true })
  }

  // ---- 4. Venue names as key terms, so Sarvam spells them right ------------
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

  // ---- 5. Call Sarvam --------------------------------------------------------
  const body = new FormData()
  body.append('file', file, `chunk-${chunkIndex}.wav`)
  body.append('model', MODEL)
  body.append('mode', MODE)
  body.append('language_code', LANGUAGE)
  if (keyterms.length) body.append('keyterms', JSON.stringify(keyterms))

  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), SARVAM_TIMEOUT_MS)
  let httpStatus = 0
  let payload: Record<string, unknown> = {}
  let networkError: string | null = null
  try {
    const res = await fetch(SARVAM_URL, {
      method: 'POST',
      headers: { 'api-subscription-key': SARVAM_KEY },
      body,
      signal: ctrl.signal,
    })
    httpStatus = res.status
    payload = await res.json().catch(() => ({}))
  } catch (e) {
    networkError = (e as Error).name === 'AbortError' ? 'Sarvam timed out' : `Network error: ${(e as Error).message}`
  } finally {
    clearTimeout(timer)
  }
  const latency = Date.now() - started
  const ok = !networkError && httpStatus === 200 && typeof payload.transcript === 'string'
  const sarvamErr = (payload.error ?? {}) as { message?: string; code?: string }

  // ---- 6. Save the result (or free the reservation) and log the call --------
  const saveResult = ok
    ? db.rpc('stt_complete_chunk', {
      p_id: reservationId,
      p_transcript: (payload.transcript as string).trim(),
      p_language: (payload.language_code as string) ?? null,
      p_request_id: (payload.request_id as string) ?? null,
    })
    : db.rpc('stt_release_chunk', { p_id: reservationId })

  // Saving the transcript and writing the usage log run side by side.
  await Promise.all([saveResult, db.from('api_usage_log').insert({
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
  })])

  if (ok) {
    return reply(origin, 200, {
      transcript: (payload.transcript as string).trim(),
      language_code: payload.language_code ?? null,
      request_id: payload.request_id ?? null,
      model: MODEL,
      mode: MODE,
    })
  }

  // ---- 7. Turn Sarvam errors into messages a user can act on ----------------
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
