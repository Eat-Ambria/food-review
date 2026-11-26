// Server function that turns a submitted recording into separate issues with summaries, and sends the notifications.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite'

const GEMINI_FALLBACK_MODEL = Deno.env.get('GEMINI_FALLBACK_MODEL') || ''
const geminiUrl = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
const GEMINI_TIMEOUT_MS = 25_000
const MAX_ATTEMPTS = 12
const MAX_ISSUES = 10
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''

function cleanSubject(raw: string): string {
  let s = raw.trim().replace(/^["'<]+|["'>]+$/g, '')
  if (!/^https:\/\//i.test(s)) {
    s = s.replace(/^mail\s*to\s*:?\s*/i, '').replace(/\s+/g, '')
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s)) s = 'mailto:' + s
  }
  const okMail = /^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s) && !/\.local$/i.test(s)
  const okUrl = /^https:\/\/[^\s]+$/i.test(s)
  return okMail || okUrl ? s : SUPABASE_URL
}
const VAPID_SUBJECT = cleanSubject(Deno.env.get('VAPID_SUBJECT') ?? '')
const PUSH_READY = Boolean(VAPID_PUBLIC && VAPID_PRIVATE)

const WHAPI_TOKEN = Deno.env.get('WHAPI_API_TOKEN') ?? ''
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/?$/, '/')
if (PUSH_READY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
const CRON_RETRIES_PER_RUN = 20
const CALENDAR_DOWN = 'The Event Calendar could not be reached.'
const CRON_TIME_BUDGET_MS = 90_000

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

const SYSTEM_PROMPT = `You are an event operations issue extraction and summarization assistant for a banquet and events company in India.
You receive a complaint transcript recorded by staff. It may be Hindi, English or Hinglish (Hindi words in Devanagari, English words in Latin).
The company is called "Ambria" (venues like "Ambria Pushpanjali"). Speech-to-text often mishears it as "Embrya", "Embria", "Ambriya",
"एम्ब्रिया" or "अम्ब्रिया": always write it as "Ambria" in English fields.

Your task: find every SEPARATE operational issue in the transcript and return them as JSON.

Rules:
- One entry per distinct problem. Do not merge separate issues. Do not split one issue into many.
- The SAME dish or item can have SEVERAL problems: each problem is its own entry
  (e.g. "dal makhani thandi thi aur namak zyada tha" = two entries, both with item "Dal Makhani").
- Problems at DIFFERENT venues are always separate entries, even for the same dish.
- Never invent or assume details that are not in the transcript. If something (like location) is not said, use null.
- "category" MUST be exactly one of the category names provided. Use "Other" if none fits.
- Anything about a DRINK (tea, coffee, mocktail, juice, water, soft drink, ice, bar), including its taste, smell,
  temperature, quality or something found in it, goes to "Beverage", never "Kitchen". "Kitchen" is only for food.
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
- "menu_dishes_mentioned" lists dishes from OUR MENU that were said (staff may say them a little differently, e.g. "gold coin" = "Golden Coin").
  These are FOOD or DRINKS, never venues, halls, people or objects. Use the menu name as "item", and use "Kitchen" for food
  or "Beverage" for drinks (sections like Mocktails, Shakes, Juices, Aerated Drinks, Tea, Coffee), unless the problem is clearly about something else.
- "venue_mentioned": the venue name exactly as said for THIS problem (e.g. "Pushpanjali", "AM", "Manaktala"), else null. Never a dish name.
- "location": the specific place mentioned (e.g. "Banquet Hall", "Washroom", "Amber Lawn"), else null.
- "original_text": the exact words from the transcript that describe this issue (copy, do not translate).
- "food_safety": true ONLY when the problem is about food or drink being unsafe or unfit to eat: something found in it
  (hair, insect, glass, stone, plastic), stale, spoiled, smelly or undercooked food, fungus, or people falling ill
  (vomiting, food poisoning, allergy). false for everything else, including venue or hall names that contain such words
  ("Glass House" is a venue, not glass in food), broken glassware or decor, washroom or room smells, AC, service and delays.
- "summary": concise professional English for the person who must fix it, naming the item. Maximum two lines (about 30 words). Keep important venue, location, department and event context that was said. No assumptions.
- Text like [guest] or [phone] is a placeholder for removed private data; keep it as is if needed.
- If the transcript contains no operational issue at all, return an empty "issues" list.
- Praise is NOT an issue (e.g. "chhole bahut achhe the", "service was great"). Put each praise in "compliments" instead:
  "item" (what was praised, Title Case, or null), "venue_mentioned" (or null), "original_text" (exact words) and
  "summary" (one short English sentence, e.g. "Guests liked the Chole."). Return an empty "compliments" list if there is none.
Return valid JSON only, in exactly this shape:
{"issues":[{"category":"<one of the names>","item":"..." or null,"venue_mentioned":"..." or null,"description":"...","location":"..." or null,"original_text":"...","food_safety":true or false,"summary":"..."}],
 "compliments":[{"item":"..." or null,"venue_mentioned":"..." or null,"original_text":"...","summary":"..."}]}`

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
            food_safety: { type: 'boolean' },
            summary: { type: 'string' },
          },
          required: ['category', 'item', 'venue_mentioned', 'description', 'location', 'original_text', 'food_safety', 'summary'],
        },
      },
      compliments: {
        type: 'array',
        maxItems: MAX_ISSUES,
        items: {
          type: 'object',
          properties: {
            item: { type: ['string', 'null'] },
            venue_mentioned: { type: ['string', 'null'] },
            original_text: { type: 'string' },
            summary: { type: 'string' },
          },
          required: ['item', 'venue_mentioned', 'original_text', 'summary'],
        },
      },
    },
    required: ['issues', 'compliments'],
  }
}

interface ExtractedIssue {
  category: string; item: string | null; venue_mentioned: string | null
  description: string; location: string | null; original_text: string; summary: string; food_safety: boolean
}

class AiError extends Error { retryable: boolean; constructor(m: string, r: boolean) { super(m); this.retryable = r } }

async function callGemini(db: Db, payload: string, categoryNames: string[], submissionId: string, userId: string | null, model: string = GEMINI_MODEL): Promise<{ issues: ExtractedIssue[]; compliments: Compliment[]; usage: unknown; model: string }> {
  const base = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: payload }] }],
  }
  const configs: Record<string, unknown>[] = [
    { responseMimeType: 'application/json', responseJsonSchema: issueSchema(categoryNames), maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'low' } },
    { responseMimeType: 'application/json', responseJsonSchema: issueSchema(categoryNames), maxOutputTokens: 4096 },
    { responseMimeType: 'application/json', maxOutputTokens: 4096 },
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

    inBackground(db.from('api_usage_log').insert({
      provider: 'gemini', operation: 'extract_and_summarize', model,
      ok: !netErr && status === 200 && Boolean(text), http_status: status || null, latency_ms: Date.now() - started,

      usage: { ...(usage as object ?? {}), model_version: (body.modelVersion as string) ?? null,
               finish_reason: finish ?? null, schema_mode: 'responseJsonSchema' in generationConfig, thinking_low: 'thinkingConfig' in generationConfig },
      error: netErr ?? (status !== 200 ? `${errMsg?.status ?? status}: ${errMsg?.message ?? ''}`.slice(0, 500) : null),
      submission_id: submissionId, user_id: userId,
    }).then(() => { }))

    if (netErr) throw new AiError(netErr, true)

    if (status === 400 && /responseJsonSchema|response_json_schema|thinking|Unknown name|Invalid JSON payload/i.test(errMsg?.message ?? '')) {
      lastErr = new AiError(`Gemini rejected the request: ${errMsg?.message ?? ''}`, false)
      continue
    }
    if (status === 429) throw new AiError('Gemini rate limit reached', true)
    if (status === 401 || status === 403) throw new AiError('Gemini key is invalid or not allowed for this model (check GEMINI_API_KEY / GEMINI_MODEL)', false)
    if (status === 404) throw new AiError(`Gemini model "${model}" was not found (check GEMINI_MODEL / GEMINI_FALLBACK_MODEL)`, false)
    if (status >= 500) throw new AiError(`Gemini server error ${status}`, true)
    if (status !== 200) throw new AiError(`Gemini error ${status}: ${errMsg?.message ?? ''}`, false)
    if (!text) throw new AiError(`Gemini returned no text (finish reason: ${finish ?? 'unknown'})`, finish !== 'SAFETY')

    return { issues: validateIssues(text, categoryNames), compliments: readCompliments(text), usage, model }
  }
  throw lastErr ?? new AiError('Gemini request failed', true)
}

async function callGeminiWithRetry(db: Db, payload: string, categoryNames: string[], submissionId: string, userId: string | null) {
  const waits = [2000, 5000]
  let last: unknown = null
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    try { return await callGemini(db, payload, categoryNames, submissionId, userId, GEMINI_MODEL) } catch (e) {
      last = e
      if (!(e instanceof AiError) || !e.retryable || attempt === waits.length) break
      await new Promise((r) => setTimeout(r, waits[attempt] * (0.6 + Math.random() * 0.8)))
    }
  }
  if (GEMINI_FALLBACK_MODEL && GEMINI_FALLBACK_MODEL !== GEMINI_MODEL && last instanceof AiError && last.retryable) {
    return await callGemini(db, payload, categoryNames, submissionId, userId, GEMINI_FALLBACK_MODEL)
  }
  throw last
}

const BRAND_RE = /\b[ae]mb(?:e)?r[iy]{1,2}a\b|एम्ब्रिया|अम्ब्रिया|एंब्रिया|अंब्रिया/gi
const fixBrand = (t: string) => t.replace(BRAND_RE, 'Ambria')

interface Compliment { item: string | null; venue_mentioned: string | null; original_text: string; summary: string }

function readCompliments(text: string): Compliment[] {
  try {
    const list = (JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')) as { compliments?: unknown }).compliments
    if (!Array.isArray(list)) return []
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    return list.slice(0, MAX_ISSUES).map((raw) => {
      const r = raw as Record<string, unknown>
      return {
        item: tidyItem(str(r.item)),
        venue_mentioned: fixBrand(str(r.venue_mentioned)).slice(0, 80) || null,
        original_text: str(r.original_text).slice(0, 1000),
        summary: fixBrand(str(r.summary)).slice(0, 400),
      }
    }).filter((c) => c.summary)
  } catch { return [] }
}

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
  const allowed = new Map(categoryNames.map((n) => [n.toLowerCase(), n]))
  return list.slice(0, MAX_ISSUES).map((raw, i) => {
    const r = raw as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const description = str(r.description)
    const summary = str(r.summary).slice(0, 400)
    if (!description || !summary) throw new AiError(`Issue ${i + 1} is missing a description or summary`, true)
    return {

      category: allowed.get(str(r.category).toLowerCase()) ?? 'Other',
      item: tidyItem(str(r.item)),
      venue_mentioned: fixBrand(str(r.venue_mentioned)).slice(0, 80) || null,
      description: fixBrand(description).slice(0, 500),
      location: fixBrand(str(r.location)) || null,
      original_text: str(r.original_text).slice(0, 1000),
      summary: fixBrand(summary),
      food_safety: r.food_safety !== false,
    }
  })
}

const NOT_A_NAME = new Set(['and', 'the', 'mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'smt', 'ji', 'family', 'party', 'birthday', 'wedding',
  'reception', 'engagement', 'anniversary', 'function', 'event', 'golden', 'silver', 'with', 'from', 'wala', 'wale', 'group', 'team', 'ltd',
  'dal', 'veg', 'pav', 'tea', 'ice', 'hot', 'red', 'new', 'old', 'mrs'])
function redact(text: string, guestNames: (string | null | undefined)[]): string {
  let out = text.replace(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g, '[phone]')
  const tokens = new Set<string>()
  for (const g of guestNames) for (const t of (g ?? '').split(/[^A-Za-z]+/)) if (t.length >= 3 && !NOT_A_NAME.has(t.toLowerCase())) tokens.add(t)
  for (const t of tokens) out = out.replace(new RegExp(`\\b${t}\\b`, 'gi'), '[guest]')
  return out
}

async function matchEvent(transcript: string, hintDate: string | null = null, recordedAt: string | null = null): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/event-calendar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'match', transcript, hint_date: hintDate, recorded_at: recordedAt }),
    })
    if (!res.ok) return { status: 'calendar_error', reasons: [`Event Calendar error ${res.status}`] }
    return await res.json()
  } catch (e) {
    return { status: 'calendar_error', reasons: [`Event Calendar unreachable: ${(e as Error).message}`] }
  }
}

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

  const brand = new Set(['ambria', 'embrya', 'embria', 'ambriya'])
  const hit = (v: VenueRow, skipBrand: boolean) => names(v).some((x) => x.length >= 4 && !(skipBrand && brand.has(x)) && (' ' + n + ' ').includes(' ' + x + ' '))
  const partial = venues.filter((v) => hit(v, false))
  if (partial.length === 1) return partial[0].id
  const specific = venues.filter((v) => hit(v, true))
  return specific.length === 1 ? specific[0].id : null
}

interface DishRow { name: string; name_hi: string | null; section: string | null }
interface DishEntry { dish: DishRow; forms: string[][] }

const WORD = /[\p{L}\p{M}\p{N}]+/gu
const dishWords = (t: string) => [...t.normalize('NFKC').toLowerCase().matchAll(WORD)].map((m) => m[0])

function dishEntries(rows: DishRow[]): DishEntry[] {
  return rows.map((dish) => {
    const forms = new Map<string, string[]>()
    for (const raw of [dish.name, dish.name_hi]) {
      if (!raw) continue
      for (const v of [raw, raw.split('(')[0]]) {
        const w = dishWords(v)
        if (w.length && w.join(' ').length >= 3) forms.set(w.join(' '), w)
      }
    }
    return { dish, forms: [...forms.values()] }
  })
}

const same = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)))

function findDishes(text: string, entries: DishEntry[]): { dishes: DishRow[]; stripped: string; words: Set<string> } {
  const norm = text.normalize('NFKC')
  const toks = [...norm.matchAll(WORD)].map((m) => ({ w: m[0].toLowerCase(), start: m.index!, end: m.index! + m[0].length }))
  const hits = new Map<string, DishRow>()
  const ranges: [number, number][] = []
  const matched = new Set<string>()
  for (const { dish, forms } of entries) {
    for (const f of forms) {
      if (f.length === 1) {
        if (toks.some((t) => t.w === f[0])) hits.set(dish.name, dish)
        continue
      }
      for (let i = 0; i + f.length <= toks.length; i++) {
        if (f.every((w, k) => same(w, toks[i + k].w))) {
          hits.set(dish.name, dish)
          ranges.push([toks[i].start, toks[i + f.length - 1].end])
          for (let k = 0; k < f.length; k++) matched.add(toks[i + k].w)
        }
      }
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  let stripped = ''
  let pos = 0
  for (const [s, e] of ranges) {
    if (e <= pos) continue
    stripped += norm.slice(pos, Math.max(pos, s)) + ' '
    pos = e
  }
  stripped += norm.slice(pos)
  return { dishes: [...hits.values()], stripped: stripped.replace(/\s{2,}/g, ' ').trim(), words: matched }
}

function isDishWord(said: string | null | undefined, matched: Set<string>): boolean {
  const w = dishWords(said ?? '')
  return w.length > 0 && w.every((x) => matched.has(x) || [...matched].some((d) => same(d, x)))
}

let dishCache: { at: number; list: DishEntry[] } | null = null
async function loadDishes(db: Db): Promise<DishEntry[]> {
  if (dishCache && Date.now() - dishCache.at < 5 * 60_000) return dishCache.list
  const { data, error } = await db.from('dishes').select('name, name_hi, section').eq('is_active', true).limit(5000)
  if (error) return dishCache?.list ?? []
  dishCache = { at: Date.now(), list: dishEntries((data ?? []) as DishRow[]) }
  return dishCache.list
}

type EdgeRuntimeLike = { waitUntil(p: Promise<unknown>): void }
function inBackground(p: Promise<unknown>) {
  const rt = (globalThis as unknown as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime
  const safe = p.catch((e) => console.error('background task failed', e))
  if (rt?.waitUntil) rt.waitUntil(safe)
}

async function notifyAfterSave(db: Db, submissionId: string, issues: ExtractedIssue[]) {

  let seriousKeywords: string[] = []
  const seriousIdx: number[] = []
  try {
    const [menu, match] = await Promise.all([loadDishes(db), loadSeriousMatcher(db)])
    const all = new Set<string>()
    const perIssue = issues.map((it, i) => {
      const kws = it.food_safety
        ? match([it.item, it.description, it.summary, it.original_text].map((t) => (t ? findDishes(t, menu).stripped : t)))
        : []
      if (kws.length) { seriousIdx.push(i); kws.forEach((k) => all.add(k)) }
      return kws
    })
    seriousKeywords = [...all]
    await db.from('submissions').update({ is_serious: seriousKeywords.length > 0, serious_keywords: seriousKeywords.length ? seriousKeywords : null }).eq('id', submissionId)
    const failedFlags = (await Promise.all(perIssue.map((kws, i) => db.from('issues')
      .update({ is_serious: kws.length > 0, serious_keywords: kws.length ? kws : null })
      .eq('submission_id', submissionId).eq('issue_index', i)))).filter((r) => r.error)
    if (failedFlags.length) {
      await db.from('job_errors').insert({ job: 'serious-check', entity_type: 'submission', entity_id: submissionId, message: `Saving serious flag failed: ${failedFlags[0].error!.message}`.slice(0, 500) })
    }
  } catch (e) {
    await db.from('job_errors').insert({ job: 'serious-check', entity_type: 'submission', entity_id: submissionId, message: (e as Error).message.slice(0, 500) })
  }
  if (!issues.length) return
  try {

    if (seriousKeywords.length) await queueSeriousWhatsApp(db, submissionId, seriousKeywords, seriousIdx)
    const { error: enqErr } = await db.rpc('enqueue_new_issue_notifications', { p_submission_id: submissionId })
    if (enqErr) throw new Error(`Queueing notifications failed: ${enqErr.message}`)
  } catch (e) {
    await db.from('job_errors').insert({ job: 'notify', entity_type: 'submission', entity_id: submissionId, message: (e as Error).message.slice(0, 500) })
    return
  }

  inBackground(Promise.all([
    sendPendingPushes(db, 50),
    seriousKeywords.length ? sendPendingWhatsApp(db, 50) : Promise.resolve(),
  ]).catch((e) => db.from('job_errors').insert({ job: 'notify', entity_type: 'submission', entity_id: submissionId, message: (e as Error).message.slice(0, 500) })))
}

async function processSubmission(db: Db, submissionId: string, actorId: string | null) {

  const staleBefore = new Date(Date.now() - 3 * 60_000).toISOString()
  const { data: claimed } = await db.from('submissions')
    .update({ processing_status: 'processing', locked_at: new Date().toISOString() })
    .eq('id', submissionId)
    .in('processing_status', ['submitted', 'processing', 'failed', 'needs_review'])
    .or(`locked_at.is.null,locked_at.lt.${staleBefore}`)
    .select('id, submitted_by, created_at, transcription_meta, reviewed_transcript, attempt_count, event_match, chosen_calendar_event_id, extraction, processing_error')
    .maybeSingle()
  if (!claimed) return { claimed: false }

  const attempt = (claimed.attempt_count ?? 0) + 1
  if (!actorId && attempt > MAX_ATTEMPTS + 2) {
    await db.from('submissions').update({ processing_status: 'failed', processing_error: 'Stopped after too many tries. Ask an admin to retry.',
      next_attempt_at: null, locked_at: null }).eq('id', submissionId)
    return { claimed: true, status: 'failed', error: 'Too many tries', will_retry: false }
  }
  await db.from('submissions').update({ attempt_count: attempt }).eq('id', submissionId)
  const metaAt = (claimed.transcription_meta as { recorded_at?: string } | null)?.recorded_at
  const createdMs = Date.parse(claimed.created_at as string)
  const recordedAt = metaAt && !Number.isNaN(Date.parse(metaAt)) && Date.parse(metaAt) <= createdMs + 60_000
    && Date.parse(metaAt) >= createdMs - 7 * 86_400_000 ? metaAt : claimed.created_at as string
  try {

    const menu = await loadDishes(db)
    const said = findDishes(claimed.reviewed_transcript, menu)
    const [matched, { data: cats }, { data: venueRows }] = await Promise.all([
      matchEvent(said.stripped || claimed.reviewed_transcript, null, recordedAt),
      db.from('issue_categories').select('id, name, description').eq('is_active', true).order('sort_order'),
      db.from('venues').select('id, venue_name, aliases:venue_aliases(alias)').eq('is_active', true),
    ])
    let match = matched ?? { status: 'calendar_error', reasons: [] }

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

    const categories = cats ?? []
    if (!categories.find((c) => c.name === 'Other')) categories.push({ id: null, name: 'Other', description: 'Anything else' })
    const names = categories.map((c) => c.name)

    if (!GEMINI_KEY) throw new AiError('GEMINI_API_KEY secret is missing', false)
    const guestNames = [ev?.guest_name]
    const payload = JSON.stringify({
      categories: categories.map((c) => ({ name: c.name, covers: c.description })),
      event_context: ev ? {
        date: ev.date, venue: ev.venue_name, area: ev.sub_venue, function: ev.function_name, shift: ev.shift,
      } : null,
      menu_dishes_mentioned: said.dishes.slice(0, 15).map((d) => ({ name: d.name, section: d.section })),
      transcript: redact(claimed.reviewed_transcript, guestNames),
    })
    const earlier = claimed.extraction as { model?: string; issues?: ExtractedIssue[]; compliments?: Compliment[] } | null
    const reuse = !actorId && String(claimed.processing_error ?? '').startsWith(CALENDAR_DOWN) && Array.isArray(earlier?.issues)
    const { issues, compliments, model: usedModel } = reuse
      ? { issues: earlier!.issues!, compliments: earlier!.compliments ?? [], model: earlier!.model ?? 'previous' }
      : await callGeminiWithRetry(db, payload, names, submissionId, actorId ?? claimed.submitted_by)

    const venues = (venueRows ?? []) as VenueRow[]
    const venueName = new Map(venues.map((v) => [v.id, v.venue_name]))
    const mainVenueId = (ev?.venue_id as string) ?? ((match.venue as { id?: string } | null)?.id ?? null)
    const mainDate = (ev?.date as string) ?? (match.date as string | null) ?? null
    const eventInfo = (e: Record<string, unknown>) => ({
      calendar_event_id: e.calendar_event_id, date: e.date, guest_name: e.guest_name,
      function_name: e.function_name, shift: e.shift, sub_venue: e.sub_venue, title: e.title,
    })

    const perIssue: { venue_id: string | null; event: Record<string, unknown> | null; match_status: string }[] =
      await Promise.all(issues.map(async (it) => {
        const venueSaid = isDishWord(it.venue_mentioned, said.words) ? null : it.venue_mentioned
        const place = resolveVenue(venueSaid, venues)
        if (!place || place === mainVenueId) {
          return { venue_id: place ?? mainVenueId, event: ev, match_status: String(match.status ?? 'unknown') }
        }

        const m = await matchEvent((venueSaid ?? '') + ' ' + findDishes(it.original_text, menu).stripped, mainDate, recordedAt)
        const e = (m?.status === 'matched' ? m.event : null) as Record<string, unknown> | null
        return { venue_id: place, event: e, match_status: String(m?.status ?? 'unknown') }
      }))

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
      })), { onConflict: 'submission_id,issue_index' })
      if (insErr) throw new Error(`Saving issues failed: ${insErr.message}`)
    }

    await db.from('compliments').delete().eq('submission_id', submissionId)
    if (compliments.length) {
      const { error: cErr } = await db.from('compliments').insert(compliments.map((c) => ({
        submission_id: submissionId,
        item: c.item,
        venue_id: resolveVenue(isDishWord(c.venue_mentioned, said.words) ? null : c.venue_mentioned, venues) ?? mainVenueId,
        event_day: mainDate ?? new Date(new Date(recordedAt).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10),
        summary: c.summary,
        original_text: c.original_text,
      })))
      if (cErr) console.error('saving compliments failed', cErr)
    }

    await db.from('issues').delete().eq('submission_id', submissionId).gte('issue_index', issues.length)

    const found = issues.length > 0 || compliments.length > 0
    const calendarDown = match.status === 'calendar_error' && attempt < MAX_ATTEMPTS
    const status = calendarDown ? 'failed' : found ? 'pending_assignment' : 'needs_review'
    const { error: upErr } = await db.from('submissions').update({
      processing_status: status,
      processing_error: calendarDown ? `${CALENDAR_DOWN} The event will be matched again shortly.`
        : found ? null : 'No clear issue found in the transcript',
      attempt_count: attempt,
      next_attempt_at: calendarDown ? new Date(Date.now() + Math.min(60, 2 ** attempt) * 60_000).toISOString() : null,
      locked_at: null,
      event_match: match,
      event_date: (ev?.date as string) ?? (match.date as string | null) ?? null,
      venue_id: (ev?.venue_id as string) ?? ((match.venue as { id?: string } | null)?.id ?? null),
      calendar_event_id: (ev?.calendar_event_id as string) ?? null,
      guest_name: (ev?.guest_name as string) ?? null,
      function_name: (ev?.function_name as string) ?? null,
      extraction: { model: usedModel, issues, compliments, processed_at: new Date().toISOString() },

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

    inBackground(notifyAfterSave(db, submissionId, issues))

    return { claimed: true, status, issues, event: match }
  } catch (e) {
    const retryable = e instanceof AiError ? e.retryable : true
    const giveUp = !retryable || attempt >= MAX_ATTEMPTS
    const msg = (e as Error).message
    await db.from('submissions').update({
      processing_status: 'failed',
      processing_error: msg.slice(0, 500),
      attempt_count: attempt,

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

async function releaseStuck(db: Db, channel: string) {
  const stale = new Date(Date.now() - 5 * 60_000).toISOString()
  await db.from('notification_queue').update({ status: 'pending', locked_at: null })
    .eq('channel', channel).eq('status', 'processing').lt('locked_at', stale)
}

async function sendPendingPushes(db: Db, limit = 100, deadline = Infinity) {
  if (!PUSH_READY) return { skipped: 'VAPID keys not set' }
  const now = new Date().toISOString()
  await releaseStuck(db, 'push')
  const { data: due } = await db.from('notification_queue').select('id')
    .eq('channel', 'push').in('status', ['pending', 'failed']).lte('next_attempt_at', now)
    .order('created_at').limit(limit)
  if (!due?.length) return { sent: 0 }

  const { data: jobs } = await db.from('notification_queue')
    .update({ status: 'processing', locked_at: now })
    .in('id', due.map((d) => d.id)).in('status', ['pending', 'failed'])
    .select('id, recipient_user_id, payload, retry_count, max_retries')
  let sent = 0, failed = 0, removed = 0
  for (const job of jobs ?? []) {
    if (Date.now() > deadline) {
      const left = (jobs ?? []).slice((jobs ?? []).indexOf(job)).map((j) => j.id)
      if (left.length) await db.from('notification_queue').update({ status: 'pending', locked_at: null }).in('id', left)
      break
    }
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

        ...(retry >= (job.max_retries ?? 5) ? { next_attempt_at: '9999-12-31T00:00:00Z' } : {}),
      }).eq('id', job.id)
    }
  }
  return { sent, failed, removed_devices: removed }
}

const padNorm = (t: string) => ' ' + t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim() + ' '

async function loadSeriousMatcher(db: Db): Promise<(texts: (string | null | undefined)[]) => string[]> {
  const [{ data, error }, { data: venues }] = await Promise.all([
    db.from('alert_keywords').select('keyword, keyword_normalized'),
    db.from('venues').select('venue_name, sub_venues, aliases:venue_aliases(alias)'),
  ])
  if (error) throw new Error(`Loading serious keywords failed: ${error.message}`)
  const places = (venues ?? []).flatMap((v) => [v.venue_name as string, ...((v.sub_venues as string[] | null) ?? []),
    ...((v.aliases as { alias: string }[] | null) ?? []).map((a) => a.alias)])
    .map((p) => padNorm(p ?? '').trim()).filter((p) => p.includes(' ')).sort((a, b) => b.length - a.length)
  const keywords = (data ?? []).map((k) => ({ keyword: k.keyword as string, kw: padNorm(k.keyword_normalized as string).trim() }))
  return (texts) => {
    if (!keywords.length || !texts.some(Boolean)) return []
    let hay = padNorm(texts.filter(Boolean).join(' \n '))
    for (const p of places) hay = hay.split(' ' + p + ' ').join(' ')
    return keywords.filter((k) => k.kw && hay.includes(' ' + k.kw + ' ')).map((k) => k.keyword)
  }
}

function waNumber(raw: string | null | undefined): string | null {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 13 && d.startsWith('910')) d = '91' + d.slice(3)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  return d.length === 10 && /^[6-9]/.test(d) ? '91' + d : null
}

async function whapiSend(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!WHAPI_TOKEN) return { ok: false, error: 'WHAPI_API_TOKEN secret is missing' }
  try {
    const res = await fetch('https://gate.whapi.cloud/messages/text', {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHAPI_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: to.includes('@') ? to : to + '@s.whatsapp.net', body }),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) return { ok: true }
    return { ok: false, error: `Whapi ${res.status}: ${(await res.text()).slice(0, 200)}` }
  } catch (e) {
    return { ok: false, error: `Whapi unreachable: ${(e as Error).message}` }
  }
}

async function queueSeriousWhatsApp(db: Db, submissionId: string, keywords: string[], seriousIdx: number[]) {
  const { data: sub } = await db.from('submissions')
    .select('id, submitted_by, created_at, guest_name, function_name, venue:venues(venue_name), recorder:app_users!submissions_submitted_by_fkey(name, mobile_number)')
    .eq('id', submissionId).maybeSingle()
  if (!sub) return 0
  const { data: issues } = await db.from('issues')
    .select('issue_index, category_raw, item, ai_summary, venue:venues(venue_name)')
    .eq('submission_id', submissionId).in('issue_index', seriousIdx).order('issue_index')

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
    `Recorded by ${((sub.recorder as { name?: string } | null)?.name ?? '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim() || 'staff'} · ${when}`,
    waNumber((sub.recorder as { mobile_number?: string } | null)?.mobile_number) ? `Call recorder: +${waNumber((sub.recorder as { mobile_number?: string } | null)?.mobile_number)}` : null,
    APP_URL ? `Open: ${APP_URL}issues` : null,
  ].filter((l) => l !== null) as string[]
  const body = lines.join('\n')

  const { data: pocs } = await db.from('app_users').select('id, mobile_number')
    .eq('is_active', true).contains('roles', ['poc']).neq('id', sub.submitted_by)
  let queued = 0
  for (const u of pocs ?? []) {
    const to = waNumber(u.mobile_number)
    if (!to) continue
    const { error } = await db.from('notification_queue').upsert({
      recipient_user_id: u.id, channel: 'whatsapp', notification_type: 'serious_issue',
      payload: { to, body }, dedupe_key: `serious:${submissionId}:${u.id}:whatsapp`,
    }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    if (!error) queued++
  }
  return queued
}

async function sendPendingWhatsApp(db: Db, limit = 50, deadline = Infinity) {
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
    if (Date.now() > deadline) {
      const left = (jobs ?? []).slice((jobs ?? []).indexOf(job)).map((j) => j.id)
      if (left.length) await db.from('notification_queue').update({ status: 'pending', locked_at: null }).in('id', left)
      break
    }
    const { to, body } = job.payload as { to: string; body: string }
    const r = await whapiSend(to, body)
    if (r.ok) {
      sent++
      await db.from('notification_queue').update({ status: 'sent', processed_at: new Date().toISOString(), locked_at: null, last_error: null }).eq('id', job.id)
    } else {
      failed++
      const retry = (job.retry_count ?? 0) + 1
      const outage = /Whapi (402|429|5\d\d)|unreachable/.test(r.error ?? '')
      const giveUp = outage ? retry >= 48 : retry >= (job.max_retries ?? 5)
      if (outage && retry === 1) {
        await db.from('job_errors').insert({ job: 'whatsapp', entity_type: 'notification', entity_id: job.id, message: (r.error ?? '').slice(0, 500) })
      }
      await db.from('notification_queue').update({
        status: 'failed', retry_count: retry, locked_at: null, last_error: r.error?.slice(0, 500),
        next_attempt_at: giveUp ? '9999-12-31T00:00:00Z'
          : new Date(Date.now() + (outage ? 30 : Math.min(30, 2 ** retry)) * 60_000).toISOString(),
      }).eq('id', job.id)
    }
    await new Promise((res) => setTimeout(res, 1000))
  }
  return { sent, failed }
}

async function runCron(db: Db) {
  const { data: runId } = await db.rpc('job_start', { p_job: 'issue-desk-cron' })
  if (!runId) return { skipped: true, reason: 'previous run still going' }

  const started = Date.now()
  const stats: Record<string, unknown> = { retried: 0, retried_ok: 0, audio_deleted: 0 }
  let ok = true
  try {

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

    const { data: expired } = await db.from('submissions').select('id, audio_path')
      .lt('audio_expires_at', new Date().toISOString()).is('audio_deleted_at', null).not('audio_path', 'is', null).limit(100)
    if (expired?.length) {
      const { error: rmErr } = await db.storage.from('recordings').remove(expired.map((e) => e.audio_path as string))
      if (rmErr) throw new Error(`Audio cleanup failed: ${rmErr.message}`)
      await db.from('submissions').update({ audio_deleted_at: new Date().toISOString() }).in('id', expired.map((e) => e.id))
      stats.audio_deleted = expired.length
    }

    stats.push = await sendPendingPushes(db, 100, started + CRON_TIME_BUDGET_MS + 15_000)
    stats.whatsapp = await sendPendingWhatsApp(db, 30, started + CRON_TIME_BUDGET_MS + 25_000)

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

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return reply(origin, 405, { error: 'Method not allowed' })

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  const cronHeader = req.headers.get('x-cron-secret')
  if (cronHeader !== null) {
    if (!CRON_SECRET || cronHeader !== CRON_SECRET) return reply(origin, 401, { error: 'Bad cron secret.' })
    return reply(origin, 200, await runCron(db))
  }

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')

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

  if (body.action === 'submit') {
    if (!me.roles.some((r) => r === 'recorder' || r === 'admin') || !me.id) return reply(origin, 403, { error: 'You are not allowed to submit issues.' })
    const clientId = String(body.client_submission_id ?? '')
    const transcript = String(body.reviewed_transcript ?? '').trim()
    if (!UUID_RE.test(clientId)) return reply(origin, 400, { error: 'Invalid submission id.' })
    if (!transcript) return reply(origin, 400, { error: 'The transcript is empty.' })
    if (transcript.length > 5000) return reply(origin, 400, { error: 'The transcript is too long.' })
    const audioPath = body.audio_path ? String(body.audio_path) : null
    if (audioPath && !new RegExp(`^${me.id}/${clientId}\\.(webm|m4a|ogg|wav)$`).test(audioPath)) return reply(origin, 400, { error: 'Invalid audio path.' })

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

        chosen_calendar_event_id: typeof body.chosen_calendar_event_id === 'string' ? body.chosen_calendar_event_id.slice(0, 64) : null,
        audio_duration_sec: Number(body.audio_duration_sec) || null,
        audio_expires_at: audioPath ? new Date(Date.now() + days * 86400_000).toISOString() : null,
        processing_status: 'submitted',
      }).select('id, submitted_by, processing_status').single()
      if (error?.code === '23505') {

        sub = (await db.from('submissions').select('id, submitted_by, processing_status').eq('client_submission_id', clientId).single()).data
      } else if (error || !created) {
        console.error('insert submission failed', error)
        return reply(origin, 500, { error: 'Could not save your submission. Please retry.', retryable: true })
      } else sub = created
    }

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

  if (body.action === 'whatsapp_test') {
    if (!me.roles.includes('admin')) return reply(origin, 403, { error: 'Only an admin can do this.' })
    const to = waNumber(String(body.to ?? ''))
    if (!to) return reply(origin, 400, { error: 'Enter a valid 10-digit Indian mobile number.' })
    const r = await whapiSend(to, '✅ Test from Ambria food review: serious-issue alerts will arrive on this number.')
    return reply(origin, r.ok ? 200 : 502, r.ok ? { ok: true } : { error: r.error })
  }

  if (body.action === 'retry') {
    if (!me.roles.some((r) => r === 'admin' || r === 'system')) return reply(origin, 403, { error: 'Only an admin can retry.' })
    const id = String(body.submission_id ?? '')
    if (!UUID_RE.test(id)) return reply(origin, 400, { error: 'Invalid submission id.' })
    await db.from('submissions').update({ attempt_count: 0 }).eq('id', id)
    const result = await processSubmission(db, id, me.id)
    return reply(origin, 200, result)
  }

  if (body.action === 'delete_issue' || body.action === 'delete_submission') {
    if (!me.roles.includes('admin')) return reply(origin, 403, { error: 'Only an admin can delete.' })
    let submissionId = String(body.submission_id ?? '')
    if (body.action === 'delete_issue') {
      const issueId = String(body.issue_id ?? '')
      if (!UUID_RE.test(issueId)) return reply(origin, 400, { error: 'Invalid issue id.' })
      const { data: row } = await db.from('issues').select('submission_id').eq('id', issueId).maybeSingle()
      if (!row) return reply(origin, 404, { error: 'This issue no longer exists.' })
      submissionId = row.submission_id as string
      const { error: delErr } = await db.from('issues').delete().eq('id', issueId)
      if (delErr) return reply(origin, 500, { error: 'Could not delete the issue.' })
      const { count } = await db.from('issues').select('id', { count: 'exact', head: true }).eq('submission_id', submissionId)
      if ((count ?? 0) > 0) return reply(origin, 200, { ok: true, deleted: 'issue' })
      const { count: praise } = await db.from('compliments').select('id', { count: 'exact', head: true }).eq('submission_id', submissionId)
      if ((praise ?? 0) > 0) return reply(origin, 200, { ok: true, deleted: 'issue' })
    }
    if (!UUID_RE.test(submissionId)) return reply(origin, 400, { error: 'Invalid submission id.' })
    const { data: sub } = await db.from('submissions').select('id, audio_path, audio_deleted_at').eq('id', submissionId).maybeSingle()
    if (!sub) return reply(origin, 200, { ok: true, deleted: 'recording' })
    if (sub.audio_path && !sub.audio_deleted_at) {
      const { error: rmErr } = await db.storage.from('recordings').remove([sub.audio_path as string])
      if (rmErr) console.error('audio delete failed', rmErr)
    }
    await db.from('notification_queue').delete().like('dedupe_key', `serious:${submissionId}:%`)
    await db.from('notification_queue').delete().like('dedupe_key', `new_issues:${submissionId}:%`)
    const { error: subErr } = await db.from('submissions').delete().eq('id', submissionId)
    if (subErr) return reply(origin, 500, { error: 'Could not delete the recording.' })
    return reply(origin, 200, { ok: true, deleted: 'recording' })
  }

  return reply(origin, 400, { error: 'Unknown action.' })
})
