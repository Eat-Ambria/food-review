// Admin dashboard: today's issues by venue, key numbers, issues by venue and department, and recordings that need attention.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteRecording, fetchAttention, fetchIssues, lastCronRun, retryProcessing, type AttentionItem, type FeedIssue, type JobRun } from '../../services/issueService'
import { Button, buttonClass } from '../../components/ui/Button'
import { Alert, Card, EmptyState, ListSkeleton, PageHeader, SectionHeader, Skeleton } from '../../components/ui/Layout'
import { Toast, useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { Icon } from '../../components/Icon'
import { personName } from '../../utils/personName'
import { CategoryChip } from '../../components/CategoryChip'
import { ItemTag } from '../../components/ItemTag'
import { Modal } from '../../components/ui/Modal'
import { itemKey } from '../../utils/itemGroups'
import { displayItem } from '../../utils/itemName'

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const minusDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }

function Stat({ label, full, value, hint, tone }: { label: string; full: string; value: number | null; hint?: string; tone?: 'warn' | 'danger' }) {
  const hot = tone && value !== null && value > 0
  return (
    <div className="min-w-0 bg-surface px-5 py-4 md:px-3.5 lg:px-5" title={full}>
      <p className="truncate whitespace-nowrap text-[15px] font-semibold text-ink/80">{label}</p>
      {value === null
        ? <Skeleton className="mt-2 h-8 w-12" />
        : <p className={`mt-1.5 font-serif text-[2.4rem] font-normal leading-none tabular-nums tracking-[-0.02em] ${hot ? (tone === 'danger' ? 'text-danger' : 'text-warn') : 'text-ink'}`}>{value}</p>}
      {hint && <p className="mt-0.5 truncate whitespace-nowrap text-xs text-faint">{hint}</p>}
    </div>
  )
}

function BarList({ title, rows, loading }: { title: string; rows: { label: string; value: number }[]; loading: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  const total = rows.reduce((n, r) => n + r.value, 0)
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between">
        <p className="font-bold">{title}</p>
        <p className="text-xs text-faint">Last 7 days</p>
      </div>
      {loading ? (
        <div className="mt-4 space-y-4">{[0, 1, 2, 3].map((i) => <div key={i} className="space-y-1.5"><Skeleton className="h-3.5 w-1/3" /><Skeleton className="h-1.5 w-full" /></div>)}</div>
      ) : rows.length === 0 ? <p className="mt-4 text-sm text-muted">No issues in the last 7 days.</p> : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.label} title={`${r.label}: ${r.value}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium">{r.label}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-semibold">{r.value}</span>
                  <span className="ml-1.5 text-xs text-faint">{Math.round((r.value / total) * 100)}%</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-ink/[0.05]">
                <div className="h-1.5 rounded-full bg-marigold" style={{ width: `${(r.value / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function count(rows: FeedIssue[], key: (r: FeedIssue) => string) {
  const m = new Map<string, number>()
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1)
  return [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
}

function reasonOf(a: AttentionItem): { tone: 'warn' | 'danger' | 'neutral'; text: string } {
  if (a.processing_status === 'failed') return { tone: 'danger', text: a.next_attempt_at ? 'Reading failed, will retry' : 'Reading failed' }
  if (a.processing_status === 'needs_review') return { tone: 'warn', text: 'No clear issue found' }
  if (a.processing_status === 'submitted' || a.processing_status === 'processing') return { tone: 'neutral', text: 'Still processing' }
  if (a.event_status === 'ambiguous') return { tone: 'warn', text: 'Event not certain' }
  if (a.event_status === 'no_events') return { tone: 'neutral', text: 'No booking found' }
  return { tone: 'neutral', text: 'Event not identified' }
}

function VenueSummary({ rows, loading }: { rows: FeedIssue[]; loading: boolean }) {
  const [openVenue, setOpenVenue] = useState<string | null>(null)
  const venues = useMemo(() => {
    const m = new Map<string, FeedIssue[]>()
    for (const r of rows) {
      const k = r.venue_name ?? 'Venue not identified'
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length).map(([venue, list]) => {
      const depts = count(list, (r) => r.category)
      const things = new Map<string, FeedIssue[]>()
      for (const r of list) {
        const k = r.item ? itemKey(r.item) : r.category
        things.set(k, [...(things.get(k) ?? []), r])
      }
      const top = [...things.entries()]
        .map(([key, l]) => ({ key, thing: l[0].item ? displayItem(l[0].item) : l[0].category, n: l.length, serious: l.some((r) => r.is_serious), latest: [...l].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] }))
        .sort((a, b) => b.n - a.n || b.latest.created_at.localeCompare(a.latest.created_at))
      return { venue, list, depts, top, serious: list.filter((r) => r.is_serious).length }
    })
  }, [rows])

  if (loading) return <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <Card key={i} className="space-y-3 p-5"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></Card>)}</div>
  if (!venues.length) return <Card className="p-6 text-[15px] text-muted">No issues in the last 7 days.</Card>

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {venues.map((v) => (
        <Card key={v.venue} className="flex h-full flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 text-lg font-bold leading-tight">
              <Icon name="pin" className="size-[18px] shrink-0 text-marigold" /><span className="truncate">{v.venue}</span>
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {v.serious > 0 && <Badge tone="solid-danger"><Icon name="alert" />{v.serious}</Badge>}
              <span className="rounded-full bg-ink/[0.07] px-2.5 py-0.5 text-sm font-semibold tabular-nums">{v.list.length} issue{v.list.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {v.depts.map((d) => (
              <span key={d.label} className="inline-flex items-center gap-1">
                <CategoryChip name={d.label} /><span className="text-xs font-semibold tabular-nums text-ink/70">{d.value}</span>
              </span>
            ))}
          </div>
          <ul className="mt-3 flex-1 space-y-2 border-t border-line pt-3">
            {v.top.slice(0, 5).map((t) => (
              <li key={t.key} className="text-sm leading-relaxed">
                <span className="font-semibold text-ink">{t.thing}</span>
                {t.n > 1 && <span className="ml-1 text-xs font-semibold text-orange-700">×{t.n}</span>}
                {t.serious && <Icon name="alert" className="ml-1 inline size-3.5 align-[-2px] text-danger" />}
                <span className="text-ink/75">: {t.latest.summary ?? t.latest.description}</span>
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" className="mt-4 w-full shrink-0" onClick={() => setOpenVenue(v.venue)}>
            <Icon name="list" className="size-4" />See all {v.list.length} issue{v.list.length === 1 ? '' : 's'}
          </Button>
        </Card>
      ))}

      {(() => {
        const v = venues.find((x) => x.venue === openVenue)
        if (!v) return null
        const all = v.top.flatMap((t) => v.list.filter((r) => (r.item ? itemKey(r.item) : r.category) === t.key)
          .sort((a, b) => b.created_at.localeCompare(a.created_at)))
        return (
          <Modal open title={v.venue} size="lg" onClose={() => setOpenVenue(null)}
            description={<>{v.list.length} issue{v.list.length === 1 ? '' : 's'} in the last 7 days{v.serious > 0 ? <>, <b className="text-danger">{v.serious} serious</b></> : null}</>}
            footer={<>
              <Link to="/issues" className={buttonClass('secondary')}>Open Issues page</Link>
              <Button onClick={() => setOpenVenue(null)}>Close</Button>
            </>}>
            <ul className="divide-y divide-line">
              {all.map((r) => (
                <li key={r.issue_id} className="py-3 first:pt-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CategoryChip name={r.category} />
                    {r.item && <ItemTag item={r.item} category={r.category} size="sm" />}
                    {r.is_serious && <Badge tone="danger"><Icon name="alert" />Serious</Badge>}
                    <span className="ml-auto text-xs tabular-nums text-faint">
                      {new Date(r.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink/85">{r.summary ?? r.description}</p>
                  <p className="mt-1 text-xs text-muted">
                    {[r.shift, [r.guest_name, r.function_name].filter(Boolean).join(' - '), personName(r.recorded_by)].filter(Boolean).join('  |  ')}
                  </p>
                </li>
              ))}
            </ul>
          </Modal>
        )
      })()}
    </div>
  )
}

const MAX_PER_VENUE = 6

function TodayByVenue({ rows, loading }: { rows: FeedIssue[]; loading: boolean }) {
  const venues = useMemo(() => {
    const m = new Map<string, FeedIssue[]>()
    for (const r of rows) {
      const k = r.venue_name ?? 'Venue not identified'
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [rows])

  if (loading) return <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <Card key={i} className="space-y-3 p-5"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></Card>)}</div>
  if (!venues.length) return <Card className="p-6 text-[15px] text-muted">No issues reported yet today.</Card>

  return (
    <div className="grid items-start gap-4 md:grid-cols-2">
      {venues.map(([venue, list]) => {
        const seriousCount = list.filter((r) => r.is_serious).length
        const fns = [...new Set(list.map((r) => [r.shift, [r.guest_name, r.function_name].filter(Boolean).join(' - ')].filter(Boolean).join(' · ')).filter(Boolean))]
        return (
          <Card key={venue} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-lg font-bold leading-tight">
                  <Icon name="pin" className="size-[18px] shrink-0 text-marigold" /><span className="truncate">{venue}</span>
                </p>
                {fns.length > 0 && <p className="mt-1 truncate text-[13px] text-muted">{fns.join('  |  ')}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {seriousCount > 0 && <Badge tone="solid-danger"><Icon name="alert" />{seriousCount}</Badge>}
                <span className="rounded-full bg-ink/[0.07] px-2.5 py-0.5 text-sm font-semibold tabular-nums">{list.length}</span>
              </div>
            </div>
            <ul className="mt-3 divide-y divide-line">
              {list.slice(0, MAX_PER_VENUE).map((r) => (
                <li key={r.issue_id} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CategoryChip name={r.category} />
                    {r.item && <ItemTag item={r.item} category={r.category} size="sm" />}
                    {r.is_serious && <Badge tone="danger"><Icon name="alert" />Serious</Badge>}
                    <span className="ml-auto text-xs tabular-nums text-faint">
                      {new Date(r.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink/85">{r.summary ?? r.description}</p>
                </li>
              ))}
            </ul>
            {list.length > MAX_PER_VENUE && (
              <Link to="/issues" className="mt-1 inline-block text-sm font-semibold text-ink underline-offset-2 hover:underline">
                +{list.length - MAX_PER_VENUE} more on Issues
              </Link>
            )}
          </Card>
        )
      })}
    </div>
  )
}

export function AdminDashboardPage() {
  const [week, setWeek] = useState<FeedIssue[]>([])
  const [attention, setAttention] = useState<AttentionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [askDelete, setAskDelete] = useState<AttentionItem | null>(null)
  const [toast, showToast, hideToast] = useToast()
  const [cron, setCron] = useState<JobRun | null | undefined>(undefined)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const t = istToday()
      const [w, a, c] = await Promise.all([fetchIssues({ from: minusDays(t, 6), to: t }), fetchAttention(), lastCronRun()])
      setWeek(w)
      setAttention(a)
      setCron(c)
    } catch (e) { setError((e as Error).message) }
    if (!quiet) setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const today = istToday()
  const todayRows = useMemo(() => week.filter((r) => r.event_day === today), [week, today])
  const todayCount = todayRows.length
  const events = useMemo(() => new Set(week.map((r) => r.calendar_event_id).filter(Boolean)).size, [week])
  const serious = useMemo(() => week.filter((r) => r.is_serious).length, [week])
  const byVenue = useMemo(() => count(week, (r) => r.venue_name ?? 'Venue not identified'), [week])
  const byCategory = useMemo(() => count(week, (r) => r.category), [week])

  const act = async (id: string, fn: () => Promise<void>, ok: string) => {
    setBusyId(id)
    try { await fn(); showToast(ok); await load(true) } catch (e) { showToast((e as Error).message, 'error') }
    setBusyId(null)
  }

  const cronLine = (() => {
    if (cron === undefined) return null
    const mins = cron ? Math.round((Date.now() - new Date(cron.started_at).getTime()) / 60_000) : null
    const healthy = cron && cron.ok !== false && mins !== null && mins <= 15
    return (
      <span className="inline-flex items-center gap-2">
        <span className={`size-2 rounded-full ${healthy ? 'bg-ok' : 'bg-warn'}`} aria-hidden="true" />
        {cron
          ? <>Background job ran {mins === 0 ? 'just now' : `${mins} min ago`}{cron.ok === false ? ' (had an error)' : ''}{!healthy && mins !== null && mins > 15 ? '. Not running? Check Supabase Cron.' : ''}</>
          : <>Background job has not run yet (set up Supabase Cron, migration 14).</>}
      </span>
    )
  })()

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Dashboard" description={cronLine ?? 'Last 7 days'}
        actions={<>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}><Icon name="refresh" className={loading ? 'animate-spin' : ''} />Refresh</Button>
          <Link to="/issues" className={buttonClass('primary')}><Icon name="list" className="size-4" />All issues</Link>
        </>} />

      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      <section aria-label="Today">
        <h2 className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-serif text-[2.4rem] font-medium leading-none tracking-[-0.02em]">Today</span>
          <span className="text-[15px] text-muted">{new Date(today + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          {!loading && <span className="text-[15px] font-semibold text-ink/80">{todayCount} issue{todayCount === 1 ? '' : 's'}</span>}
        </h2>
        <TodayByVenue rows={todayRows} loading={loading} />
      </section>


      <section aria-label="Summary by venue" className="mt-10">
        <h2 className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-serif text-[1.9rem] font-medium leading-none tracking-[-0.02em]">Summary by venue</span>
          <span className="text-[15px] text-muted">Last 7 days</span>
        </h2>
        <VenueSummary rows={week} loading={loading} />
      </section>

      <div className="mt-8 grid items-start gap-4 md:grid-cols-2">
        <BarList title="By venue" rows={byVenue} loading={loading} />
        <BarList title="By category" rows={byCategory} loading={loading} />
      </div>

      <Card className="mt-8 grid grid-cols-2 gap-px overflow-hidden bg-line md:grid-cols-5 [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
        <Stat label="Today" full="Issues for today's functions" value={loading ? null : todayCount} />
        <Stat label="Last 7 days" full="Issues in the last 7 days" value={loading ? null : week.length} />
        <Stat label="Events" full="Events with issues in the last 7 days" value={loading ? null : events} hint="With issues" />
        <Stat label="Attention" full="Recordings that need attention, last 30 days" value={loading ? null : attention.length} hint="Last 30 days" tone="warn" />
        <Stat label="Serious" full="Serious issues; WhatsApp sent to POCs" value={loading ? null : serious} hint="WhatsApp sent" tone="danger" />
      </Card>

      <section className="mt-10">
        <SectionHeader title={<>Needs attention{!loading && attention.length > 0 && <span className="ml-2 font-semibold text-muted">{attention.length}</span>}</>}
          description="Recordings that could not be read, or whose event is not certain." />
        <div className="mt-4">
          {loading ? <ListSkeleton rows={3} /> : attention.length === 0 ? (
            <EmptyState icon="checkCircle" title="Nothing needs attention" description="Every recording from the last 30 days was read and linked to its event." />
          ) : (
            <Card as="div" className="divide-y divide-line overflow-hidden">
              {attention.map((a) => {
                const r = reasonOf(a)
                const canRetry = ['failed', 'needs_review', 'submitted', 'processing'].includes(a.processing_status)
                return (
                  <div key={a.submission_id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                        <Badge tone={r.tone} dot>{r.text}</Badge>
                        <span className="text-xs text-muted">
                          <span className="font-semibold text-ink/80">{personName(a.recorded_by) || 'Unknown'}</span>
                          {' · '}{new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                          {a.issue_count > 0 && <> · {a.issue_count} issue{a.issue_count === 1 ? '' : 's'}</>}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {canRetry && (
                          <Button variant="secondary" size="sm" loading={busyId === a.submission_id}
                            onClick={() => void act(a.submission_id, () => retryProcessing(a.submission_id), 'Processed again.')}>
                            {busyId !== a.submission_id && <Icon name="refresh" />}Retry
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="hover:bg-danger-soft! hover:text-danger!" aria-label="Delete recording"
                          disabled={busyId === a.submission_id} onClick={() => setAskDelete(a)}>
                          <Icon name="trash" /><span className="max-sm:hidden">Delete</span>
                        </Button>
                      </div>
                    </div>
                    <p className="mt-2.5 line-clamp-3 text-sm leading-relaxed">{a.transcript}</p>
                    {a.processing_error && <p className="mt-1 text-xs text-muted">Reason: {a.processing_error}</p>}
                  </div>
                )
              })}
            </Card>
          )}
        </div>
      </section>

      <Modal open={Boolean(askDelete)} title="Delete this recording?" onClose={() => setAskDelete(null)}
        footer={<>
          <Button variant="secondary" onClick={() => setAskDelete(null)}>Cancel</Button>
          <Button variant="danger" loading={Boolean(askDelete && busyId === askDelete.submission_id)}
            onClick={() => { const a = askDelete; if (a) void act(a.submission_id, () => deleteRecording(a.submission_id).then(() => setAskDelete(null)), 'Recording deleted.') }}>
            Delete
          </Button>
        </>}>
        <p className="line-clamp-3 text-sm leading-relaxed text-ink/85">{askDelete?.transcript}</p>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          The recording{askDelete && askDelete.issue_count > 0 ? <> and its {askDelete.issue_count} issue{askDelete.issue_count === 1 ? '' : 's'}</> : null} will be removed for everyone, with its audio. This cannot be undone.
        </p>
      </Modal>

      <Toast toast={toast} onClose={hideToast} />
    </div>
  )
}
