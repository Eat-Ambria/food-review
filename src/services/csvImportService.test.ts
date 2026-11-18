import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./userAdminService', () => ({ createUsers: vi.fn() }))
import { createUsers } from './userAdminService'
import {
  parseCsvFile, usernameFromName, departmentsIn, fileHasStatus, filterParsed,
  buildPreview, revalidate, runImport, MAX_ROWS, type ParseResult,
} from './csvImportService'
import type { PreviewRow } from '../types/users'

const csvFile = (text: string, name = 'staff.csv') => new File([text], name, { type: 'text/csv' })
const noExisting = () => ({ usernames: new Set<string>(), namesToUsernames: new Map<string, string[]>() })
const parsed = (rows: ParseResult['rows']): ParseResult => ({ rows, lineNumbers: rows.map((_, i) => i + 2), columnsFound: ['name'] })

describe('usernameFromName', () => {
  it.each([
    ['Rahul Sharma', 'rahul.sharma'],
    ['  Rahul   Sharma ', 'rahul.sharma'],
    ['Dr. R.K. Singh', 'dr.r.k.singh'],
    ['José Álvarez', 'jose.alvarez'],
    ["O'Brien-Smith", 'o.brien.smith'],
    ['राहुल', ''],
  ])('%s -> %s', (name, expected) => {
    expect(usernameFromName(name)).toBe(expected)
  })

  it('caps at 60 chars and never ends with a dot', () => {
    const u = usernameFromName('a'.repeat(59) + ' bbbb')
    expect(u.length).toBeLessThanOrEqual(60)
    expect(u.endsWith('.')).toBe(false)
  })
})

describe('parseCsvFile', () => {
  it('reads Name plus optional columns with flexible headers', async () => {
    const r = await parseCsvFile(csvFile('﻿Full Name,Mobile No.,E-mail,Role\nRahul Sharma,9876543210,r@x.com,Staff\n'))
    expect(r.error).toBeUndefined()
    expect(r.rows).toEqual([{ name: 'Rahul Sharma', mobile: '9876543210', email: 'r@x.com', role: 'Staff' }])
    expect(r.lineNumbers).toEqual([2])
  })

  it('rejects a non-csv file', async () => {
    const r = await parseCsvFile(new File(['x'], 'staff.xlsx', { type: 'application/vnd.ms-excel' }))
    expect(r.error).toMatch(/\.csv/)
  })

  it('rejects files over 1 MB', async () => {
    const r = await parseCsvFile(csvFile('Name\n' + 'x'.repeat(1_000_001)))
    expect(r.error).toMatch(/1 MB/)
  })

  it('requires a Name column', async () => {
    const r = await parseCsvFile(csvFile('Phone,Email\n1,a@b.c\n'))
    expect(r.error).toMatch(/Name/)
    expect(r.columnsFound).toEqual(['phone', 'email'])
  })

  it('errors on header-only file', async () => {
    expect((await parseCsvFile(csvFile('Name\n'))).error).toMatch(/no rows/)
  })

  it('keeps blank lines in the middle (with correct line numbers) and drops trailing ones', async () => {
    const r = await parseCsvFile(csvFile('Name\nA\n\nB\n\n\n'))
    expect(r.rows.map((x) => x.name ?? '')).toEqual(['A', '', 'B'])
    expect(r.lineNumbers).toEqual([2, 3, 4])
  })

  it(`rejects more than ${MAX_ROWS} rows`, async () => {
    const body = Array.from({ length: MAX_ROWS + 1 }, (_, i) => `P${i}`).join('\n')
    expect((await parseCsvFile(csvFile('Name\n' + body))).error).toMatch(/maximum/)
  })
})

describe('departments / status filter', () => {
  const p = parsed([
    { name: 'A', department: 'Kitchen', status: 'Active' },
    { name: 'B', department: 'Sales', status: 'Inactive' },
    { name: 'C', department: 'Kitchen', status: 'inactive' },
    { name: 'D' },
  ])

  it('departmentsIn counts and sorts', () => {
    expect(departmentsIn(p)).toEqual([{ name: 'Kitchen', count: 2 }, { name: 'Sales', count: 1 }])
  })

  it('fileHasStatus', () => {
    expect(fileHasStatus(p)).toBe(true)
    expect(fileHasStatus(parsed([{ name: 'X' }]))).toBe(false)
  })

  it('filters by department and inactive status', () => {
    const { kept, excluded } = filterParsed(p, { departments: new Set(['Kitchen']), skipInactive: true })
    expect(kept.rows.map((r) => r.name)).toEqual(['A'])
    expect(kept.lineNumbers).toEqual([2])
    expect(excluded.map((x) => [x.name, x.reason])).toEqual([
      ['B', 'Department "Sales" not selected'],
      ['C', 'Inactive in the file'],
      ['D', 'Department "(none)" not selected'],
    ])
  })

  it('keeps everything when no filter is set', () => {
    const { kept, excluded } = filterParsed(p, { departments: null, skipInactive: false })
    expect(kept.rows).toHaveLength(4)
    expect(excluded).toHaveLength(0)
  })
})

describe('buildPreview', () => {
  it('generates unique usernames against the DB and within the file', () => {
    const existing = { usernames: new Set(['rahul.sharma']), namesToUsernames: new Map<string, string[]>() }
    const rows = buildPreview(parsed([{ name: 'Rahul Sharma' }, { name: 'Rahul  sharma' }]), existing, 'recorder')
    expect(rows.map((r) => r.username)).toEqual(['rahul.sharma2', 'rahul.sharma3'])
    expect(rows.every((r) => r.usernameWasGenerated)).toBe(true)
    // same name twice -> warning on both, both kept
    expect(rows.map((r) => r.state)).toEqual(['warning', 'warning'])
    expect(rows.every((r) => r.include)).toBe(true)
  })

  it('never grants Admin from the file', () => {
    const [r] = buildPreview(parsed([{ name: 'Boss', role: 'Admin' }]), noExisting(), 'recorder')
    expect(r.role).toBe('recorder')
    expect(r.state).toBe('warning')
    expect(r.messages[0].text).toMatch(/Admin/)
  })

  it('maps known roles and falls back on unknown ones', () => {
    const rows = buildPreview(parsed([
      { name: 'A', role: 'Manager' }, { name: 'B', role: 'POC' }, { name: 'C', role: 'Chef' }, { name: 'D' },
    ]), noExisting(), 'poc')
    expect(rows.map((r) => r.role)).toEqual(['recorder', 'poc', 'poc', 'poc'])
    expect(rows[2].messages.some((m) => /Unknown role/.test(m.text))).toBe(true)
  })

  it('unticks a name that already exists in the DB', () => {
    const existing = { usernames: new Set<string>(), namesToUsernames: new Map([['rahul sharma', ['rahul.sharma']]]) }
    const [r] = buildPreview(parsed([{ name: 'Rahul Sharma' }]), existing, 'recorder')
    expect(r.include).toBe(false)
    expect(r.state).toBe('warning')
  })

  it('flags missing names, unusable names and bad usernames as errors', () => {
    const rows = buildPreview(parsed([
      { mobile: '123' }, { name: 'राहुल' }, { name: 'X', username: 'Bad Name!' },
    ]), noExisting(), 'recorder')
    expect(rows.map((r) => r.state)).toEqual(['error', 'error', 'error'])
    expect(rows.map((r) => r.include)).toEqual([false, false, true])
  })

  it('marks blank rows', () => {
    const [r] = buildPreview(parsed([{}]), noExisting(), 'recorder')
    expect(r.state).toBe('blank')
    expect(r.include).toBe(false)
  })

  it('warns on an invalid-looking email but does not block', () => {
    const [r] = buildPreview(parsed([{ name: 'A', email: 'not-an-email' }]), noExisting(), 'recorder')
    expect(r.state).toBe('warning')
    expect(r.email).toBe('not-an-email')
  })
})

describe('revalidate', () => {
  it('detects a username typed twice and clears once fixed', () => {
    let rows = buildPreview(parsed([{ name: 'A', username: 'same' }, { name: 'B', username: 'same' }]), noExisting(), 'recorder')
    expect(rows.map((r) => r.state)).toEqual(['error', 'error'])
    rows = revalidate(rows.map((r, i) => (i === 1 ? { ...r, username: 'other' } : r)), noExisting())
    expect(rows.map((r) => r.state)).toEqual(['ready', 'ready'])
  })

  it('an unticked duplicate does not block the ticked one', () => {
    let rows = buildPreview(parsed([{ name: 'A', username: 'same' }, { name: 'B', username: 'same' }]), noExisting(), 'recorder')
    rows = revalidate(rows.map((r, i) => (i === 1 ? { ...r, include: false } : r)), noExisting())
    expect(rows[0].state).toBe('ready')
  })

  it('rejects a username already in the DB', () => {
    const rows = buildPreview(parsed([{ name: 'A', username: 'taken' }]), noExisting(), 'recorder')
    const out = revalidate(rows, { usernames: new Set(['taken']), namesToUsernames: new Map() })
    expect(out[0].state).toBe('error')
    expect(out[0].messages[0].text).toMatch(/already exists/)
  })

  it('requires a username after the admin clears it', () => {
    const rows = buildPreview(parsed([{ name: 'A' }]), noExisting(), 'recorder')
    const out = revalidate([{ ...rows[0], username: '' }], noExisting())
    expect(out[0].messages[0].text).toBe('Username is required')
  })
})

describe('runImport', () => {
  const mocked = vi.mocked(createUsers)
  beforeEach(() => { mocked.mockReset() })

  const row = (i: number, over: Partial<PreviewRow> = {}): PreviewRow => ({
    index: i, lineNumber: i + 2, name: `P${i}`, username: `p${i}`, usernameWasGenerated: true, role: 'recorder',
    mobile_number: null, email: null, include: true, state: 'ready', parseErrors: [], parseNotes: [], messages: [], ...over,
  })

  it('sends ticked rows in chunks of 25 and reports every row', async () => {
    mocked.mockImplementation(async (rows) => rows.map((r) => ({ index: r.index, ok: r.index !== 3, error: r.index === 3 ? 'boom' : undefined })))
    const rows = Array.from({ length: 30 }, (_, i) => row(i))
    rows[5] = row(5, { include: false })
    rows[6] = row(6, { state: 'error', messages: [{ text: 'bad', level: 'error' }] })
    rows[7] = row(7, { state: 'blank' })
    const progress: [number, number][] = []
    const res = await runImport(rows, [{ lineNumber: 100, name: 'X', reason: 'Inactive in the file' }], (d, t) => progress.push([d, t]))

    expect(mocked).toHaveBeenCalledTimes(2)
    expect(mocked.mock.calls[0][0]).toHaveLength(25)
    expect(mocked.mock.calls[1][0]).toHaveLength(2)
    expect(mocked.mock.calls[0][0][0]).toEqual({ index: 0, name: 'P0', username: 'p0', roles: ['recorder'], mobile_number: null, email: null })
    expect(progress).toEqual([[25, 27], [27, 27]])

    const by = (ln: number) => res.find((r) => r.lineNumber === ln)!
    expect(by(2).outcome).toBe('imported')
    expect(by(5)).toMatchObject({ outcome: 'failed', reason: 'boom' })
    expect(by(7)).toMatchObject({ outcome: 'skipped', reason: 'Not ticked by admin' })
    expect(by(8)).toMatchObject({ outcome: 'skipped', reason: 'bad' })
    expect(by(9)).toMatchObject({ outcome: 'skipped', reason: 'Blank row' })
    expect(by(100)).toMatchObject({ outcome: 'skipped', reason: 'Inactive in the file' })
    expect(res.map((r) => r.lineNumber)).toEqual([...res.map((r) => r.lineNumber)].sort((a, b) => a - b))
  })

  it('marks rows the server did not answer as failed', async () => {
    mocked.mockResolvedValue([])
    const res = await runImport([row(0)], [], () => {})
    expect(res[0]).toMatchObject({ outcome: 'failed', reason: 'No response from server for this row' })
  })
})
