// =============================================================================
// WHAT THIS FILE IS
//   The Admin dashboard: headline numbers, where issues come from (by venue and
//   category, last 7 days), and the recordings that need Admin's attention.
// WHY IT EXISTS
//   • Stat tiles: issues today, issues and events in the last 7 days, items
//     needing attention.
//   • Two ranked bar lists (venue, category): one series each, a single colour,
//     a label and number on every bar, so no legend is needed.
//   • Needs attention:
//       – processing failed / no issue found → Retry (runs the AI again)
//       – event not certain → pick the right booking from the ones the matcher
//         found (nothing is typed by hand)
// USED BY
//   App.tsx route "/admin"
// DEPENDS ON
//   services/issueService.ts (issues_feed, admin_attention, admin_set_submission_event,
//   process-issue retry)
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { chooseEvent, fetchAttention, fetchIssues, lastCronRun, retryProcessing, type AttentionItem, type FeedIssue, type JobRun } from '../../services/issueService'
import { Button, buttonClass } from '../../components/ui/Button'
import { Alert, Card, EmptyState, ListSkeleton, PageHeader, SectionHeader, Skeleton } from '../../components/ui/Layout'
import { Toast, useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { Icon } from '../../components/Icon'

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const minusDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }

/** One cell of the headline strip. Numbers turn amber/red only when they need action. */
function Stat({ label, value, hint, tone }: { label: string; value: number | null; hint?: string; tone?: 'warn' | 'danger' }) {
  const hot = tone && value !== null && value > 0
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-[13px] font-semibold text-muted">{label}</p>
      {value === null
        ? <Skeleton className="mt-2 h-8 w-12" />
        : <p className={`mt-1.5 font-serif text-[2.4rem] font-normal leading-none tabular-nums tracking-[-0.02em] ${hot ? (tone === 'danger' ? 'text-danger' : 'text-warn') : 'text-ink'}`}>{value}</p>}
      {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
    </div>
  )
}

/** Ranked horizontal bars: one hue, thin marks, value as text (never in the bar colour). */
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

export function AdminDashboardPage() {
  const [week, setWeek] = useState<FeedIssue[]>([])
  const [attention, setAttention] = useState<AttentionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toast, showToast, hideToast] = useToast()
  const [cron, setCron] = useState<JobRun | null | undefined>(undefined)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const t = istToday()
      const [w, a, c] = await Promise.all([fetchIssues({ from: minusDays(t, 6), to: t }), fetchAttention(), lastCronRun()])
      setWeek(w)
      setAttention(a)
      setCron(c)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const today = istToday()
  const todayCount = useMemo(() => week.filter((r) => r.event_day === today).length, [week, today])
  const events = useMemo(() => new Set(week.map((r) => r.calendar_event_id).filter(Boolean)).size, [week])
  const serious = useMemo(() => new Set(week.filter((r) => r.is_serious).map((r) => r.submission_id)).size, [week])
  const byVenue = useMemo(() => count(week, (r) => r.venue_name ?? 'Venue not identified'), [week])
  const byCategory = useMemo(() => count(week, (r) => r.category), [week])

  const act = async (id: string, fn: () => Promise<void>, ok: string) => {
    setBusyId(id)
    try { await fn(); showToast(ok); await load() } catch (e) { showToast((e as Error).message, 'error') }
    setBusyId(null)
  }

  // Health of the 5-minute background job (retries + cleanup).
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

      {/* Headline numbers: one strip, cells divided by hairlines. */}
      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-line md:grid-cols-5 [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
        <Stat label="Issues today" value={loading ? null : todayCount} />
        <Stat label="Issues, 7 days" value={loading ? null : week.length} />
        <Stat label="Events with issues" value={loading ? null : events} hint="Last 7 days" />
        <Stat label="Needs attention" value={loading ? null : attention.length} hint="Last 30 days" tone="warn" />
        <Stat label="Serious" value={loading ? null : serious} hint="WhatsApp sent to POCs" tone="danger" />
      </Card>

      <div className="mt-4 grid items-start gap-4 md:grid-cols-2">
        <BarList title="By venue" rows={byVenue} loading={loading} />
        <BarList title="By category" rows={byCategory} loading={loading} />
      </div>

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
                const candidates = a.event_match?.candidates ?? []
                const canRetry = ['failed', 'needs_review', 'submitted', 'processing'].includes(a.processing_status)
                return (
                  <div key={a.submission_id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                        <Badge tone={r.tone} dot>{r.text}</Badge>
                        <span className="text-xs text-muted">
                          <span className="font-semibold text-ink/80">{a.recorded_by ?? 'Unknown'}</span>
                          {' · '}{new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                          {a.issue_count > 0 && <> · {a.issue_count} issue{a.issue_count === 1 ? '' : 's'}</>}
                        </span>
                      </div>
                      {canRetry && (
                        <Button variant="secondary" size="sm" loading={busyId === a.submission_id}
                          onClick={() => void act(a.submission_id, () => retryProcessing(a.submission_id), 'Processed again.')}>
                          {busyId !== a.submission_id && <Icon name="refresh" />}Retry
                        </Button>
                      )}
                    </div>
                    <p className="mt-2.5 line-clamp-3 text-sm leading-relaxed">{a.transcript}</p>
                    {a.processing_error && <p className="mt-1 text-xs text-muted">Reason: {a.processing_error}</p>}

                    {a.event_status === 'ambiguous' && candidates.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs font-semibold text-muted">Which event was it?</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {candidates.slice(0, 5).map((c) => (
                            <button type="button" key={c.calendar_event_id} disabled={busyId === a.submission_id}
                              onClick={() => void act(a.submission_id, () => chooseEvent(a.submission_id, c.calendar_event_id), 'Event linked.')}
                              className="rounded-lg border border-line px-3 py-2.5 text-left text-sm transition-colors hover:border-ink/50 hover:bg-subtle disabled:opacity-50">
                              <span className="block font-semibold">{[c.guest_name, c.function_name].filter(Boolean).join(' · ') || c.title}</span>
                              <span className="mt-0.5 block text-xs text-muted">{[c.venue_name, c.shift, c.sub_venue, c.date].filter(Boolean).join(' · ')}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </Card>
          )}
        </div>
      </section>

      <Toast toast={toast} onClose={hideToast} />
    </div>
  )
}
