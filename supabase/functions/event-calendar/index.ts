// =============================================================================
// WHAT THIS FILE IS
//   Edge Function "event-calendar": the app's only connection to the existing
//   Ambria Event Calendar (READ-ONLY), plus the logic that works out WHICH
//   booking a spoken complaint is about.
//
// WHY IT EXISTS
//   The recorder never picks an event by hand. The event is identified from
//   what was SAID, checked against the Calendar:
//     1. date   – NOT SAID → today (staff record on the day of the function;
//                 between midnight and 5 AM, last night counts too).
//                 Said: explicit ("15 Nov", "15 नवंबर", "15/11"), relative
//                 ("aaj", "kal", "parso", "yesterday"), or a weekday.
//                 "kal / कल" means both yesterday and tomorrow in Hindi, so the
//                 tense decides: "tha / hua / gaya" → yesterday,
//                 "hoga / hogi" → tomorrow.
//     2. venue  – admin-managed aliases (AP / Pushpanjali / …), or a lawn/hall
//                 that belongs to only one venue ("Amber Lawn" → AP).
//     3. the day's bookings at that venue are fetched and SCORED on what was
//        said: guest name (Devanagari is transliterated, so "शर्मा" matches
//        "Sharma"), function type (shaadi/sagai/birthday…), shift
//        (lunch/raat/shaam/subah) and lawn/hall.
//     4. decision – one clear winner → matched. A tie (e.g. lunch and dinner at
//        the same venue with nothing said to tell them apart) → "ambiguous"
//        with the candidates. It is NEVER guessed; Admin resolves it later.
//   Guest and function names in the result are copied from the booking, not
//   invented from speech.
//
//   Calendar rules followed (docs/EVENT_CALENDAR_API.md):
//     deleted_at=is.null always; kill switch on → no bookings; GET only;
//     multi-day bookings (end_date, Villa check-in/out) are matched too.
//
//   Actions (POST JSON):
//     { action: "categories" }                          Admin → venue import
//     { action: "events", date, calendar_venue_ids? }   bookings on one day
//     { action: "match", transcript, hint_date? }       identify the event from speech
//                                                       (hint_date: day to use when none is said)
//
// ONE FILE ON PURPOSE
//   Everything (matcher + handler) is in this file so it can be pasted into the
//   Supabase dashboard editor as-is. It is also importable by the unit tests
//   (supabase/functions/_tests): Deno is only touched through `deno` below,
//   and vite.config.ts maps the jsr: import to the npm package.
//
// USED BY
//   src/services/eventCalendarService.ts, the process-issue function, the tests
//
// DEPENDS ON
//   Secrets: EVENT_CALENDAR_API_URL, EVENT_CALENDAR_API_KEY, ALLOWED_ORIGINS
//   Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   Tables: app_users, venues, venue_aliases, api_usage_log
//
// DASHBOARD SETTING
//   Verify JWT: OFF. The function checks the caller's session itself.
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

// Deno only exists in the Edge runtime; under the tests (Node) these are undefined.
type DenoLike = { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response> | Response): unknown }
const deno = (globalThis as unknown as { Deno?: DenoLike }).Deno
const denoEnv = (k: string) => deno?.env.get(k)

// ===========================================================================
// MATCHER — reads date, venue, guest, function and shift from a transcript and
// scores the Calendar bookings against them. Pure code (no Deno), unit-tested.
// ===========================================================================
export interface CalEvent {
  id: string; venue_id: string; title: string | null; status: string | null; date: string
  end_date: string | null; time: string | null; shift: string | null; sub_venue: string | null
  event_type: string | null; event_type_other: string | null; guest_name: string | null; pax: string | null
  check_in_date: string | null; check_out_date: string | null; venue_name: string | null
}
export interface Venue { id: string; venue_name: string; calendar_venue_id: string | null; sub_venues: string[]; aliases: { alias: string }[] }

export interface MatchDeps {
  /** Active venues with their aliases. */
  venues: Venue[]
  killSwitchOn: () => Promise<boolean>
  /** Bookings on one day at these Calendar venue ids (all venues when empty). */
  eventsOn: (date: string, calendarVenueIds: string[]) => Promise<CalEvent[]>
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
/** lower-case, letters/digits of any script, single spaces, padded with spaces. */
/** Devanagari digits (०-९) → 0-9, so "१५ तारीख" reads like "15 तारीख". */
export const asciiDigits = (t: string) => t.replace(/[०-९]/g, (d) => String('०१२३४५६७८९'.indexOf(d)))

export function normalize(text: string): string {
  text = asciiDigits(text)
  return ' ' + text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim() + ' '
}
const has = (hay: string, needle: string) => needle.trim() !== '' && hay.includes(` ${needle.trim()} `)
const hasAny = (hay: string, words: string[]) => words.some((w) => has(hay, w))

export function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

// Devanagari → rough Latin, only for comparing names ("शर्मा" ≈ "sharma").
const VOWELS: Record<string, string> = { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऋ': 'ri' }
const MATRAS: Record<string, string> = { 'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ृ': 'ri', 'ॉ': 'o', 'ॅ': 'e' }
const CONS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'f', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
  'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l',
}
export function translitWord(w: string): string {
  if (!/[ऀ-ॿ]/.test(w)) return w
  let out = ''
  const chars = [...w.replace(/़/g, '')]          // drop nukta
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    const next = chars[i + 1]
    if (CONS[c]) {
      out += CONS[c]
      if (next === '्') { i++; continue }            // virama: no vowel
      if (next && MATRAS[next]) { out += MATRAS[next]; i++; continue }
      out += 'a'                                      // inherent vowel
    } else if (VOWELS[c]) out += VOWELS[c]
    else if (c === 'ं' || c === 'ँ') out += 'n'
    else if (MATRAS[c]) out += MATRAS[c]
  }
  if (/[^aeiou]a$/.test(out) && out.length > 3) out = out.slice(0, -1)   // final schwa: "राहुल" → rahul
  return out
}
// English letters spoken in Hindi script ("एनपी" = NP, "आरके" = RK). Longest first.
const HINDI_LETTERS: [string, string][] = ([
  ['डब्ल्यू', 'w'], ['क्यू', 'q'], ['एक्स', 'x'], ['वाई', 'y'], ['जेड', 'z'], ['ज़ेड', 'z'],
  ['एच', 'h'], ['एफ', 'f'], ['एल', 'l'], ['एम', 'm'], ['एन', 'n'], ['आर', 'r'], ['एस', 's'],
  ['बी', 'b'], ['सी', 'c'], ['डी', 'd'], ['जी', 'g'], ['जे', 'j'], ['के', 'k'], ['पी', 'p'],
  ['टी', 't'], ['वी', 'v'], ['यू', 'u'], ['ओ', 'o'], ['ई', 'e'], ['आई', 'i'], ['ए', 'a'],
] as [string, string][]).sort((a, b) => b[0].length - a[0].length)

/** "एनपी" → "np" if the whole word is made of spelled letters (2+), else null. */
export function hindiInitials(w: string): string | null {
  let rest = w, out = ''
  while (rest) {
    const hit = HINDI_LETTERS.find(([h]) => rest.startsWith(h))
    if (!hit) return null
    out += hit[1]
    rest = rest.slice(hit[0].length)
  }
  return out.length >= 2 ? out : null
}

/** Spelling-insensitive key: aa→a, ee→i, oo→u, w→v, ph→f. */
export const nameKey = (s: string) => s.toLowerCase().replace(/aa/g, 'a').replace(/ee|ii/g, 'i').replace(/oo/g, 'u')
  .replace(/w/g, 'v').replace(/ph/g, 'f').replace(/[^a-z]/g, '')

// ---------------------------------------------------------------------------
// Dates (India time)
// ---------------------------------------------------------------------------
export function todayIST(): Date {
  const ist = new Date(Date.now() + 5.5 * 3600_000)
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()))
}
const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000)

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
  'जनवरी': 0, 'फरवरी': 1, 'फ़रवरी': 1, 'मार्च': 2, 'अप्रैल': 3, 'मई': 4, 'जून': 5, 'जुलाई': 6, 'अगस्त': 7,
  'सितंबर': 8, 'सितम्बर': 8, 'अक्टूबर': 9, 'अक्तूबर': 9, 'नवंबर': 10, 'नवम्बर': 10, 'दिसंबर': 11, 'दिसम्बर': 11,
}
const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  ravivar: 0, somvar: 1, mangalvar: 2, budhvar: 3, guruvar: 4, shukravar: 5, shanivar: 6,
  'रविवार': 0, 'सोमवार': 1, 'मंगलवार': 2, 'बुधवार': 3, 'गुरुवार': 4, 'शुक्रवार': 5, 'शनिवार': 6,
}
const PAST = ['tha', 'thi', 'the', 'था', 'थी', 'थे', 'hua', 'hui', 'hue', 'हुआ', 'हुई', 'हुए', 'gaya', 'gayi', 'गया', 'गई', 'गयी', 'aaya', 'aayi', 'आया', 'आई', 'was', 'were', 'did', 'happened']
const FUTURE = ['hoga', 'hogi', 'honge', 'होगा', 'होगी', 'होंगे', 'will', 'tomorrow']

interface DateCand { date: string; weight: number; source: string }

function resolveDayMonth(day: number, month: number, today: Date, year?: number): Date | null {
  if (day < 1 || day > 31 || month < 0 || month > 11) return null
  let y = year ?? today.getUTCFullYear()
  if (year !== undefined && year < 100) y = 2000 + year
  const d = new Date(Date.UTC(y, month, day))
  if (d.getUTCMonth() !== month) return null
  if (year === undefined && d.getTime() - today.getTime() > 30 * 86400_000) return new Date(Date.UTC(y - 1, month, day))
  return d
}

export function detectDates(raw: string, t: string, today: Date): { cands: DateCand[]; explicit: boolean } {
  const out: DateCand[] = []
  const add = (d: Date, weight: number, source: string) => {
    const k = iso(d)
    const ex = out.find((c) => c.date === k)
    if (ex) ex.weight = Math.max(ex.weight, weight)
    else out.push({ date: k, weight, source })
  }
  const monthNames = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')
  for (const m of t.matchAll(new RegExp(` (\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${monthNames})(?: (\\d{2,4}))? `, 'gu'))) {
    const d = resolveDayMonth(Number(m[1]), MONTHS[m[2]], today, m[3] ? Number(m[3]) : undefined)
    if (d) add(d, 3, `"${m[0].trim()}"`)
  }
  // Month first ("Nov 15"): not "may"/"mar", which are everyday words ("may 2 log").
  const monthFirst = Object.keys(MONTHS).filter((m) => m !== 'may' && m !== 'mar').sort((a, b) => b.length - a.length).join('|')
  for (const m of t.matchAll(new RegExp(` (${monthFirst}) (\\d{1,2})(?:st|nd|rd|th)? `, 'gu'))) {
    const d = resolveDayMonth(Number(m[2]), MONTHS[m[1]], today)
    if (d) add(d, 3, `"${m[0].trim()}"`)
  }
  // "15 तारीख", "15 tarikh/tareekh", "15 date", "15th" (no month said) → that day
  // of THIS month, or of last month if that day hasn't come yet (complaints are
  // about the past).
  const DAY_WORDS = 'तारीख|तारीक|तारिख|tarikh|tareekh|tareek|tarik|tarekh|date'
  const dayOnly = (day: number) => {
    let d = resolveDayMonth(day, today.getUTCMonth(), today, today.getUTCFullYear())
    // Not yet this month, or not a real date this month (31 in a 30-day month) → last month.
    if (!d || d.getTime() > today.getTime()) {
      d = resolveDayMonth(day, (today.getUTCMonth() + 11) % 12, today, today.getUTCMonth() === 0 ? today.getUTCFullYear() - 1 : today.getUTCFullYear())
    }
    return d
  }
  for (const m of t.matchAll(new RegExp(` (\\d{1,2})(?:st|nd|rd|th)? (?:${DAY_WORDS}) `, 'gu'))) {
    const d = dayOnly(Number(m[1]))
    if (d) add(d, 3, `"${m[0].trim()}"`)
  }
  // "15th ko / 15th wale / 15th ke function" = a date; "1st floor" is not.
  const AFTER_ORDINAL = 'ko|को|wale|wala|वाले|वाला|ke|के|ka|का|ki|की|date|tarikh|event|function|फंक्शन'
  for (const m of t.matchAll(new RegExp(` (\\d{1,2})(?:st|nd|rd|th) (?=(?:${AFTER_ORDINAL}) )`, 'gu'))) {
    const d = dayOnly(Number(m[1]))
    if (d) add(d, 3, `"${m[0].trim()}"`)
  }
  // 15/11 or 15/11/2026, 15-11-2026, 15.11.26. "2-3 log" / "3.4" (no year) are NOT dates.
  for (const m of asciiDigits(raw).matchAll(/\b(\d{1,2})(?:\/(\d{1,2})(?:\/(\d{2,4}))?|([.-])(\d{1,2})\4(\d{2,4}))\b/g)) {
    const month = Number(m[2] ?? m[5]), year = m[3] ?? m[6]
    const d = resolveDayMonth(Number(m[1]), month - 1, today, year ? Number(year) : undefined)
    if (d) add(d, 3, `"${m[0]}"`)
  }
  const explicit = out.length > 0

  const past = PAST.filter((w) => has(t, w)).length
  const future = FUTURE.filter((w) => has(t, w)).length
  if (has(t, 'day before yesterday')) add(addDays(today, -2), 2, '"day before yesterday"')
  else if (has(t, 'yesterday')) add(addDays(today, -1), 2, '"yesterday"')
  if (hasAny(t, ['aaj', 'aj', 'आज', 'today', 'tonight'])) add(today, 2, '"aaj"')
  if (has(t, 'tomorrow')) add(addDays(today, 1), 2, '"tomorrow"')
  // Hindi "kal" = yesterday OR tomorrow, "parso" = 2 days either way. The tense
  // decides: past ("tha/hua/gaya") → ONLY the past day; future ("hoga") → ONLY
  // the future day. Only when the tense is unclear are both days checked (past first).
  const tensePast = past > future, tenseFuture = future > past
  if (hasAny(t, ['kal', 'kl', 'कल'])) {
    if (!tenseFuture) add(addDays(today, -1), 1.5, tensePast ? '"kal" (past tense → yesterday)' : '"kal"')
    if (!tensePast) add(addDays(today, 1), tenseFuture ? 1.5 : 0.5, tenseFuture ? '"kal" (future tense → tomorrow)' : '"kal"')
  }
  if (hasAny(t, ['parso', 'parson', 'परसों', 'परसो'])) {
    if (!tenseFuture) add(addDays(today, -2), 1.5, '"parso"')
    if (!tensePast) add(addDays(today, 2), tenseFuture ? 1.5 : 0.5, '"parso"')
  }
  for (const [word, dow] of Object.entries(WEEKDAYS)) {
    if (has(t, word)) add(addDays(today, -((today.getUTCDay() - dow + 7) % 7)), 2, `"${word}"`)
  }
  return { cands: out, explicit }
}

// ---------------------------------------------------------------------------
// Function type + shift words
// ---------------------------------------------------------------------------
const FUNCTION_WORDS: Record<string, string[]> = {
  wedding: ['wedding', 'shaadi', 'shadi', 'शादी', 'vivah', 'विवाह', 'marriage', 'phere', 'pheras', 'फेरे', 'baraat', 'बारात', 'वेडिंग'],
  engagement: ['engagement', 'sagai', 'सगाई', 'ring ceremony', 'roka', 'रोका', 'एंगेजमेंट'],
  reception: ['reception', 'रिसेप्शन'],
  birthday: ['birthday', 'bday', 'बर्थडे', 'janamdin', 'जन्मदिन'],
  anniversary: ['anniversary', 'सालगिरह', 'एनिवर्सरी'],
  haldi: ['haldi', 'हल्दी'],
  mehendi: ['mehendi', 'mehndi', 'मेहंदी', 'मेहँदी'],
  sangeet: ['sangeet', 'संगीत'],
  cocktail: ['cocktail', 'कॉकटेल'],
  corporate: ['corporate', 'conference', 'office party', 'कॉर्पोरेट'],
  kitty: ['kitty', 'किटी'],
  lagan: ['lagan', 'लगन', 'lagna'],
  tilak: ['tilak', 'तिलक'],
  social: ['social gathering', 'get together', 'gathering', 'सोशल'],
}
const SHIFT_WORDS: Record<string, string[]> = {
  Morning: ['morning', 'subah', 'सुबह', 'breakfast', 'नाश्ता', 'nashta'],
  // "din wale / दिन वाले / day time" = the daytime function (vs the night one)
  // ("din ka / din ke" are NOT here: "us din ka function" just means "that day's function")
  Lunch: ['lunch', 'लंच', 'dopahar', 'दोपहर', 'din wale', 'din wala', 'दिन वाले', 'दिन वाला', 'day time', 'daytime'],
  Sundowner: ['sundowner', 'shaam', 'शाम', 'evening', 'hi tea', 'high tea'],
  Dinner: ['dinner', 'डिनर', 'raat', 'रात', 'night'],
}
// Honorifics are not part of a name; very common surnames alone don't identify a guest.
const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'sri', 'smt', 'sir', 'madam', 'ji'])
const COMMON_SURNAMES = new Set(['singh', 'kumar', 'sharma', 'gupta', 'agarval', 'agraval', 'jain', 'verma', 'varma',
  'devi', 'kaur', 'khan', 'yadav', 'mehta', 'shah', 'arora', 'kapur', 'kapor', 'malhotra', 'chauhan', 'sethi', 'bansal', 'garg', 'mital', 'mitall', 'goyal', 'gupt'])

export function shiftOf(e: CalEvent): string | null {
  if (e.shift) return e.shift
  if (!e.time) return null
  const h = Number(e.time.slice(0, 2))
  return h < 11 ? 'Morning' : h < 16 ? 'Lunch' : h < 19 ? 'Sundowner' : 'Dinner'
}
export const functionNameOf = (e: CalEvent) => (e.event_type === 'Other' ? (e.event_type_other || 'Other') : (e.event_type || null))

// ---------------------------------------------------------------------------
// The matcher
// ---------------------------------------------------------------------------
export async function matchEvent(deps: MatchDeps, transcript: string, hintDate: string | null = null) {
  const { killSwitchOn, eventsOn } = deps
  const t = normalize(transcript)
  // 2+ letters, so initials like "NP" / "RK" count too (they must match exactly).
  const words = t.trim().split(' ')
  // Initials written apart: "N P Singh", "N. P.", "एन पी" → one token "np".
  const letterOf = (w: string): string | null => {
    if (/^[a-z]$/.test(w)) return w
    if (w === 'के' || w === 'जी') return null     // everyday Hindi words ("Singh जी के"), not K / G
    const h = HINDI_LETTERS.find(([d]) => d === w)
    return h ? h[1] : null
  }
  const joinedInitials: string[] = []
  let run = ''
  for (const w of [...words, '']) {
    const l = letterOf(w)
    if (l) { run += l; continue }
    if (run.length >= 2) joinedInitials.push(run)
    run = ''
  }
  const latinTokens = [
    ...words.map(translitWord).map(nameKey),
    ...words.map(hindiInitials).filter((x): x is string => Boolean(x)),   // "एनपी" → "np"
    ...joinedInitials,
  ].filter((x) => x.length >= 2)
  const today = todayIST()

  // ---- venue ---------------------------------------------------------------
  const venues = deps.venues
  const subCount = new Map<string, number>()
  for (const v of venues) for (const s of new Set(v.sub_venues.map((x) => normalize(x).trim()))) subCount.set(s, (subCount.get(s) ?? 0) + 1)

  // Short aliases (≤ 3 letters, e.g. "AP") count only when written in CAPITALS
  // as a separate word and not right after a number, so "7 am" or "ap log"
  // never selects a venue.
  const shortAliasSaid = (alias: string) => {
    const a = alias.trim()
    if (!/^[A-Za-z]{1,3}$/.test(a)) return false
    // Built from regex literals (not a template string) so the \p / \d escapes survive.
    const before = /(?<![\p{L}\p{N}])(?<!\d\s?)/u.source
    const after = /(?![\p{L}\p{N}])/u.source
    return new RegExp(before + a.toUpperCase() + after, 'u').test(transcript)
  }

  // Everyday words that also appear in some venue names ("Ambria Events",
  // "Wedding Services"). They never count as a near-miss spelling of a venue.
  const COMMON = new Set(['event', 'events', 'decor', 'design', 'services', 'service', 'cuisine', 'tender', 'villa', 'wedding'])

  // A name as it SOUNDS, without spaces: "Manaktala", "मानक तला", "Manak Tala"
  // all become "manaktala". Speech-to-text often splits a venue name in two or
  // writes it in Hindi script, so 1–3 neighbouring spoken words are joined and
  // compared this way too.
  const soundKey = (s: string) => nameKey(normalize(s).trim().split(' ').map(translitWord).join(''))
  // Hindi script hides the short "a" inside words: "मानकतला" reads as
  // "manakatala", not "manaktala". So the comparison also uses the name with
  // every "a" removed ("mnktl"); only for names of 6+ letters (see below).
  const skeleton = (k: string) => k.replace(/a/g, '')
  const spokenKeys = new Set<string>()
  const spokenSkeletons = new Set<string>()
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      const k = soundKey(words.slice(i, i + n).join(' '))
      spokenKeys.add(k)
      if (skeleton(k).length >= 4) spokenSkeletons.add(skeleton(k))
    }
  }
  const saidAloud = (name: string) => {
    const k = soundKey(name)
    return k.length >= 6 && (spokenKeys.has(k) || (skeleton(k).length >= 4 && spokenSkeletons.has(skeleton(k))))
  }
  // A list word ("haldi", "din wale") said as written OR as it sounds in Hindi
  // script ("हल्दी"), so the Hindi spellings don't have to be listed one by one.
  const wordSaid = (w: string) => has(t, w) || (soundKey(w).length >= 4 && spokenKeys.has(soundKey(w)))
  const saidAny = (list: string[]) => list.some(wordSaid)

  type Hit = { venue: Venue; via: string; strength: number; phrase: string }
  const exactHits: Hit[] = []
  const subHits: Hit[] = []
  const nearHits: Hit[] = []
  for (const v of venues) {
    const allNames = [v.venue_name, ...v.aliases.map((a) => a.alias)]
    const shortSaid = allNames.find((n) => /^[A-Za-z]{1,3}$/.test(n.trim()) && shortAliasSaid(n))
    // Single everyday words ("Events") are never usable as a venue name on their own.
    const names = allNames.filter((n) => !/^[A-Za-z]{1,3}$/.test(n.trim())).map((n) => normalize(n).trim())
      .filter((n) => n && !COMMON.has(n))
    // Longest name said for this venue ("ambria pushpanjali" beats "ambria").
    const exact = shortSaid ? normalize(shortSaid).trim()
      : names.filter((n) => has(t, n)).sort((x, y) => y.length - x.length)[0]
    if (exact) { exactHits.push({ venue: v, via: `said "${exact}"`, strength: 3, phrase: exact }); continue }
    // Said in Hindi script or split in two ("मानक तला" = Manaktala). 6+ letters, so short words can't collide.
    const spoken = [...names].sort((x, y) => y.length - x.length).find(saidAloud)
    if (spoken) { exactHits.push({ venue: v, via: `said "${spoken}" (as spoken)`, strength: 3, phrase: spoken }); continue }
    const sub = v.sub_venues.map((s) => normalize(s).trim()).find((s) => s.length >= 4 && subCount.get(s) === 1 && (has(t, s) || saidAloud(s)))
    if (sub) { subHits.push({ venue: v, via: `said "${sub}"`, strength: 2, phrase: sub }); continue }
    const near = names.filter((n) => !n.includes(' ') && n.length >= 6 && !COMMON.has(n))
      .find((n) => t.trim().split(' ').some((tok) => tok.length >= 5 && !COMMON.has(tok) && levenshtein(tok, n) === 1))
    if (near) nearHits.push({ venue: v, via: `sounds like "${near}"`, strength: 1, phrase: near })
  }
  // A shorter name inside a longer one that was also said is not a separate
  // venue: if "Ambria" is AP's alias and someone says "Ambria Manaktala", it is AM.
  const exactKept = exactHits.filter((h) => !exactHits.some((o) => o !== h && o.phrase.length > h.phrase.length
    && (' ' + o.phrase + ' ').includes(' ' + h.phrase + ' ')))
  // Near-miss spellings are only a last resort, when nothing matched exactly.
  const venueHits = exactKept.length || subHits.length ? [...exactKept, ...subHits] : nearHits
  const linked = venues.filter((v) => v.calendar_venue_id)
  const searchVenueIds = (venueHits.length ? venueHits.map((h) => h.venue) : linked)
    .map((v) => v.calendar_venue_id).filter((x): x is string => Boolean(x))

  // ---- dates ---------------------------------------------------------------
  const { cands, explicit } = detectDates(transcript, t, today)
  const dateSaid = cands.length > 0
  // Nothing said about the date → it is TODAY (staff record on the day of the
  // function). Exception: a recording made after midnight and before 5 AM may be
  // about last night's function (dinners run late), so yesterday counts equally.
  const lateNight = new Date(Date.now() + 5.5 * 3600_000).getUTCHours() < 5
  const assumed = lateNight
    ? [{ date: iso(today), weight: 1.5, source: 'not said (today)' },
       { date: iso(addDays(today, -1)), weight: 1.5, source: 'not said (last night, recorded after midnight)' }]
    : [{ date: iso(today), weight: 2, source: 'not said (today, the recording day)' }]
  // hintDate: when matching ONE issue of a recording (process-issue), the
  // recording's date is used if the issue's own words don't say a date.
  const hinted = hintDate ? [{ date: hintDate, weight: 2, source: 'same day as the rest of the recording' }] : null
  const dates = (dateSaid ? cands : (hinted ?? assumed)).sort((a, b) => b.weight - a.weight).slice(0, 4)

  if (await killSwitchOn()) return { status: 'calendar_paused', reasons: ['The Event Calendar is paused (kill switch on).'] }

  // ---- candidates + scoring -------------------------------------------------
  const venueByCal = new Map(venues.map((v) => [v.calendar_venue_id, v]))
  const scored: { e: CalEvent; on: string; score: number; reasons: string[]; specific: boolean; guest: boolean }[] = []
  for (const d of dates) {
    for (const e of await eventsOn(d.date, searchVenueIds)) {
      const reasons: string[] = [`date ${d.source}`]
      let score = d.weight
      let specific = false
      let guest = false

      const vh = venueHits.find((h) => h.venue.calendar_venue_id === e.venue_id)
      if (vh) { score += vh.strength; reasons.push(`venue: ${vh.via}`) }

      // Guest name: the more of it was said, the stronger the match.
      //   full name ("NP Singh")          → +6
      //   a distinctive part ("Baweja")   → +4
      //   only a common surname ("Singh") → +1 (shared by many guests)
      const guestTokens = (e.guest_name ?? '').split(/[^A-Za-z]+/).map(nameKey)
        .filter((x) => x.length >= 2 && !TITLES.has(x))
      const said = (gt: string) => latinTokens.some((tok) => tok === gt
        || (gt.length >= 5 && levenshtein(tok, gt) <= 1)
        || (gt.length >= 5 && skeleton(gt).length >= 3 && skeleton(tok) === skeleton(gt)))   // "maalaveey" = "malviya" (hidden "a")
        || (gt.length >= 5 && spokenKeys.has(gt))                                            // said in two parts
      const hit = guestTokens.filter(said)
      const distinctive = guestTokens.some((g) => g.length < 3 || !COMMON_SURNAMES.has(g))   // initials count as distinctive
      if (guestTokens.length && hit.length === guestTokens.length && distinctive) {
        score += 6; specific = true; guest = true; reasons.push(`guest name "${e.guest_name}"`)
      } else if (hit.some((h) => h.length >= 3 && !COMMON_SURNAMES.has(h))) {
        score += 4; specific = true; guest = true; reasons.push(`guest name "${e.guest_name}"`)
      } else if (hit.length) {
        score += hit.length === guestTokens.length ? 2 : 1     // e.g. guest "Sharma", and "Sharma" was said
        reasons.push(`part of guest name "${hit.join(' ')}"`)
      }

      const fn = (functionNameOf(e) ?? '').toLowerCase()
      const fnHit = Object.entries(FUNCTION_WORDS).find(([key, words]) =>
        [key, ...words].some((w) => fn.includes(w)) && saidAny([key, ...words]))
      if (fnHit) { score += 2; specific = true; reasons.push(`function "${functionNameOf(e)}"`) }

      const sh = shiftOf(e)
      const saidShifts = Object.keys(SHIFT_WORDS).filter((k) => saidAny(SHIFT_WORDS[k]))
      if (sh && saidShifts.includes(sh)) { score += 2; specific = true; reasons.push(`shift "${sh}"`) }
      else if (sh && saidShifts.length) { score -= 2; reasons.push(`said ${saidShifts.join('/')} but this is ${sh}`) }

      const subHit = (e.sub_venue ?? '').split('+').map((s) => normalize(s).trim()).find((s) => s.length >= 4 && (has(t, s) || saidAloud(s)))
      if (subHit) { score += 2; specific = true; reasons.push(`area "${subHit}"`) }

      const prev = scored.find((s) => s.e.id === e.id)
      if (prev) { if (score > prev.score) Object.assign(prev, { on: d.date, score, reasons, specific, guest }) }
      else scored.push({ e, on: d.date, score, reasons, specific, guest })
    }
  }
  scored.sort((a, b) => b.score - a.score)

  const summary = (s: (typeof scored)[number]) => ({
    calendar_event_id: s.e.id, date: s.on, title: s.e.title, guest_name: s.e.guest_name,
    function_name: functionNameOf(s.e), shift: shiftOf(s.e), time: s.e.time, sub_venue: s.e.sub_venue,
    calendar_venue_id: s.e.venue_id, venue_id: venueByCal.get(s.e.venue_id)?.id ?? null,
    venue_name: venueByCal.get(s.e.venue_id)?.venue_name ?? s.e.venue_id, score: s.score, reasons: s.reasons,
  })

  const venue = venueHits.length === 1 ? { id: venueHits[0].venue.id, name: venueHits[0].venue.venue_name } : null
  const base = {
    date: dates[0].date,
    date_source: dateSaid ? (explicit ? 'explicit' : 'relative') : hinted ? 'from_recording' : 'assumed_today',
    venue,
    venue_candidates: venueHits.map((h) => ({ id: h.venue.id, name: h.venue.venue_name, via: h.via })),
    candidates: scored.slice(0, 10).map(summary),   // up to 10, so the recorder can pick when it is unclear
  }

  if (!scored.length) {
    return { ...base, status: 'no_events', event: null,
      reasons: [dateSaid
        ? 'No booking found in the Calendar for the date and venue mentioned.'
        : `No booking found ${lateNight ? 'today or last night' : 'today'}${venueHits.length ? ' at this venue' : ''}. If it was another day, say the day (e.g. "kal").`] }
  }
  const [top, second] = scored
  // Accept only a clear winner:
  //   • the ONLY booking that fits (at the venue said, or the only one in the
  //     whole company that day when no venue was said), or
  //   • ahead of the next booking by a real margin.
  if (scored.length === 1) {
    const why = venueHits.length || top.specific ? top.reasons : [...top.reasons, 'the only booking that day at any venue']
    return { ...base, status: 'matched', event: { ...summary(top), reasons: why }, date: top.on, reasons: why }
  }
  const lead = top.score - second.score
  const clear = (lead >= 2 && top.specific) || lead >= 3
  if (clear) return { ...base, status: 'matched', event: summary(top), date: top.on, reasons: top.reasons }
  return { ...base, status: 'ambiguous', event: null,
    reasons: [venueHits.length
      ? 'More than one booking fits what was said. Mention the guest name, function or lunch/dinner to tell them apart.'
      : 'The venue was not mentioned and there is more than one booking. Say the venue name (e.g. Pushpanjali).'] }
}


// ===========================================================================
// EDGE FUNCTION — HTTP handler, Calendar lookups
// ===========================================================================
const SUPABASE_URL = denoEnv('SUPABASE_URL')!
const SERVICE_KEY = denoEnv('SUPABASE_SERVICE_ROLE_KEY')!
const CAL_URL = (denoEnv('EVENT_CALENDAR_API_URL') ?? '').replace(/\/+$/, '')
const CAL_KEY = denoEnv('EVENT_CALENDAR_API_KEY') ?? ''
const TIMEOUT_MS = 12_000

const EVENT_FIELDS = [
  'id', 'venue_id', 'title', 'status', 'date', 'end_date', 'time', 'shift', 'sub_venue',
  'event_type', 'event_type_other', 'guest_name', 'pax', 'check_in_date', 'check_out_date', 'venue_name',
].join(',')

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
const allowedOrigins = (denoEnv('ALLOWED_ORIGINS') ?? '')
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

/** GET from the Calendar's REST API with a timeout. Throws on any non-2xx. */
async function calGet<T = unknown[]>(path: string): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${CAL_URL}/${path}`, {
      headers: { apikey: CAL_KEY, Authorization: `Bearer ${CAL_KEY}`, Accept: 'application/json' },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`Calendar HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return await res.json() as T
  } finally {
    clearTimeout(t)
  }
}

async function killSwitchOn(): Promise<boolean> {
  const ks = await calGet<{ value: string }[]>('app_settings?select=value&key=eq.kill_switch')
  return ks[0]?.value === 'on'
}

/** Bookings on one day (single-day + multi-day + villa stays), cancelled excluded. */
async function eventsOn(date: string, venueIds: string[]): Promise<CalEvent[]> {
  const venueFilter = venueIds.length ? `&venue_id=in.(${venueIds.join(',')})` : ''
  // neq alone would also drop rows whose status is empty, so keep those explicitly.
  const base = `events?select=${EVENT_FIELDS}&deleted_at=is.null&or=(status.is.null,status.neq.Cancelled)${venueFilter}`
  const [sameDay, spanning, villa] = await Promise.all([
    calGet<CalEvent[]>(`${base}&date=eq.${date}&order=time.asc&limit=200`),
    calGet<CalEvent[]>(`${base}&date=lt.${date}&end_date=gte.${date}&limit=100`),
    calGet<CalEvent[]>(`${base}&check_in_date=lt.${date}&check_out_date=gte.${date}&limit=100`),
  ])
  const seen = new Set<string>()
  return [...sameDay, ...spanning, ...villa].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const VENUE_ID_RE = /^[a-z0-9_]{1,20}$/

deno?.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return reply(origin, 405, { error: 'Method not allowed' })

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  // ---- Caller must be an active app user ------------------------------------
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  // Server-to-server: other functions (process-issue, cron) call with the
  // service-role key. That key never leaves Supabase.
  let me: { id: string | null; role: string; is_active: boolean } | null = null
  if (token && token === SERVICE_KEY) {
    me = { id: null, role: 'system', is_active: true }
  } else {
    const { data: caller } = await db.auth.getUser(token)
    if (!caller?.user) return reply(origin, 401, { error: 'Please sign in again.' })
    const { data: row } = await db.from('app_users').select('id, role, roles, is_active').eq('id', caller.user.id).maybeSingle()
    // role = primary role (admin first), so the admin check below stays correct with several roles.
    me = row
  }
  if (!me?.is_active) return reply(origin, 403, { error: 'Not allowed.' })

  if (!CAL_URL || !CAL_KEY) {
    return reply(origin, 503, { error: 'Event Calendar is not connected yet (EVENT_CALENDAR_API_URL / EVENT_CALENDAR_API_KEY secrets missing).', code: 'not_configured' })
  }

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return reply(origin, 400, { error: 'Invalid request.' }) }

  const started = Date.now()
  const log = (operation: string, ok: boolean, usage: Record<string, unknown>, error?: string) =>
    db.from('api_usage_log').insert({
      provider: 'event_calendar', operation, ok, latency_ms: Date.now() - started,
      usage, error: error?.slice(0, 500) ?? null, user_id: me.id,
    })

  try {
    if (body.action === 'categories') {
      if (me.role !== 'admin') return reply(origin, 403, { error: 'Only an admin can do this.' })
      const rows = await calGet('categories?select=venue_id,name,short_code,category_type,sub_venues,is_active,sort_order&order=sort_order')
      await log('list_categories', true, { rows: rows.length })
      return reply(origin, 200, { categories: rows })
    }

    if (body.action === 'events') {
      const date = String(body.date ?? '')
      if (!DATE_RE.test(date)) return reply(origin, 400, { error: 'Invalid date.' })
      const ids = Array.isArray(body.calendar_venue_ids)
        ? (body.calendar_venue_ids as unknown[]).map(String).filter((v) => VENUE_ID_RE.test(v)).slice(0, 20)
        : []
      if (await killSwitchOn()) {
        await log('list_events', true, { date, kill_switch: true })
        return reply(origin, 200, { events: [], kill_switch: true })
      }
      const events = await eventsOn(date, ids)
      await log('list_events', true, { date, venues: ids, rows: events.length })
      return reply(origin, 200, { events })
    }

    if (body.action === 'match') {
      const transcript = String(body.transcript ?? '').slice(0, 5000)
      if (!transcript.trim()) return reply(origin, 400, { error: 'Transcript is empty.' })
      const hint = typeof body.hint_date === 'string' && DATE_RE.test(body.hint_date) ? body.hint_date : null
      const { data: venueRows } = await db.from('venues')
        .select('id, venue_name, calendar_venue_id, sub_venues, aliases:venue_aliases(alias)').eq('is_active', true)
      const venues = (venueRows ?? []) as Venue[]
      const result = await matchEvent({ venues, killSwitchOn, eventsOn }, transcript, hint)
      await log('match_event', true, { status: result.status, candidates: (result as { candidates?: unknown[] }).candidates?.length ?? 0 })
      return reply(origin, 200, result)
    }

    return reply(origin, 400, { error: 'Unknown action.' })
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? 'Calendar timed out' : (e as Error).message
    console.error('event-calendar failed', msg)
    await log(String(body.action ?? 'unknown'), false, { body_action: body.action }, msg)
    return reply(origin, 502, { error: 'Could not reach the Event Calendar. The complaint can still be submitted; the event will be matched later.', retryable: true })
  }
})
