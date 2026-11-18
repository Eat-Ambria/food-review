// =============================================================================
// WHAT THIS FILE IS
//   Edge Function "process-issue": receives a submitted recording and turns it
//   into individual, categorised issues with a 2-line summary each.
//
// WHY IT EXISTS
//   Pipeline for ONE submission:
//     1. save    – the submission row is created once per client_submission_id.
//                  Re-sending after a network drop returns the same submission
//                  and never creates a duplicate.
//     2. event   – asks event-calendar ("match") which booking the transcript
//                  is about. Guest/function/venue are copied ONLY from that
//                  booking. A tie is stored as ambiguous, never guessed.
//     3. AI      – Gemini reads the reviewed transcript and returns each
//                  separate issue: category (from OUR list), short English
//                  description, location, the exact words it came from, and a
//                  ≤2-line summary for the POC. The reply is validated before
//                  anything is saved.
//                  PRIVACY: guest names (from the Calendar) and phone numbers
//                  are replaced with [guest] / [phone] before sending.
//     3b. venue  – each issue has its OWN venue and event: one recording may
//                  cover several venues ("AP mein dal thandi, AM mein namak
//                  zyada"), and the same dish can have several problems. An
//                  issue naming another venue is matched to that venue's
//                  booking on the same day.
//     4. store   – issues are inserted with unique (submission_id, issue_index),
//                  so re-processing can never duplicate them.
//                  Status → pending_assignment (Phase 7 assigns POCs),
//                  needs_review (no clear issue found), or a retry later.
//   The AI never decides who gets an issue. POC routing comes from database
//   mappings only (Phase 7).
//   The reviewed transcript is stored exactly as the user approved it, and is
//   never rewritten.
//
//   Actions (POST JSON):
//     { action: "submit", client_submission_id, reviewed_transcript, raw_transcript?, allow_duplicate?,
//       chosen_calendar_event_id? (recorder's pick when the event was uncertain; checked against the matcher),
//       transcription_meta?, audio_path?, audio_mime?, audio_duration_sec? }
//     { action: "retry", submission_id }       Admin, or the system
//     { action: "cron" } + header x-cron-secret  Supabase Cron every 5 min (migration 14):
//        retry due/stuck recordings, delete expired audio, clean old logs
//   Secret: CRON_SECRET (must equal the Vault secret issue_desk_cron_secret)
//   Serious (migration 16): keywords from alert_keywords → submission flagged,
//   and every POC with a mobile number gets a WhatsApp via Whapi. Secrets:
//   WHAPI_API_TOKEN, APP_URL (optional). Action "whatsapp_test" for Admin.
//   Notifications (migration 15): after issues are saved, every POC gets a bell
//   row + a phone push. Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
//
// USED BY
//   src/services/submitService.ts; later the 5-minute cron (Phase 9)
//
// DEPENDS ON
//   Secrets: GEMINI_API_KEY (required), GEMINI_MODEL (default gemini-3.5-flash-lite),
//            GEMINI_FALLBACK_MODEL (optional, used when the main model is overloaded),
//            ALLOWED_ORIGINS
//   Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   Functions: event-calendar (match)
//   Tables: submissions, issues, issue_categories, venues, api_usage_log, job_errors
//
// DASHBOARD SETTING
//   Verify JWT: OFF. The function checks the caller's session itself.
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite'
// Optional second model, tried when the main one is overloaded (503) or down.
const GEMINI_FALLBACK_MODEL = Deno.env.get('GEMINI_FALLBACK_MODEL') || ''
const geminiUrl = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
const GEMINI_TIMEOUT_MS = 25_000   // 3 tries + fallback must fit in the function time limit
const MAX_ATTEMPTS = 12        // app retries (~6) + 5-minute job retries; each attempt already tries Gemini 3x
const MAX_ISSUES = 10
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

// Web Push (migration 15). The public key must equal VITE_VAPID_PUBLIC_KEY in
// the app's .env, or every send fails with 403.
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
// Apple rejects ".local" subjects (BadJwtToken), so fall back to this site's https URL.
// Apple (iPhone) rejects pushes with 403 BadJwtToken when this is not EXACTLY
// "mailto:name@domain" or an https:// URL (Chrome is lenient). So tidy whatever
// was typed into the secret: spaces, quotes, <…>, "mailto: x", a bare email,
// ".local" addresses. Anything still unusable falls back to the project URL.
function cleanSubject(raw: string): string {
  let s = raw.trim().replace(/^["'<]+|["'>]+$/g, '')
  if (!/^https:\/\//i.test(s)) {
    s = s.replace(/^mail\s*to\s*:?\s*/i, '').replace(/\s+/g, '')    // "mailto:", "mail to ", "mailto: "
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s)) s = 'mailto:' + s
  }
  const okMail = /^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s) && !/\.local$/i.test(s)
  const okUrl = /^https:\/\/[^\s]+$/i.test(s)
  return okMail || okUrl ? s : SUPABASE_URL
}
const VAPID_SUBJECT = cleanSubject(Deno.env.get('VAPID_SUBJECT') ?? '')
const PUSH_READY = Boolean(VAPID_PUBLIC && VAPID_PRIVATE)

// WhatsApp for serious complaints (migration 16), sent through Whapi.Cloud like
// the attendance "Aria" bot. APP_URL (optional) adds a link to the Issues page.
const WHAPI_TOKEN = Deno.env.get('WHAPI_API_TOKEN') ?? ''
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/?$/, '/')
if (PUSH_READY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
const CRON_RETRIES_PER_RUN = 5
const CRON_TIME_BUDGET_MS = 90_000      // stay well inside the function's time limit

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
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
}

type Db = ReturnType<typeof createClient>

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are an event operations issue extraction and summarization assistant for a banquet and events company in India.
You receive a complaint transcript recorded by staff. It may be Hindi, English or Hinglish (Hindi words in Devanagari, English words in Latin).

Your task: find every SEPARATE operational issue in the transcript and return them as JSON.

Rules:
- One entry per distinct problem. Do not merge separate issues. Do not split one issue into many.
- The SAME dish or item can have SEVERAL problems: each problem is its own entry
  (e.g. "dal makhani thandi thi aur namak zyada tha" = two entries, both with item "Dal Makhani").
- Problems at DIFFERENT venues are always separate entries, even for the same dish.
- Never invent or assume details that are not in the transcript. If something (like location) is not said, use null.
- "category" MUST be exactly one of the category names provided. Use "Other" if none fits.
- "description": one short, factual English sentence describing the problem.
- "item": the MAIN thing the problem is about: the dish, drink, object, service or area. This is the most
  important field, so fill it whenever anything is named.
    • Use the MOST SPECIFIC thing said: "dal makhani thandi thi" → "Dal Makhani" (not "Food");
      "paneer tikka mein namak" → "Paneer Tikka"; "welcome drink" → "Welcome Drink".
    • Write it as a short name of 1-4 words in Title Case, in English or Roman-script Hindi for dish names
      ("Gulab Jamun", "Chole Bhature", "Mocktail", "AC", "Washroom", "Sound System", "Valet Parking", "Waiter Service").
    • Translate plain Hindi words: khana → "Food", paani → "Water", pankha → "Fan", bijli/light → "Power" or "Lights",
      kursi → "Chairs", plate → "Plates", gaadi → "Parking".
    • Only the thing, never the problem: "Cold Dal" ✗ → "Dal Makhani"; "Dirty Washroom" ✗ → "Washroom".
    • If only a general thing is said ("khana acha nahi tha"), use the general word ("Food"). null ONLY if no thing at all is identifiable.
- "venue_mentioned": the venue name exactly as said for THIS problem (e.g. "Pushpanjali", "AM", "Manaktala"), else null.
- "location": the specific place mentioned (e.g. "Banquet Hall", "Washroom", "Amber Lawn"), else null.
- "original_text": the exact words from the transcript that describe this issue (copy, do not translate).
- "summary": concise professional English for the person who must fix it, naming the item. Maximum two lines (about 30 words). Keep important venue, location, department and event context that was said. No assumptions.
- Text like [guest] or [phone] is a placeholder for removed private data; keep it as is if needed.
- If the transcript contains no operational issue at all, return an empty "issues" list.
Return valid JSON only, in exactly this shape:
{"issues":[{"category":"<one of the names>","item":"..." or null,"venue_mentioned":"..." or null,"description":"...","location":"..." or null,"original_text":"...","summary":"..."}]}`

function issueSchema(categoryNames: string[]) {
  return {
    type: 'object',
    properties: {
      issues: {
        type: 'array',
        maxItems: MAX_ISSUES,
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: categoryNames },
            item: { type: ['string', 'null'] },
            venue_mentioned: { type: ['string', 'null'] },
            description: { type: 'string' },
            location: { type: ['string', 'null'] },
            original_text: { type: 'string' },
            summary: { type: 'string' },
          },
          required: ['category', 'item', 'venue_mentioned', 'description', 'location', 'original_text', 'summary'],
        },
      },
    },
    required: ['issues'],
  }
}

interface ExtractedIssue {
  category: string; item: string | null; venue_mentioned: string | null
  description: string; location: string | null; original_text: string; summary: string
}

class AiError extends Error { retryable: boolean; constructor(m: string, r: boolean) { super(m); this.retryable = r } }

/** Calls Gemini once. Falls back to plain JSON mode if this model rejects the schema field. */
async function callGemini(db: Db, payload: string, categoryNames: string[], submissionId: string, userId: string | null, model: string = GEMINI_MODEL): Promise<{ issues: ExtractedIssue[]; usage: unknown; model: string }> {
  const base = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: payload }] }],
  }
  const configs: Record<string, unknown>[] = [
    { responseMimeType: 'application/json', responseJsonSchema: issueSchema(categoryNames), maxOutputTokens: 4096 },
    { responseMimeType: 'application/json', maxOutputTokens: 4096 },   // fallback: schema is described in the prompt
  ]

  let lastErr: AiError | null = null
  for (const generationConfig of configs) {
    const started = Date.now()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS)
    let status = 0
    let body: Record<string, unknown> = {}
    let netErr: string | null = null
    try {
      const res = await fetch(geminiUrl(model), {
        method: 'POST',
        headers: { 'x-goog-api-key': GEMINI_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, generationConfig }),
        signal: ctrl.signal,
      })
      status = res.status
      body = await res.json().catch(() => ({}))
    } catch (e) {
      netErr = (e as Error).name === 'AbortError' ? 'Gemini timed out' : `Network error: ${(e as Error).message}`
    } finally {
      clearTimeout(timer)
    }

    const errMsg = (body.error as { message?: string; status?: string } | undefined)
    const usage = body.usageMetadata ?? null
    const text = ((body.candidates as { content?: { parts?: { text?: string }[] }; finishReason?: string }[] | undefined)?.[0]
      ?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    const finish = (body.candidates as { finishReason?: string }[] | undefined)?.[0]?.finishReason

    await db.from('api_usage_log').insert({
      provider: 'gemini', operation: 'extract_and_summarize', model,
      ok: !netErr && status === 200 && Boolean(text), http_status: status || null, latency_ms: Date.now() - started,
      // model_version = what Google actually ran (from its reply), next to the model we asked for.
      usage: { ...(usage as object ?? {}), model_version: (body.modelVersion as string) ?? null,
               finish_reason: finish ?? null, schema_mode: 'responseJsonSchema' in generationConfig },
      error: netErr ?? (status !== 200 ? `${errMsg?.status ?? status}: ${errMsg?.message ?? ''}`.slice(0, 500) : null),
      submission_id: submissionId, user_id: userId,
    })

    if (netErr) throw new AiError(netErr, true)
    // This model doesn't know the schema field → try the plain JSON config.
    if (status === 400 && /responseJsonSchema|response_json_schema|Unknown name|Invalid JSON payload/i.test(errMsg?.message ?? '')) {
      lastErr = new AiError(`Gemini rejected the request: ${errMsg?.message ?? ''}`, false)
      continue
    }
    if (status === 429) throw new AiError('Gemini rate limit reached', true)
    if (status === 401 || status === 403) throw new AiError('Gemini key is invalid or not allowed for this model (check GEMINI_API_KEY / GEMINI_MODEL)', false)
    if (status === 404) throw new AiError(`Gemini model "${model}" was not found (check GEMINI_MODEL / GEMINI_FALLBACK_MODEL)`, false)
    if (status >= 500) throw new AiError(`Gemini server error ${status}`, true)
    if (status !== 200) throw new AiError(`Gemini error ${status}: ${errMsg?.message ?? ''}`, false)
    if (!text) throw new AiError(`Gemini returned no text (finish reason: ${finish ?? 'unknown'})`, finish !== 'SAFETY')

    return { issues: validateIssues(text, categoryNames), usage, model }
  }
  throw lastErr ?? new AiError('Gemini request failed', true)
}

/**
 * Gemini with patience: a 503 ("model overloaded"), a 5xx or a timeout often
 * succeeds a few seconds later, so retry twice (after 2 s and 5 s). If it still
 * fails and GEMINI_FALLBACK_MODEL is set, try that model once. Non-temporary
 * errors (bad key, unknown model) are not retried here.
 */
async function callGeminiWithRetry(db: Db, payload: string, categoryNames: string[], submissionId: string, userId: string | null) {
  const waits = [2000, 5000]
  let last: unknown = null
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    try { return await callGemini(db, payload, categoryNames, submissionId, userId, GEMINI_MODEL) } catch (e) {
      last = e
      if (!(e instanceof AiError) || !e.retryable || attempt === waits.length) break
      await new Promise((r) => setTimeout(r, waits[attempt]))
    }
  }
  if (GEMINI_FALLBACK_MODEL && GEMINI_FALLBACK_MODEL !== GEMINI_MODEL && last instanceof AiError && last.retryable) {
    return await callGemini(db, payload, categoryNames, submissionId, userId, GEMINI_FALLBACK_MODEL)
  }
  throw last
}

/** Parses and checks the AI reply. Anything malformed is rejected, not "fixed up" silently. */
// "dal makhani" → "Dal Makhani"; short all-caps words (AC, DJ) stay as they are.
function tidyItem(raw: string): string | null {
  const t = raw.replace(/\s+/g, ' ').replace(/^["'`]+|["'`.]+$/g, '').trim().slice(0, 60)
  if (!t || /^(null|none|n\/a|-)$/i.test(t)) return null
  return t.split(' ').map((w) => (w.length <= 3 && w === w.toUpperCase()) || /[A-Z]/.test(w.slice(1)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function validateIssues(text: string, categoryNames: string[]): ExtractedIssue[] {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  let parsed: unknown
  try { parsed = JSON.parse(cleaned) } catch { throw new AiError('Gemini reply was not valid JSON', true) }
  const list = (parsed as { issues?: unknown }).issues
  if (!Array.isArray(list)) throw new AiError('Gemini reply had no "issues" list', true)
  if (list.length > MAX_ISSUES) throw new AiError('Gemini returned too many issues', true)

  const allowed = new Map(categoryNames.map((n) => [n.toLowerCase(), n]))
  return list.map((raw, i) => {
    const r = raw as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const description = str(r.description)
    const summary = str(r.summary)
    if (!description || !summary) throw new AiError(`Issue ${i + 1} is missing a description or summary`, true)
    if (summary.length > 400) throw new AiError(`Issue ${i + 1} summary is longer than two lines`, true)
    return {
      // Unknown category → "Other" (recorded in extraction JSON for Admin to see).
      category: allowed.get(str(r.category).toLowerCase()) ?? 'Other',
      item: tidyItem(str(r.item)),
      venue_mentioned: str(r.venue_mentioned).slice(0, 80) || null,
      description: description.slice(0, 500),
      location: str(r.location) || null,
      original_text: str(r.original_text).slice(0, 1000),
      summary,
    }
  })
}

// ---------------------------------------------------------------------------
// Privacy: remove guest names and phone numbers before text leaves Supabase
// ---------------------------------------------------------------------------
function redact(text: string, guestNames: (string | null | undefined)[]): string {
  let out = text.replace(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g, '[phone]')
  const tokens = new Set<string>()
  for (const g of guestNames) for (const t of (g ?? '').split(/[^A-Za-z]+/)) if (t.length >= 3) tokens.add(t)
  for (const t of tokens) out = out.replace(new RegExp(`\\b${t}\\b`, 'gi'), '[guest]')
  return out
}

// ---------------------------------------------------------------------------
// Processing one submission
// ---------------------------------------------------------------------------
async function matchEvent(transcript: string, hintDate: string | null = null): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/event-calendar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'match', transcript, hint_date: hintDate }),
    })
    if (!res.ok) return { status: 'calendar_error', reasons: [`Event Calendar error ${res.status}`] }
    return await res.json()
  } catch (e) {
    return { status: 'calendar_error', reasons: [`Event Calendar unreachable: ${(e as Error).message}`] }
  }
}

// ---------------------------------------------------------------------------
// Per-issue venue: what the AI heard ("AM", "Pushpanjali") → our venue id,
// using the same names/aliases the Admin manages. No match → null.
// ---------------------------------------------------------------------------
const NON_WORD = /[^\p{L}\p{M}\p{N}]+/gu
const norm = (t: string) => t.normalize('NFKC').toLowerCase().replace(NON_WORD, ' ').trim()
type VenueRow = { id: string; venue_name: string; aliases: { alias: string }[] }
function resolveVenue(said: string | null, venues: VenueRow[]): string | null {
  if (!said) return null
  const n = norm(said)
  if (!n) return null
  const names = (v: VenueRow) => [v.venue_name, ...v.aliases.map((a) => a.alias)].map(norm)
  const exact = venues.filter((v) => names(v).includes(n))
  if (exact.length === 1) return exact[0].id
  // "Pushpanjali wala lawn" → contains a full (4+ letter) name of exactly one venue
  const partial = venues.filter((v) => names(v).some((x) => x.length >= 4 && (' ' + n + ' ').includes(' ' + x + ' ')))
  return partial.length === 1 ? partial[0].id : null
}

// ---------------------------------------------------------------------------
// Background work: Supabase keeps the function alive for a promise passed to
// EdgeRuntime.waitUntil even after the reply is sent. (Outside that runtime the
// work simply runs unawaited.)
// ---------------------------------------------------------------------------
type EdgeRuntimeLike = { waitUntil(p: Promise<unknown>): void }
function inBackground(p: Promise<unknown>) {
  const rt = (globalThis as unknown as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime
  const safe = p.catch((e) => console.error('background task failed', e))
  if (rt?.waitUntil) rt.waitUntil(safe)
}

// Serious keywords → flag + WhatsApp; then bell + push to every POC.
// A failure here never undoes the saved issues; queued messages are retried by the cron.
async function notifyAfterSave(db: Db, submissionId: string, transcript: string, issues: ExtractedIssue[]) {
  // Flag "serious" first, so the bell/push title says "Serious".
  let seriousKeywords: string[] = []
  try {
    seriousKeywords = await findSeriousKeywords(db, [
      transcript, ...issues.flatMap((it) => [it.item, it.description, it.summary]),
    ])
    if (seriousKeywords.length) {
      await db.from('submissions').update({ is_serious: true, serious_keywords: seriousKeywords }).eq('id', submissionId)
    }
  } catch (e) {
    await db.from('job_errors').insert({ job: 'serious-check', entity_type: 'submission', entity_id: submissionId, message: (e as Error).message.slice(0, 500) })
  }
  if (!issues.length) return
  try {
    // Queueing is quick and is awaited, so the messages are safely in the
    // queue before the recorder gets the answer (the cron sends anything left).
    if (seriousKeywords.length) await queueSeriousWhatsApp(db, submissionId, seriousKeywords)
    await db.rpc('enqueue_new_issue_notifications', { p_submission_id: submissionId })
  } catch (e) {
    await db.from('job_errors').insert({ job: 'notify', entity_type: 'submission', entity_id: submissionId, message: (e as Error).message.slice(0, 500) })
    return
  }
  // The slow part (talking to the push services and WhatsApp) runs after the
  // reply, push and WhatsApp side by side.
  inBackground(Promise.all([
    sendPendingPushes(db, 50),
    seriousKeywords.length ? sendPendingWhatsApp(db, 50) : Promise.resolve(),
  ]).catch((e) => db.from('job_errors').insert({ job: 'notify', entity_type: 'submission', entity_id: submissionId, message: (e as Error).message.slice(0, 500) })))
}

async function processSubmission(db: Db, submissionId: string, actorId: string | null) {
  // Claim the row so two runs (user retry + cron) never process it at once.
  const staleBefore = new Date(Date.now() - 3 * 60_000).toISOString()
  const { data: claimed } = await db.from('submissions')
    .update({ processing_status: 'processing', locked_at: new Date().toISOString() })
    .eq('id', submissionId)
    .in('processing_status', ['submitted', 'processing', 'failed', 'needs_review'])
    .or(`locked_at.is.null,locked_at.lt.${staleBefore}`)
    .select('id, submitted_by, reviewed_transcript, attempt_count, event_match, chosen_calendar_event_id')
    .maybeSingle()
  if (!claimed) return { claimed: false }

  const attempt = (claimed.attempt_count ?? 0) + 1
  try {
    // ---- event + categories + venues: three independent lookups, run together ----
    const [matched, { data: cats }, { data: venueRows }] = await Promise.all([
      matchEvent(claimed.reviewed_transcript),
      db.from('issue_categories').select('id, name, description').eq('is_active', true).order('sort_order'),
      db.from('venues').select('id, venue_name, aliases:venue_aliases(alias)').eq('is_active', true),
    ])
    let match = matched ?? { status: 'calendar_error', reasons: [] }
    // Not certain, but the recorder picked a function on the Record page?
    // Accept it ONLY if it is one of the bookings the matcher found (no invention).
    const chosen = claimed.chosen_calendar_event_id as string | null
    if (match.status !== 'matched' && chosen) {
      if (chosen === 'none') {
        match = { ...match, status: 'none_by_recorder', reasons: ['The recorder said it was none of the bookings found.'] }
      } else {
        const pick = ((match.candidates as Record<string, unknown>[]) ?? []).find((c) => c.calendar_event_id === chosen)
        if (pick) match = { ...match, status: 'matched', event: pick, date: pick.date, chosen_by_recorder: true,
                            reasons: ['Chosen by the recorder from the bookings found for that day.'] }
      }
    }
    const ev = (match.status === 'matched' ? match.event : null) as Record<string, string | null> | null

    // ---- categories ----
    const categories = cats ?? []
    if (!categories.find((c) => c.name === 'Other')) categories.push({ id: null, name: 'Other', description: 'Anything else' })
    const names = categories.map((c) => c.name)

    // ---- AI ----
    if (!GEMINI_KEY) throw new AiError('GEMINI_API_KEY secret is missing', false)
    const guestNames = [ev?.guest_name, ...(((match.candidates as { guest_name?: string }[]) ?? []).map((c) => c.guest_name))]
    const payload = JSON.stringify({
      categories: categories.map((c) => ({ name: c.name, covers: c.description })),
      event_context: ev ? {
        date: ev.date, venue: ev.venue_name, area: ev.sub_venue, function: ev.function_name, shift: ev.shift,
      } : null,
      transcript: redact(claimed.reviewed_transcript, guestNames),
    })
    const { issues, model: usedModel } = await callGeminiWithRetry(db, payload, names, submissionId, actorId ?? claimed.submitted_by)

    // ---- per-issue venue + event ----
    // Each issue gets its own venue. If it names a DIFFERENT venue than the
    // recording's event, that issue gets its own Calendar match (same day).
    const venues = (venueRows ?? []) as VenueRow[]
    const venueName = new Map(venues.map((v) => [v.id, v.venue_name]))
    const mainVenueId = (ev?.venue_id as string) ?? ((match.venue as { id?: string } | null)?.id ?? null)
    const mainDate = (ev?.date as string) ?? (match.date as string | null) ?? null
    const eventInfo = (e: Record<string, unknown>) => ({
      calendar_event_id: e.calendar_event_id, date: e.date, guest_name: e.guest_name,
      function_name: e.function_name, shift: e.shift, sub_venue: e.sub_venue, title: e.title,
    })

    // All issues at once (not one after another), so 3 venues ≠ 3× the wait.
    const perIssue: { venue_id: string | null; event: Record<string, unknown> | null; match_status: string }[] =
      await Promise.all(issues.map(async (it) => {
        const said = resolveVenue(it.venue_mentioned, venues)
        if (!said || said === mainVenueId) {
          return { venue_id: said ?? mainVenueId, event: ev, match_status: String(match.status ?? 'unknown') }
        }
        // Different venue → match this issue on its own words, same day as the recording.
        const m = await matchEvent((it.venue_mentioned ?? '') + ' ' + it.original_text, mainDate)
        const e = (m?.status === 'matched' ? m.event : null) as Record<string, unknown> | null
        return { venue_id: said, event: e, match_status: String(m?.status ?? 'unknown') }
      }))

    // ---- store ----
    const catId = new Map(categories.map((c) => [c.name, c.id]))
    if (issues.length) {
      const { error: insErr } = await db.from('issues').upsert(issues.map((it, i) => ({
        submission_id: submissionId,
        issue_index: i,
        category_id: catId.get(it.category) ?? null,
        category_raw: it.category,
        item: it.item,
        venue_id: perIssue[i].venue_id,
        calendar_event_id: (perIssue[i].event?.calendar_event_id as string) ?? null,
        event_info: perIssue[i].event
          ? { ...eventInfo(perIssue[i].event!), match_status: perIssue[i].match_status }
          : { match_status: perIssue[i].match_status },
        description: it.description,
        location: it.location,
        original_text: it.original_text,
        ai_summary: it.summary,
        summary_status: 'done',
      })), { onConflict: 'submission_id,issue_index', ignoreDuplicates: true })
      if (insErr) throw new Error(`Saving issues failed: ${insErr.message}`)
    }

    const status = issues.length ? 'pending_assignment' : 'needs_review'
    const { error: upErr } = await db.from('submissions').update({
      processing_status: status,
      processing_error: issues.length ? null : 'No clear issue found in the transcript',
      attempt_count: attempt,
      next_attempt_at: null,
      locked_at: null,
      event_match: match,
      event_date: (ev?.date as string) ?? (match.date as string | null) ?? null,
      venue_id: (ev?.venue_id as string) ?? ((match.venue as { id?: string } | null)?.id ?? null),
      calendar_event_id: (ev?.calendar_event_id as string) ?? null,
      guest_name: (ev?.guest_name as string) ?? null,          // from the Calendar only
      function_name: (ev?.function_name as string) ?? null,    // from the Calendar only
      extraction: { model: usedModel, issues, processed_at: new Date().toISOString() },
      // One JSON entry per complaint, in the agreed format (migration 10).
      issue_data: {
        event_date: (ev?.date as string) ?? (match.date as string | null) ?? null,
        venue: (ev?.venue_name as string) ?? ((match.venue as { name?: string } | null)?.name ?? null),
        guest_name: (ev?.guest_name as string) ?? null,
        function_name: (ev?.function_name as string) ?? null,
        issues: issues.map((it, i) => ({
          category: it.category,
          item: it.item,
          venue: perIssue[i].venue_id ? venueName.get(perIssue[i].venue_id!) ?? null : null,
          guest_name: (perIssue[i].event?.guest_name as string) ?? null,
          function_name: (perIssue[i].event?.function_name as string) ?? null,
          description: it.description,
          location: it.location,
          summary: it.summary,
        })),
      },
    }).eq('id', submissionId)
    if (upErr) throw new Error(`Saving submission failed: ${upErr.message}`)

    // Serious check + queueing the POC messages (quick); the actual sending
    // happens in the background, so the screen doesn't wait for pushes/WhatsApp.
    await notifyAfterSave(db, submissionId, claimed.reviewed_transcript, issues)

    return { claimed: true, status, issues, event: match }
  } catch (e) {
    const retryable = e instanceof AiError ? e.retryable : true
    const giveUp = !retryable || attempt >= MAX_ATTEMPTS
    const msg = (e as Error).message
    await db.from('submissions').update({
      processing_status: 'failed',
      processing_error: msg.slice(0, 500),
      attempt_count: attempt,
      // The cron (Phase 9) picks up failed rows whose next_attempt_at has passed.
      next_attempt_at: giveUp ? null : new Date(Date.now() + Math.min(60, 2 ** attempt) * 60_000).toISOString(),
      locked_at: null,
    }).eq('id', submissionId)
    await db.from('job_errors').insert({
      job: 'process-issue', entity_type: 'submission', entity_id: submissionId, message: msg.slice(0, 500),
      details: { attempt, retryable, will_retry: !giveUp },
    })
    return { claimed: true, status: 'failed', error: msg, will_retry: !giveUp }
  }
}

// ---------------------------------------------------------------------------
// Push notifications: send queued jobs to every device of each recipient.
//   • all devices at once (Promise.allSettled), so a slow one can't stall the rest
//   • 404/410 from the push service = device gone → its row is deleted
//   • at least one device reached → sent; none → retried later by the cron
//   • nobody has turned notifications on → marked sent ("no devices")
// ---------------------------------------------------------------------------
// A send that was cut off half-way (e.g. the function was stopped) leaves jobs
// as "processing". After 5 minutes they go back to "pending", so the next run
// (usually the 5-minute cron) sends them.
async function releaseStuck(db: Db, channel: string) {
  const stale = new Date(Date.now() - 5 * 60_000).toISOString()
  await db.from('notification_queue').update({ status: 'pending', locked_at: null })
    .eq('channel', channel).eq('status', 'processing').lt('locked_at', stale)
}

async function sendPendingPushes(db: Db, limit = 100) {
  if (!PUSH_READY) return { skipped: 'VAPID keys not set' }
  const now = new Date().toISOString()
  await releaseStuck(db, 'push')
  const { data: due } = await db.from('notification_queue').select('id')
    .eq('channel', 'push').in('status', ['pending', 'failed']).lte('next_attempt_at', now)
    .order('created_at').limit(limit)
  if (!due?.length) return { sent: 0 }

  // Claim them, so a parallel run can't send the same job twice.
  const { data: jobs } = await db.from('notification_queue')
    .update({ status: 'processing', locked_at: now })
    .in('id', due.map((d) => d.id)).in('status', ['pending', 'failed'])
    .select('id, recipient_user_id, payload, retry_count, max_retries')
  let sent = 0, failed = 0, removed = 0
  for (const job of jobs ?? []) {
    const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', job.recipient_user_id)
    if (!subs?.length) {
      await db.from('notification_queue').update({ status: 'sent', processed_at: now, last_error: 'no devices', locked_at: null }).eq('id', job.id)
      continue
    }
    const body = JSON.stringify(job.payload)
    const results = await Promise.allSettled(subs.map((sub) =>
      webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body,
        { TTL: 6 * 3600, urgency: 'high', topic: String((job.payload as { tag?: string }).tag ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined })))
    let delivered = 0
    const errors: string[] = []
    for (const [i, r] of results.entries()) {
      if (r.status === 'fulfilled') {
        delivered++
        await db.from('push_subscriptions').update({ last_used_at: now, failures: 0 }).eq('id', subs[i].id)
      } else {
        const code = (r.reason as { statusCode?: number })?.statusCode
        errors.push(`${code ?? 'error'}: ${String((r.reason as { body?: string })?.body ?? (r.reason as Error)?.message ?? '').slice(0, 120)}`)
        if (code === 404 || code === 410) { await db.from('push_subscriptions').delete().eq('id', subs[i].id); removed++ }
      }
    }
    if (delivered > 0) {
      sent++
      await db.from('notification_queue').update({ status: 'sent', processed_at: now, locked_at: null, last_error: errors.join(' | ') || null }).eq('id', job.id)
    } else {
      failed++
      const retry = (job.retry_count ?? 0) + 1
      await db.from('notification_queue').update({
        status: 'failed', retry_count: retry, locked_at: null, last_error: errors.join(' | ').slice(0, 500),
        next_attempt_at: new Date(Date.now() + Math.min(60, 2 ** retry) * 60_000).toISOString(),
        // give up after max_retries: push it far into the future so the cron stops picking it
        ...(retry >= (job.max_retries ?? 5) ? { next_attempt_at: '9999-12-31T00:00:00Z' } : {}),
      }).eq('id', job.id)
    }
  }
  return { sent, failed, removed_devices: removed }
}

// ---------------------------------------------------------------------------
// Serious complaints: Admin-managed keywords (alert_keywords).
// Whole-word match on lower-cased text, so "aag" does not match "aage".
// Works for Hindi script too (letters and vowel signs are kept).
// ---------------------------------------------------------------------------
const padNorm = (t: string) => ' ' + t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim() + ' '

async function findSeriousKeywords(db: Db, texts: (string | null | undefined)[]): Promise<string[]> {
  const { data } = await db.from('alert_keywords').select('keyword, keyword_normalized')
  if (!data?.length) return []
  const hay = padNorm(texts.filter(Boolean).join(' \n '))
  return data.filter((k) => {
    const kw = padNorm(k.keyword_normalized as string).trim()
    return kw && hay.includes(' ' + kw + ' ')
  }).map((k) => k.keyword as string)
}

/** "9876543210" / "+91 98765 43210" → "919876543210" (Indian mobiles); null if unusable. */
function waNumber(raw: string | null | undefined): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10 && /^[6-9]/.test(d)) return '91' + d
  if (d.length === 12 && d.startsWith('91')) return d
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1)
  return null
}

async function whapiSend(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!WHAPI_TOKEN) return { ok: false, error: 'WHAPI_API_TOKEN secret is missing' }
  try {
    const res = await fetch('https://gate.whapi.cloud/messages/text', {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHAPI_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: to.includes('@') ? to : to + '@s.whatsapp.net', body }),
    })
    if (res.ok) return { ok: true }
    return { ok: false, error: `Whapi ${res.status}: ${(await res.text()).slice(0, 200)}` }
  } catch (e) {
    return { ok: false, error: `Whapi unreachable: ${(e as Error).message}` }
  }
}

/** Builds the WhatsApp text for one serious recording and queues it for every POC. */
async function queueSeriousWhatsApp(db: Db, submissionId: string, keywords: string[]) {
  const { data: sub } = await db.from('submissions')
    .select('id, submitted_by, created_at, guest_name, function_name, venue:venues(venue_name), recorder:app_users!submissions_submitted_by_fkey(name)')
    .eq('id', submissionId).maybeSingle()
  if (!sub) return 0
  const { data: issues } = await db.from('issues')
    .select('issue_index, category_raw, item, ai_summary, venue:venues(venue_name)')
    .eq('submission_id', submissionId).order('issue_index')

  const venueNames = [...new Set([(sub.venue as { venue_name?: string } | null)?.venue_name,
    ...(issues ?? []).map((i) => (i.venue as { venue_name?: string } | null)?.venue_name)].filter(Boolean))]
  const when = new Date(sub.created_at as string).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  const lines = [
    `🚨 *Serious issue*${venueNames.length ? ' — ' + venueNames.join(', ') : ''}`,
    [sub.guest_name, sub.function_name].filter(Boolean).join(' · ') || null,
    `Keyword: ${keywords.join(', ')}`,
    '',
    ...(issues ?? []).map((i, n) => `${n + 1}. *${i.category_raw ?? 'Other'}*${i.item ? ' · ' + i.item : ''}: ${i.ai_summary ?? ''}`),
    '',
    `Recorded by ${(sub.recorder as { name?: string } | null)?.name ?? 'staff'} · ${when}`,
    APP_URL ? `Open: ${APP_URL}issues` : null,
  ].filter((l) => l !== null) as string[]
  const body = lines.join('\n')

  const { data: pocs } = await db.from('app_users').select('id, mobile_number')
    .eq('is_active', true).contains('roles', ['poc']).neq('id', sub.submitted_by)
  let queued = 0
  for (const u of pocs ?? []) {
    const to = waNumber(u.mobile_number)
    if (!to) continue                       // no usable mobile number: listed on the Serious alerts page
    const { error } = await db.from('notification_queue').upsert({
      recipient_user_id: u.id, channel: 'whatsapp', notification_type: 'serious_issue',
      payload: { to, body }, dedupe_key: `serious:${submissionId}:${u.id}:whatsapp`,
    }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    if (!error) queued++
  }
  return queued
}

/** Sends queued WhatsApp jobs, one second apart (like Aria). Failures retry via the cron. */
async function sendPendingWhatsApp(db: Db, limit = 50) {
  if (!WHAPI_TOKEN) return { skipped: 'WHAPI_API_TOKEN not set' }
  const now = new Date().toISOString()
  await releaseStuck(db, 'whatsapp')
  const { data: due } = await db.from('notification_queue').select('id')
    .eq('channel', 'whatsapp').in('status', ['pending', 'failed']).lte('next_attempt_at', now)
    .order('created_at').limit(limit)
  if (!due?.length) return { sent: 0 }
  const { data: jobs } = await db.from('notification_queue')
    .update({ status: 'processing', locked_at: now })
    .in('id', due.map((d) => d.id)).in('status', ['pending', 'failed'])
    .select('id, payload, retry_count, max_retries')
  let sent = 0, failed = 0
  for (const job of jobs ?? []) {
    const { to, body } = job.payload as { to: string; body: string }
    const r = await whapiSend(to, body)
    if (r.ok) {
      sent++
      await db.from('notification_queue').update({ status: 'sent', processed_at: new Date().toISOString(), locked_at: null, last_error: null }).eq('id', job.id)
    } else {
      failed++
      const retry = (job.retry_count ?? 0) + 1
      await db.from('notification_queue').update({
        status: 'failed', retry_count: retry, locked_at: null, last_error: r.error?.slice(0, 500),
        next_attempt_at: retry >= (job.max_retries ?? 5) ? '9999-12-31T00:00:00Z'
          : new Date(Date.now() + Math.min(30, 2 ** retry) * 60_000).toISOString(),
      }).eq('id', job.id)
    }
    await new Promise((res) => setTimeout(res, 1000))
  }
  return { sent, failed }
}

// ---------------------------------------------------------------------------
// The 5-minute background run (called by Supabase Cron, migration 14)
// ---------------------------------------------------------------------------
async function runCron(db: Db) {
  const { data: runId } = await db.rpc('job_start', { p_job: 'issue-desk-cron' })
  if (!runId) return { skipped: true, reason: 'previous run still going' }

  const started = Date.now()
  const stats: Record<string, unknown> = { retried: 0, retried_ok: 0, audio_deleted: 0 }
  let ok = true
  try {
    // 1. Retry: failed recordings whose retry time has come, and ones stuck in
    //    "submitted"/"processing" for more than 3 minutes.
    const now = new Date().toISOString()
    const stuckBefore = new Date(Date.now() - 3 * 60_000).toISOString()
    const { data: due } = await db.from('submissions').select('id')
      .or(`and(processing_status.eq.failed,next_attempt_at.lte.${now}),and(processing_status.in.(submitted,processing),created_at.lt.${stuckBefore})`)
      .order('created_at').limit(CRON_RETRIES_PER_RUN)
    for (const row of due ?? []) {
      if (Date.now() - started > CRON_TIME_BUDGET_MS) break
      const r = await processSubmission(db, row.id, null)
      stats.retried = (stats.retried as number) + (r.claimed ? 1 : 0)
      if (r.claimed && r.status !== 'failed') stats.retried_ok = (stats.retried_ok as number) + 1
    }

    // 2. Delete recordings past their retention date.
    const { data: expired } = await db.from('submissions').select('id, audio_path')
      .lt('audio_expires_at', new Date().toISOString()).is('audio_deleted_at', null).not('audio_path', 'is', null).limit(100)
    if (expired?.length) {
      const { error: rmErr } = await db.storage.from('recordings').remove(expired.map((e) => e.audio_path as string))
      if (rmErr) throw new Error(`Audio cleanup failed: ${rmErr.message}`)
      await db.from('submissions').update({ audio_deleted_at: new Date().toISOString() }).in('id', expired.map((e) => e.id))
      stats.audio_deleted = expired.length
    }

    // 3. Push notifications that could not be delivered earlier.
    stats.push = await sendPendingPushes(db, 200)
    stats.whatsapp = await sendPendingWhatsApp(db, 50)

    // 4. Old technical rows.
    const { data: cleaned } = await db.rpc('maintenance_cleanup')
    stats.cleanup = cleaned ?? null
  } catch (e) {
    ok = false
    stats.error = (e as Error).message
    await db.from('job_errors').insert({ job: 'cron', message: (e as Error).message.slice(0, 500), details: stats })
  }
  stats.duration_ms = Date.now() - started
  await db.rpc('job_finish', { p_id: runId, p_ok: ok, p_stats: stats })
  return { ok, ...stats }
}

// ---------------------------------------------------------------------------
// Same complaint twice? Word overlap (Jaccard) between two transcripts.
// 0.75+ = almost the same words. Used only to WARN; the user decides.
// ---------------------------------------------------------------------------
const DUP_WINDOW_HOURS = 2
const DUP_THRESHOLD = 0.75
function wordSet(t: string): Set<string> {
  return new Set(t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length > 1))
}
function similarity(a: string, b: string): number {
  const A = wordSet(a), B = wordSet(b)
  if (!A.size || !B.size) return 0
  let common = 0
  for (const w of A) if (B.has(w)) common++
  return common / (A.size + B.size - common)
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return reply(origin, 405, { error: 'Method not allowed' })

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  // ---- cron (Supabase Cron, every 5 minutes) ----------------------------------
  const cronHeader = req.headers.get('x-cron-secret')
  if (cronHeader !== null) {
    if (!CRON_SECRET || cronHeader !== CRON_SECRET) return reply(origin, 401, { error: 'Bad cron secret.' })
    return reply(origin, 200, await runCron(db))
  }

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  // roles = every role the user has (migration 11).
  let me: { id: string | null; roles: string[]; is_active: boolean } | null = null
  if (token && token === SERVICE_KEY) me = { id: null, roles: ['system'], is_active: true }
  else {
    const { data: caller } = await db.auth.getUser(token)
    if (!caller?.user) return reply(origin, 401, { error: 'Please sign in again.' })
    const { data: row } = await db.from('app_users').select('id, role, roles, is_active').eq('id', caller.user.id).maybeSingle()
    me = row ? { id: row.id, roles: row.roles ?? [row.role], is_active: row.is_active } : null
  }
  if (!me?.is_active) return reply(origin, 403, { error: 'Not allowed.' })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return reply(origin, 400, { error: 'Invalid request.' }) }

  // ---- submit (Recording User / Admin) --------------------------------------
  if (body.action === 'submit') {
    if (!me.roles.some((r) => r === 'recorder' || r === 'admin') || !me.id) return reply(origin, 403, { error: 'You are not allowed to submit issues.' })
    const clientId = String(body.client_submission_id ?? '')
    const transcript = String(body.reviewed_transcript ?? '').trim()
    if (!UUID_RE.test(clientId)) return reply(origin, 400, { error: 'Invalid submission id.' })
    if (!transcript) return reply(origin, 400, { error: 'The transcript is empty.' })
    if (transcript.length > 5000) return reply(origin, 400, { error: 'The transcript is too long.' })
    const audioPath = body.audio_path ? String(body.audio_path) : null
    if (audioPath && !audioPath.startsWith(`${me.id}/`)) return reply(origin, 400, { error: 'Invalid audio path.' })

    // Idempotent: the same client_submission_id always maps to the same row.
    // The three lookups below don't depend on each other → one round trip.
    const since = new Date(Date.now() - DUP_WINDOW_HOURS * 3600_000).toISOString()
    const [{ data: existing }, { data: recent }, { data: retention }] = await Promise.all([
      db.from('submissions').select('id, submitted_by, processing_status').eq('client_submission_id', clientId).maybeSingle(),
      db.from('submissions').select('id, created_at, reviewed_transcript, processing_status')
        .eq('submitted_by', me.id).gte('created_at', since).order('created_at', { ascending: false }).limit(20),
      db.from('app_settings').select('value').eq('key', 'audio_retention_days').maybeSingle(),
    ])
    let sub = existing
    if (sub && sub.submitted_by !== me.id) return reply(origin, 403, { error: 'Not allowed.' })
    if (!sub && body.allow_duplicate !== true) {
      // Staff sometimes record the same complaint again (e.g. after a slow
      // network). Before creating a NEW submission, look for an almost
      // identical one from the same person in the last 2 hours.
      const twin = (recent ?? []).find((r) => similarity(r.reviewed_transcript, transcript) >= DUP_THRESHOLD)
      if (twin) {
        const { data: twinIssues } = await db.from('issues').select('category_raw, item, ai_summary').eq('submission_id', twin.id).order('issue_index')
        return reply(origin, 409, {
          error: 'This looks like a complaint you already sent.',
          duplicate_of: { submission_id: twin.id, created_at: twin.created_at, status: twin.processing_status, issues: twinIssues ?? [] },
        })
      }
    }
    if (!sub) {
      const days = Number(retention?.value ?? 30)
      const { data: created, error } = await db.from('submissions').insert({
        client_submission_id: clientId,
        submitted_by: me.id,
        reviewed_transcript: transcript,
        raw_transcript: body.raw_transcript ? String(body.raw_transcript).slice(0, 5000) : null,
        transcription_meta: typeof body.transcription_meta === 'object' && body.transcription_meta ? body.transcription_meta : {},
        audio_path: audioPath,
        audio_mime: body.audio_mime ? String(body.audio_mime).slice(0, 50) : null,
        // The function the recorder picked when the app wasn't sure ('none' = none of them).
        chosen_calendar_event_id: typeof body.chosen_calendar_event_id === 'string' ? body.chosen_calendar_event_id.slice(0, 64) : null,
        audio_duration_sec: Number(body.audio_duration_sec) || null,
        audio_expires_at: audioPath ? new Date(Date.now() + days * 86400_000).toISOString() : null,
        processing_status: 'submitted',
      }).select('id, submitted_by, processing_status').single()
      if (error?.code === '23505') {
        // Two taps at the same moment: the other request created it.
        sub = (await db.from('submissions').select('id, submitted_by, processing_status').eq('client_submission_id', clientId).single()).data
      } else if (error || !created) {
        console.error('insert submission failed', error)
        return reply(origin, 500, { error: 'Could not save your submission. Please retry.', retryable: true })
      } else sub = created
    }

    // Already processed earlier → just report it.
    if (sub && ['pending_assignment', 'assigned', 'needs_review'].includes(sub.processing_status)) {
      const { data: issues } = await db.from('issues').select('category_raw, item, description, ai_summary, location, event_info, venue:venues(venue_name)').eq('submission_id', sub.id).order('issue_index')
      return reply(origin, 200, { submission_id: sub.id, status: sub.processing_status, issues: issues ?? [], already_submitted: true })
    }

    const result = await processSubmission(db, sub!.id, me.id)
    const { data: issues } = await db.from('issues').select('category_raw, item, description, ai_summary, location, event_info, venue:venues(venue_name)').eq('submission_id', sub!.id).order('issue_index')
    return reply(origin, 200, {
      submission_id: sub!.id,
      status: result.claimed ? result.status : 'processing',
      issues: issues ?? [],
      event: (result as { event?: unknown }).event ?? null,
      error: (result as { error?: string }).error ?? null,
      will_retry: (result as { will_retry?: boolean }).will_retry ?? false,
    })
  }

  // ---- WhatsApp test (Admin): checks the Whapi token and the number ---------
  if (body.action === 'whatsapp_test') {
    if (!me.roles.includes('admin')) return reply(origin, 403, { error: 'Only an admin can do this.' })
    const to = waNumber(String(body.to ?? ''))
    if (!to) return reply(origin, 400, { error: 'Enter a valid 10-digit Indian mobile number.' })
    const r = await whapiSend(to, '✅ Test from Ambria food review: serious-issue alerts will arrive on this number.')
    return reply(origin, r.ok ? 200 : 502, r.ok ? { ok: true } : { error: r.error })
  }

  // ---- retry (Admin / system) -----------------------------------------------
  if (body.action === 'retry') {
    if (!me.roles.some((r) => r === 'admin' || r === 'system')) return reply(origin, 403, { error: 'Only an admin can retry.' })
    const id = String(body.submission_id ?? '')
    if (!UUID_RE.test(id)) return reply(origin, 400, { error: 'Invalid submission id.' })
    const result = await processSubmission(db, id, me.id)
    return reply(origin, 200, result)
  }

  return reply(origin, 400, { error: 'Unknown action.' })
})
