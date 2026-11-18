// =============================================================================
// WHAT THIS FILE IS
//   The CSV import logic: read the file, build the preview, generate unique
//   usernames, flag duplicates, then send the approved rows to the server.
// WHY IT EXISTS
//   The Admin uploads a staff list (at minimum a "Name" column) instead of
//   creating 100 accounts by hand. The rules:
//   • Only "Name" is required. Mobile Number / Email / Username / Role are
//     optional and are read when present (header case and spacing don't matter).
//   • Usernames: "Rahul Sharma" → rahul.sharma. If taken (in the database or
//     earlier in the same file), the next free number is added: rahul.sharma2…
//   • Same name twice in the file → WARNING, both kept. They may be two
//     different people, so the admin decides.
//   • Name already in the database → WARNING and UNTICKED by default. This is
//     what makes re-uploading the same CSV safe (no duplicate accounts).
//   • A CSV that says "Admin" is NOT given admin. It is imported as a Recording
//     User with a warning, and the admin must pick Admin by hand.
//   • If the file has Department / Status columns (e.g. an HR export), the
//     admin can import only some departments and skip Inactive staff.
//     Filtered-out rows are listed as Skipped in the results.
//   • Blank lines are skipped. Rows with problems (no name, bad username)
//     cannot be ticked until they are fixed.
//   The server checks everything again. This file only makes the preview useful.
// USED BY
//   pages/UserManagement/ImportUsersPage.tsx
// DEPENDS ON
//   papaparse, services/userAdminService.ts
// =============================================================================
import Papa from 'papaparse'
import type { Role } from '../types/auth'
import type { ImportResultRow, NewUserInput, PreviewRow } from '../types/users'
import { createUsers } from './userAdminService'

export const MAX_FILE_BYTES = 1_000_000
export const MAX_ROWS = 2000
const CHUNK_SIZE = 25
const USERNAME_RE = /^[a-z0-9]+(\.[a-z0-9]+)*$/

// Header spellings we accept → our field name.
const HEADER_MAP: Record<string, keyof RawRow> = {
  name: 'name', fullname: 'name', employeename: 'name', employee: 'name',
  mobilenumber: 'mobile', mobile: 'mobile', mobileno: 'mobile', phone: 'mobile', phonenumber: 'mobile', contact: 'mobile',
  email: 'email', emailid: 'email', emailaddress: 'email', mail: 'email',
  username: 'username', userid: 'username', login: 'username',
  role: 'role', userrole: 'role',
  // Used only to FILTER which rows to import (e.g. only "Venue Sales", skip Inactive).
  department: 'department', dept: 'department', team: 'department',
  status: 'status', employeestatus: 'status',
}

interface RawRow {
  name?: string; mobile?: string; email?: string; username?: string; role?: string
  department?: string; status?: string
}

export interface ParseResult {
  rows: RawRow[]
  lineNumbers: number[]
  error?: string
  columnsFound: string[]
}

/** Read and check the file. Does not touch the database. */
export function parseCsvFile(file: File): Promise<ParseResult> {
  return new Promise((resolve) => {
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      resolve({ rows: [], lineNumbers: [], columnsFound: [], error: 'Please choose a .csv file. In Excel, use File → Save As → CSV.' })
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      resolve({ rows: [], lineNumbers: [], columnsFound: [], error: 'File is larger than 1 MB. Split it into smaller files.' })
      return
    }
    // Read as UTF-8 text first (keeps Hindi names intact), then parse the text.
    file.text().then((text) => Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: false,          // keep blanks so we can report them by line number
      transformHeader: (h) => h.toLowerCase().replace(/[^a-z]/g, ''), // also strips Excel's invisible BOM
      complete: (res) => {
        const headers = (res.meta.fields ?? [])
        const mapped = headers.map((h) => HEADER_MAP[h]).filter(Boolean)
        if (!mapped.includes('name')) {
          resolve({ rows: [], lineNumbers: [], columnsFound: headers,
            error: 'The file needs a "Name" column in the first row. Found: ' + (headers.join(', ') || 'nothing') })
          return
        }
        const rows: RawRow[] = []
        const lineNumbers: number[] = []
        res.data.forEach((rec, i) => {
          const r: RawRow = {}
          for (const [h, v] of Object.entries(rec)) {
            const key = HEADER_MAP[h]
            if (key && typeof v === 'string' && !r[key]) r[key] = v.trim()
          }
          rows.push(r)
          lineNumbers.push(i + 2) // +1 for header, +1 for 1-based
        })
        // Papaparse adds one empty record for the file's final newline; drop trailing blanks.
        while (rows.length && isBlank(rows[rows.length - 1])) { rows.pop(); lineNumbers.pop() }
        if (rows.length === 0) {
          resolve({ rows, lineNumbers, columnsFound: headers, error: 'The file has a header but no rows.' })
          return
        }
        if (rows.length > MAX_ROWS) {
          resolve({ rows: [], lineNumbers: [], columnsFound: headers,
            error: `The file has ${rows.length} rows. The maximum is ${MAX_ROWS}; please split it.` })
          return
        }
        resolve({ rows, lineNumbers, columnsFound: headers })
      },
      error: () => resolve({ rows: [], lineNumbers: [], columnsFound: [], error: 'Could not read the file.' }),
    })).catch(() => resolve({ rows: [], lineNumbers: [], columnsFound: [], error: 'Could not read the file.' }))
  })
}

function isBlank(r: RawRow): boolean {
  return !r.name && !r.mobile && !r.email && !r.username && !r.role
}

/** "Rahul  Sharma" → "rahul.sharma"; "Dr. R.K. Singh" → "dr.r.k.singh". Returns '' if nothing usable (e.g. Devanagari only). */
export function usernameFromName(name: string): string {
  return name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // é → e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('.')
    .slice(0, 60)
    .replace(/\.+$/, '')
}

/** First free username: base, base2, base3… */
function uniqueUsername(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`
}

function mapRole(raw: string | undefined, fallback: Role): { role: Role; note?: string } {
  const v = (raw ?? '').trim().toLowerCase()
  if (!v) return { role: fallback }
  // HR job levels (staff/manager/supervisor) are not app roles; they all record issues.
  if (['recorder', 'recording user', 'recording', 'user', 'staff', 'employee', 'manager', 'supervisor'].includes(v)) return { role: 'recorder' }
  if (['poc', 'point of contact'].includes(v)) return { role: 'poc' }
  if (v === 'admin' || v === 'administrator') {
    return { role: 'recorder', note: 'File says Admin. Imported as Recording User for safety; change the role here if they really need Admin.' }
  }
  return { role: fallback, note: `Unknown role "${raw}". Using the default role.` }
}

// ---- Department / status filter ---------------------------------------------

export interface ExcludedRow { lineNumber: number; name: string; reason: string }

/** Distinct, non-empty departments in the file with their row counts (for the filter). */
export function departmentsIn(parsed: ParseResult): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const r of parsed.rows) {
    const d = r.department?.trim()
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name))
}

export const fileHasStatus = (parsed: ParseResult) => parsed.rows.some((r) => r.status?.trim())

/**
 * Keeps only rows in the chosen departments (null = all) and, optionally,
 * drops rows whose Status column says Inactive. Everything removed is
 * reported as Skipped in the results, with the reason.
 */
export function filterParsed(
  parsed: ParseResult,
  opts: { departments: Set<string> | null; skipInactive: boolean },
): { kept: ParseResult; excluded: ExcludedRow[] } {
  const kept: ParseResult = { ...parsed, rows: [], lineNumbers: [] }
  const excluded: ExcludedRow[] = []
  parsed.rows.forEach((r, i) => {
    const lineNumber = parsed.lineNumbers[i]
    const name = (r.name ?? '').trim()
    if (opts.departments && !opts.departments.has(r.department?.trim() ?? '')) {
      excluded.push({ lineNumber, name, reason: `Department "${r.department || '(none)'}" not selected` })
    } else if (opts.skipInactive && /^inactive$/i.test(r.status?.trim() ?? '')) {
      excluded.push({ lineNumber, name, reason: 'Inactive in the file' })
    } else {
      kept.rows.push(r)
      kept.lineNumbers.push(lineNumber)
    }
  })
  return { kept, excluded }
}

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Builds the first version of the preview. */
export function buildPreview(
  parsed: ParseResult,
  existing: { usernames: Set<string>; namesToUsernames: Map<string, string[]> },
  defaultRole: Role,
): PreviewRow[] {
  const taken = new Set(existing.usernames)
  const rows: PreviewRow[] = parsed.rows.map((r, i) => {
    const lineNumber = parsed.lineNumbers[i]
    if (isBlank(r)) {
      return { index: i, lineNumber, name: '', username: '', usernameWasGenerated: false, role: defaultRole,
        mobile_number: null, email: null, include: false, state: 'blank', parseErrors: [], parseNotes: [], messages: [{ text: 'Blank row', level: 'warning' }] }
    }
    const parseErrors: string[] = []
    const parseNotes: string[] = []
    const name = (r.name ?? '').replace(/\s+/g, ' ').trim()
    if (!name) parseErrors.push('Name is missing')
    if (name.length > 120) parseErrors.push('Name is longer than 120 characters')

    const { role, note } = mapRole(r.role, defaultRole)
    if (note) parseNotes.push(note)

    let username = ''
    let generated = false
    if (r.username) {
      username = r.username.trim().toLowerCase()
    } else if (name) {
      const base = usernameFromName(name)
      if (base) { username = uniqueUsername(base, taken); generated = true }
      else parseErrors.push('Could not make a username from this name. Type one in.')
    }
    if (username) taken.add(username)

    const email = r.email?.trim() || null
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) parseNotes.push(`Email "${email}" looks invalid; it will be saved as typed.`)

    const existingMatch = name ? existing.namesToUsernames.get(normName(name)) : undefined
    return {
      index: i, lineNumber, name, username, usernameWasGenerated: generated, role,
      mobile_number: r.mobile?.trim() || null, email,
      // Already in the database by name → skipped unless the admin ticks it.
      include: parseErrors.length === 0 && !existingMatch,
      state: 'ready', parseErrors, parseNotes, messages: [],
    }
  })
  return revalidate(rows, existing)
}

/**
 * Recomputes every row's state and messages. Called after every admin edit
 * (username, role, tick-box), so the preview is always accurate.
 */
export function revalidate(
  rows: PreviewRow[],
  existing: { usernames: Set<string>; namesToUsernames: Map<string, string[]> },
): PreviewRow[] {
  // Count names and usernames among rows that are not blank.
  const nameLines = new Map<string, number[]>()
  const usernameCount = new Map<string, number>()
  for (const r of rows) {
    if (r.state === 'blank') continue
    if (r.name) {
      const k = normName(r.name)
      nameLines.set(k, [...(nameLines.get(k) ?? []), r.lineNumber])
    }
    if (r.include && r.username) usernameCount.set(r.username, (usernameCount.get(r.username) ?? 0) + 1)
  }

  return rows.map((r) => {
    if (r.state === 'blank') return r
    const errors = [...r.parseErrors]
    const warnings = [...r.parseNotes]

    if (r.username) {
      if (r.username.length > 64 || !USERNAME_RE.test(r.username)) {
        errors.push('Username can only use lowercase letters, numbers and dots (e.g. rahul.sharma)')
      } else if (existing.usernames.has(r.username)) {
        errors.push(`Username "${r.username}" already exists`)
      } else if ((usernameCount.get(r.username) ?? 0) > 1) {
        errors.push(`Username "${r.username}" is used by more than one row in this file`)
      }
    } else if (!errors.some((e) => e.startsWith('Could not make'))) {
      errors.push('Username is required')
    }

    if (r.name) {
      const lines = nameLines.get(normName(r.name)) ?? []
      if (lines.length > 1) {
        warnings.push(`Same name on lines ${lines.join(', ')}. Make sure these are different people.`)
      }
      const inDb = existing.namesToUsernames.get(normName(r.name))
      if (inDb) {
        warnings.push(`A user with this name already exists (${inDb.join(', ')}). Left unticked so it isn't added twice; tick only if this is a different person.`)
      }
    }

    const state = errors.length ? 'error' : warnings.length ? 'warning' : 'ready'
    return {
      // include is the admin's intent and is kept as-is; rows in 'error' are
      // simply not imported (see runImport), and come back ticked once fixed.
      ...r, state,
      messages: [
        ...errors.map((text) => ({ text, level: 'error' as const })),
        ...warnings.map((text) => ({ text, level: 'warning' as const })),
      ],
    }
  })
}

/**
 * Sends ticked rows to the server in chunks of 25 and returns one result line
 * per row in the file (imported / skipped / failed + reason).
 */
export async function runImport(
  rows: PreviewRow[],
  excluded: ExcludedRow[],
  onProgress: (done: number, total: number) => void,
): Promise<ImportResultRow[]> {
  const toSend = rows.filter((r) => r.include && r.state !== 'error' && r.state !== 'blank')
  const outcome = new Map<number, { ok: boolean; error?: string }>()

  for (let i = 0; i < toSend.length; i += CHUNK_SIZE) {
    const chunk = toSend.slice(i, i + CHUNK_SIZE)
    const payload: NewUserInput[] = chunk.map((r) => ({
      index: r.index, name: r.name, username: r.username, roles: [r.role],
      mobile_number: r.mobile_number, email: r.email,
    }))
    const results = await createUsers(payload)
    for (const res of results) outcome.set(res.index, { ok: res.ok, error: res.error })
    onProgress(Math.min(i + chunk.length, toSend.length), toSend.length)
  }

  const filteredOut: ImportResultRow[] = excluded.map((x) => ({
    lineNumber: x.lineNumber, name: x.name, username: '', outcome: 'skipped', reason: x.reason,
  }))

  const fromPreview: ImportResultRow[] = rows.map((r) => {
    const base = { lineNumber: r.lineNumber, name: r.name, username: r.username }
    if (r.state === 'blank') return { ...base, outcome: 'skipped', reason: 'Blank row' }
    const o = outcome.get(r.index)
    if (o?.ok) return { ...base, outcome: 'imported', reason: '' }
    if (o) return { ...base, outcome: 'failed', reason: o.error ?? 'Unknown error' }
    if (toSend.some((s) => s.index === r.index)) {
      return { ...base, outcome: 'failed', reason: 'No response from server for this row' }
    }
    return { ...base, outcome: 'skipped', reason: r.messages.map((m) => m.text).join(' ') || 'Not ticked by admin' }
  })

  return [...fromPreview, ...filteredOut].sort((a, b) => a.lineNumber - b.lineNumber)
}
