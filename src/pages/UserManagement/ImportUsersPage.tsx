// =============================================================================
// WHAT THIS FILE IS
//   Admin → Users → Import CSV. Steps on one page:
//     1. Upload    choose the file and a default role (template available)
//     1b. Filter   only when the file has a Department column (HR export):
//                  choose which departments to import; skip Inactive staff
//     2. Preview   every row with its generated username, warnings and errors;
//                  usernames and roles can be edited and rows ticked or unticked
//     3. Importing progress while rows are sent in batches of 25
//     4. Results   Total / Imported / Skipped / Failed, plus a CSV download of
//                  every skipped or failed row with the reason
// WHY IT EXISTS
//   Bulk onboarding without creating duplicates. All the rules are in
//   services/csvImportService.ts. This page only displays and edits them.
// USED BY
//   App.tsx route "/admin/users/import"
// =============================================================================
import { useMemo, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button, buttonClass } from '../../components/ui/Button'
import { Alert, Card, PageHeader } from '../../components/ui/Layout'
import { Spinner } from '../../components/ui/Spinner'
import { Badge } from '../../components/ui/Badge'
import { ChoiceRow, FilterSelect, SelectField, inputClass } from '../../components/ui/Field'
import { Icon } from '../../components/Icon'
import { ROLE_LABEL, type Role } from '../../types/auth'
import type { ImportResultRow, PreviewRow } from '../../types/users'
import {
  buildPreview, departmentsIn, fileHasStatus, filterParsed, parseCsvFile, revalidate, runImport,
  type ExcludedRow, type ParseResult,
} from '../../services/csvImportService'
import { listUsers } from '../../services/userAdminService'
import { downloadCsv, toCsv } from '../../utils/csv'

type Step = 'upload' | 'filter' | 'preview' | 'importing' | 'results'
type View = 'all' | 'included' | 'attention'

interface Existing { usernames: Set<string>; namesToUsernames: Map<string, string[]> }

const STATE_BADGE: Record<PreviewRow['state'], { tone: 'ok' | 'warn' | 'danger' | 'neutral'; label: string }> = {
  ready: { tone: 'ok', label: 'Ready' },
  warning: { tone: 'warn', label: 'Check' },
  error: { tone: 'danger', label: 'Fix' },
  blank: { tone: 'neutral', label: 'Blank' },
}

export function ImportUsersPage() {
  const [step, setStep] = useState<Step>('upload')
  const [defaultRole, setDefaultRole] = useState<Role>('recorder')
  const [fileName, setFileName] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [existing, setExisting] = useState<Existing | null>(null)
  const [view, setView] = useState<View>('all')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<ImportResultRow[]>([])
  // Department / status filter (only used when the file has those columns)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [departments, setDepartments] = useState<{ name: string; count: number }[]>([])
  const [selectedDepts, setSelectedDepts] = useState<Set<string>>(new Set())
  const [skipInactive, setSkipInactive] = useState(true)
  const [excluded, setExcluded] = useState<ExcludedRow[]>([])

  /** Build the preview from only the rows that pass the filter. */
  const applyFilter = (p: ParseResult, ex: Existing, depts: Set<string> | null, skip: boolean) => {
    const { kept, excluded: out } = filterParsed(p, { departments: depts, skipInactive: skip })
    setExcluded(out)
    setRows(kept.rows.length ? buildPreview(kept, ex, defaultRole) : [])
    setView('all')
    setStep('preview')
  }

  // ---- Step 1: read the file -------------------------------------------------
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be chosen again
    if (!file) return
    setFileError(null)
    setReading(true)
    setFileName(file.name)
    try {
      const parsed = await parseCsvFile(file)
      if (parsed.error) { setFileError(parsed.error); setReading(false); return }
      // Always fetch fresh, so users created since the page opened are counted.
      const users = await listUsers()
      const ex: Existing = { usernames: new Set(users.map((u) => u.username)), namesToUsernames: new Map() }
      for (const u of users) {
        const k = u.name.trim().toLowerCase().replace(/\s+/g, ' ')
        ex.namesToUsernames.set(k, [...(ex.namesToUsernames.get(k) ?? []), u.username])
      }
      setExisting(ex)
      setParsed(parsed)
      const depts = departmentsIn(parsed)
      setDepartments(depts)
      setSelectedDepts(new Set())
      // HR exports have a Department column → let the admin choose departments first.
      if (depts.length) setStep('filter')
      else applyFilter(parsed, ex, null, skipInactive)
    } catch (err) {
      setFileError((err as Error).message)
    }
    setReading(false)
  }

  const downloadTemplate = () => {
    downloadCsv('users-template.csv', toCsv(['Name', 'Mobile Number', 'Email', 'Username', 'Role'], [
      ['Rahul Sharma', '', '', '', ''],
      ['Priya Singh', '9876543210', '', '', 'POC'],
    ]))
  }

  // ---- Step 2: edits ---------------------------------------------------------
  const edit = (index: number, patch: Partial<PreviewRow>) => {
    if (!existing) return
    setRows((prev) => revalidate(prev.map((r) => (r.index === index ? { ...r, ...patch } : r)), existing))
  }

  const setAllIncluded = (include: boolean) => {
    if (!existing) return
    setRows((prev) => revalidate(prev.map((r) =>
      (r.state === 'error' || r.state === 'blank') ? r : { ...r, include }), existing))
  }

  const counts = useMemo(() => {
    const nonBlank = rows.filter((r) => r.state !== 'blank')
    return {
      total: rows.length,
      blank: rows.length - nonBlank.length,
      included: rows.filter((r) => r.include && r.state !== 'error').length,
      warnings: rows.filter((r) => r.state === 'warning').length,
      errors: rows.filter((r) => r.state === 'error').length,
    }
  }, [rows])

  const visible = useMemo(() => rows.filter((r) => {
    if (view === 'included') return r.include && r.state !== 'error'
    if (view === 'attention') return r.state === 'warning' || r.state === 'error'
    return r.state !== 'blank'
  }), [rows, view])

  // ---- Step 3: import --------------------------------------------------------
  const startImport = async () => {
    if (!counts.included) return
    setStep('importing')
    setProgress({ done: 0, total: counts.included })
    const res = await runImport(rows, excluded, (done, total) => setProgress({ done, total }))
    setResults(res)
    setStep('results')
  }

  // ---- Step 4: results -------------------------------------------------------
  const summary = useMemo(() => ({
    total: results.length,
    imported: results.filter((r) => r.outcome === 'imported').length,
    skipped: results.filter((r) => r.outcome === 'skipped').length,
    failed: results.filter((r) => r.outcome === 'failed').length,
  }), [results])

  const downloadProblems = () => {
    const bad = results.filter((r) => r.outcome !== 'imported')
    downloadCsv(`import-skipped-failed-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(['Line', 'Name', 'Username', 'Result', 'Reason'],
        bad.map((r) => [r.lineNumber, r.name, r.username, r.outcome, r.reason])))
  }

  const reset = () => {
    setStep('upload'); setRows([]); setResults([]); setFileName(''); setFileError(null)
    setParsed(null); setDepartments([]); setSelectedDepts(new Set()); setExcluded([])
  }

  const toggleDept = (name: string) => setSelectedDepts((prev) => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })
  const selectedCount = departments.filter((d) => selectedDepts.has(d.name)).reduce((n, d) => n + d.count, 0)

  // Steps as the admin sees them (department filter only appears when the file has departments).
  const STEPS: { key: Step[]; label: string }[] = [
    { key: ['upload'], label: 'Choose file' },
    ...(departments.length > 0 ? [{ key: ['filter'] as Step[], label: 'Departments' }] : []),
    { key: ['preview'], label: 'Review' },
    { key: ['importing', 'results'], label: 'Import' },
  ]
  const current = STEPS.findIndex((s) => s.key.includes(step))

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Import users"
        back={<Link to="/admin/users" className="inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-muted transition-colors hover:text-ink"><Icon name="arrowLeft" className="size-4" />Users</Link>}
        description="Add many people at once from a CSV file. Nothing is saved until you review and confirm." />

      {/* Progress through the steps */}
      <ol className="mb-6 flex items-center gap-2 overflow-x-auto text-sm" aria-label="Import steps">
        {STEPS.map((s, i) => {
          const done = i < current || step === 'results'
          const on = i === current && step !== 'results'
          return (
            <li key={s.label} className="flex shrink-0 items-center gap-2" aria-current={on ? 'step' : undefined}>
              {i > 0 && <span aria-hidden="true" className={`h-px w-6 sm:w-10 ${done || on ? 'bg-ink/40' : 'bg-line-strong'}`} />}
              <span className={`flex size-6 items-center justify-center rounded-full text-xs font-bold
                ${done ? 'bg-ok text-white' : on ? 'bg-ink text-white' : 'bg-ink/[0.07] text-muted'}`}>
                {done ? <Icon name="check" className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={`font-semibold ${on ? 'text-ink' : 'text-muted'}`}>{s.label}</span>
            </li>
          )
        })}
      </ol>

      {/* ------------------------------ STEP 1 ------------------------------ */}
      {step === 'upload' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Card className="p-5 md:p-6">
            <label className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-line-strong bg-subtle px-6 py-14 text-center transition-colors hover:border-ink/40 hover:bg-accent-soft/30 focus-within:border-ink/50 ${reading ? 'pointer-events-none opacity-60' : ''}`}>
              <span className="flex size-12 items-center justify-center rounded-full bg-surface text-accent shadow-card ring-1 ring-line">
                {reading ? <Spinner className="size-5" /> : <Icon name="upload" className="size-5" />}
              </span>
              <span className="mt-4 font-bold">{reading ? `Reading ${fileName}…` : 'Choose a CSV file'}</span>
              <span className="mt-1 text-sm text-muted">Nothing is saved until you review and confirm.</span>
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e)} />
            </label>
            {fileError && <Alert tone="danger" className="mt-4">{fileError}</Alert>}
            <div className="mt-5 max-w-xs">
              <SelectField label="Default role for imported users" value={defaultRole} onChange={(e) => setDefaultRole(e.target.value as Role)}>
                <option value="recorder">{ROLE_LABEL.recorder}</option>
                <option value="poc">{ROLE_LABEL.poc}</option>
              </SelectField>
            </div>
          </Card>

          <Card as="aside" className="p-5 text-sm md:p-6">
            <p className="font-bold">File format</p>
            <p className="mt-2 leading-relaxed text-muted">First row must be headers. Only <b className="text-ink">Name</b> is required.</p>
            <p className="mt-1.5 leading-relaxed text-muted">Optional: Mobile Number, Email, Username, Role (Recording User or POC).</p>
            <ul className="mt-4 space-y-2.5 border-t border-line pt-4 text-muted">
              {[
                <>Usernames are made from names: Rahul Sharma → <span className="font-semibold text-ink">rahul.sharma</span></>,
                <>Everyone gets PIN <b className="text-ink">0000</b> and must change it.</>,
                <>People already in the system are skipped by default.</>,
                <>Admin access is never given from a file.</>,
              ].map((t, i) => (
                <li key={i} className="flex gap-2.5 leading-relaxed"><Icon name="check" className="mt-0.5 size-4 shrink-0 text-ok" /><span>{t}</span></li>
              ))}
            </ul>
            <Button variant="secondary" className="mt-5 w-full" onClick={downloadTemplate}><Icon name="download" />Download template</Button>
          </Card>
        </div>
      )}

      {/* --------------------------- STEP 1b: FILTER --------------------------- */}
      {step === 'filter' && parsed && existing && (
        <Card className="max-w-2xl p-5 md:p-6">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted"><Icon name="file" className="size-3.5" />{fileName} · {parsed.rows.length} rows</p>
          <h2 className="mt-2 text-lg font-bold">Which departments should be imported?</h2>
          <p className="mt-0.5 text-sm text-muted">Only people in the ticked departments are imported. Everyone else is listed as Skipped.</p>

          <div className="mt-4 flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setSelectedDepts(new Set(departments.map((d) => d.name)))}>Select all</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedDepts(new Set())}>Clear</Button>
          </div>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {departments.map((d) => (
              <ChoiceRow key={d.name} checked={selectedDepts.has(d.name)} onChange={() => toggleDept(d.name)}
                title={<span className="font-medium">{d.name}</span>}
                trailing={<span className="text-xs font-semibold tabular-nums text-muted">{d.count}</span>} />
            ))}
          </div>

          {fileHasStatus(parsed) && (
            <div className="mt-4">
              <ChoiceRow checked={skipInactive} onChange={setSkipInactive} title="Skip people marked Inactive" description="Uses the Status column in the file." />
            </div>
          )}

          <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-line pt-5">
            <Button variant="secondary" onClick={reset}>Choose another file</Button>
            <Button disabled={!selectedDepts.size} onClick={() => applyFilter(parsed, existing, selectedDepts, skipInactive)}>
              Continue with {selectedCount} {selectedCount === 1 ? 'person' : 'people'}
            </Button>
          </div>
        </Card>
      )}

      {/* ------------------------------ STEP 2 ------------------------------ */}
      {step === 'preview' && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5 font-semibold text-ink"><Icon name="file" className="size-4 text-muted" />{fileName}</span>
            <span>{counts.total} rows{excluded.length ? ` selected (${excluded.length} filtered out)` : ''}</span>
            {departments.length > 0 && (
              <button type="button" onClick={() => setStep('filter')} className="font-semibold text-ink underline-offset-2 hover:underline">
                {[...selectedDepts].join(', ') || 'All'}{skipInactive && fileHasStatus(parsed!) ? ' · Inactive skipped' : ''} · Change
              </button>
            )}
            {counts.blank > 0 && <span>{counts.blank} blank</span>}
            <Badge tone="warn" dot>{counts.warnings} to check</Badge>
            <Badge tone="danger" dot>{counts.errors} to fix</Badge>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <FilterSelect label="Show rows" value={view} onChange={(e) => setView(e.target.value as View)} className="w-auto">
                <option value="all">All rows</option>
                <option value="attention">Need attention ({counts.warnings + counts.errors})</option>
                <option value="included">Ticked ({counts.included})</option>
              </FilterSelect>
              <Button variant="ghost" onClick={() => setAllIncluded(true)}>Tick all</Button>
              <Button variant="ghost" onClick={() => setAllIncluded(false)}>Untick all</Button>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={reset}>Choose another file</Button>
              <Button disabled={!counts.included} onClick={() => void startImport()}>
                Import {counts.included} user{counts.included === 1 ? '' : 's'}
              </Button>
            </div>
          </div>

          <Card className="mt-4 overflow-hidden">
            <div className="hidden grid-cols-[28px_52px_1.2fr_1fr_170px_1.6fr] gap-3 border-b border-line bg-subtle px-4 py-2.5 text-xs font-semibold text-muted md:grid">
              <span /><span>Line</span><span>Name</span><span>Username</span><span>Role</span><span>Status</span>
            </div>
            <ul className="divide-y divide-line">
              {visible.map((r) => (
                <li key={r.index} className={`grid gap-3 px-4 py-3 md:grid-cols-[28px_52px_1.2fr_1fr_170px_1.6fr] md:items-start ${r.include ? '' : 'bg-subtle/70'}`}>
                  <input type="checkbox" aria-label={`Include ${r.name || 'row ' + r.lineNumber}`}
                    checked={r.include && r.state !== 'error'} disabled={r.state === 'error'}
                    onChange={(e) => edit(r.index, { include: e.target.checked })}
                    className="mt-2.5 size-4 cursor-pointer accent-ink disabled:opacity-40" />
                  <span className="hidden pt-2 text-xs tabular-nums text-muted md:block">{r.lineNumber}</span>
                  <div className="min-w-0 pt-1.5">
                    <p className="truncate font-semibold">{r.name || <span className="font-normal text-muted">(no name)</span>}</p>
                    <p className="text-xs text-muted md:hidden">Line {r.lineNumber}</p>
                    {(r.mobile_number || r.email) && <p className="truncate text-xs text-muted">{[r.mobile_number, r.email].filter(Boolean).join(' · ')}</p>}
                  </div>
                  <input aria-label="Username" value={r.username} spellCheck={false} autoCapitalize="none" aria-invalid={r.state === 'error'}
                    onChange={(e) => edit(r.index, { username: e.target.value.toLowerCase().trim(), usernameWasGenerated: false })}
                    className={inputClass('md', 'h-9 text-[13px]')} />
                  <select aria-label="Role" value={r.role} onChange={(e) => edit(r.index, { role: e.target.value as Role })}
                    className={inputClass('md', 'h-9 cursor-pointer')}>
                    {(Object.keys(ROLE_LABEL) as Role[]).map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
                  </select>
                  <div className="space-y-1 pt-1.5">
                    <Badge tone={STATE_BADGE[r.state].tone} dot>{STATE_BADGE[r.state].label}</Badge>
                    {r.messages.map((m, i) => (
                      <p key={i} className={`text-xs leading-relaxed ${m.level === 'error' ? 'text-danger' : 'text-muted'}`}>{m.text}</p>
                    ))}
                  </div>
                </li>
              ))}
              {visible.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted">No rows in this view.</li>}
            </ul>
          </Card>
        </>
      )}

      {/* ------------------------------ STEP 3 ------------------------------ */}
      {step === 'importing' && (
        <Card className="mx-auto max-w-lg p-8 text-center">
          <Spinner className="size-7 text-ink" />
          <p className="mt-4 font-bold">Importing {progress.done} of {progress.total}…</p>
          <p className="mt-1 text-sm text-muted">Keep this page open until it finishes.</p>
          <div className="mx-auto mt-5 h-1.5 max-w-sm overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-marigold transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </Card>
      )}

      {/* ------------------------------ STEP 4 ------------------------------ */}
      {step === 'results' && (
        <>
          <Card className="grid grid-cols-2 gap-px overflow-hidden bg-line md:grid-cols-4">
            {[
              { label: 'Total records', value: summary.total, cls: 'text-ink' },
              { label: 'Imported', value: summary.imported, cls: 'text-ok' },
              { label: 'Skipped', value: summary.skipped, cls: summary.skipped ? 'text-warn' : 'text-ink' },
              { label: 'Failed', value: summary.failed, cls: summary.failed ? 'text-danger' : 'text-ink' },
            ].map((c) => (
              <div key={c.label} className="bg-surface px-5 py-4">
                <p className="text-[13px] font-semibold text-muted">{c.label}</p>
                <p className={`mt-1 text-[1.75rem] font-bold leading-tight tabular-nums ${c.cls}`}>{c.value}</p>
              </div>
            ))}
          </Card>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/admin/users" className={buttonClass('primary')}>Go to users</Link>
            <Button variant="secondary" onClick={reset}>Import another file</Button>
            {summary.skipped + summary.failed > 0 && (
              <Button variant="secondary" onClick={downloadProblems}>
                <Icon name="download" />Download skipped and failed ({summary.skipped + summary.failed})
              </Button>
            )}
          </div>

          {summary.failed > 0 && (
            <Card className="mt-5 divide-y divide-line overflow-hidden">
              <p className="bg-subtle px-4 py-2.5 text-xs font-semibold text-muted">Failed rows</p>
              {results.filter((r) => r.outcome === 'failed').map((r) => (
                <div key={r.lineNumber} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm">
                  <span><span className="text-muted">Line {r.lineNumber}</span> · <span className="font-semibold">{r.name}</span> <span className="text-xs text-muted">{r.username}</span></span>
                  <span className="text-danger">{r.reason}</span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  )
}
