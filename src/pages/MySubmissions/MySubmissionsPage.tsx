// Shows a recorder the complaints they sent and the issues found, with filters.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { fetchMySubmissions, listCategories, type MySubmission } from '../../services/issueService'
import { listVenues } from '../../services/venueService'
import { listOutbox, onOutboxNotice, removeFromOutbox, runOutbox, type OutboxItem } from '../../services/outbox'
import type { Venue } from '../../types/events'
import { Badge } from '../../components/ui/Badge'
import { FilterSelect, SearchInput, inputClass } from '../../components/ui/Field'
import { Alert, Card, EmptyState, PageHeader, Segmented, Skeleton } from '../../components/ui/Layout'
import { Button, buttonClass } from '../../components/ui/Button'
import { CategoryChip } from '../../components/CategoryChip'
import { IssuesByItem } from '../../components/IssuesByItem'
import { Icon } from '../../components/Icon'
import { PlayRecording } from '../../components/PlayRecording'

import { fullDate, istDayEnd, istDayOf, istDayStart, istToday, rangeDates, relativeDay, type RangeKey } from '../../utils/dates'

function statusBadge(s: MySubmission) {
  const n = s.issues.length
  if (s.processing_status === 'pending_assignment' || s.processing_status === 'assigned') {
    return n ? <Badge tone="ok" dot>{n} issue{n === 1 ? '' : 's'}</Badge> : <Badge tone="ok">Good feedback</Badge>
  }
  if (s.processing_status === 'needs_review') return null
  if (s.processing_status === 'failed') return <Badge tone="warn">Will retry</Badge>
  return <Badge dot>Processing</Badge>
}

function stripe(s: MySubmission): string {
  if (s.is_serious) return 'bg-danger'
  if (s.processing_status === 'pending_assignment' || s.processing_status === 'assigned') return 'bg-ok'
  if (s.processing_status === 'failed') return 'bg-warn'
  return 'bg-line'
}

const RANGES: (readonly [RangeKey, string])[] = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7 days'], ['30d', '30 days'], ['custom', 'Custom'],
]

export function MySubmissionsPage() {
  const { user } = useAuth()
  const [range, setRange] = useState<RangeKey>('today')
  const [from, setFrom] = useState(istToday())
  const [to, setTo] = useState(istToday())
  const [venueId, setVenueId] = useState('')
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const [venues, setVenues] = useState<Venue[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [items, setItems] = useState<MySubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    void listVenues().then(setVenues).catch(() => {})
    void listCategories().then(setCategories).catch(() => {})
  }, [])

  const applyRange = (r: RangeKey) => {
    setRange(r)
    if (r !== 'custom') { const d = rangeDates(r); setFrom(d.from); setTo(d.to) }
  }

  const [params, setParams] = useSearchParams()
  const urlQ = params.get('q')
  useEffect(() => {
    if (urlQ === null) return
    setQuery(urlQ)
    if (urlQ) applyRange('30d')
    setParams((p) => { p.delete('q'); return p }, { replace: true })
  }, [urlQ, setParams])

  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const [savedCopy, setSavedCopy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    const key = `my-submissions:${user.id}`
    setLoading(true)
    setError(null)
    try {
      const list = await fetchMySubmissions(user.id, istDayStart(from), istDayEnd(to))
      setItems(list)
      setSavedCopy(null)
      try { localStorage.setItem(key, JSON.stringify({ from, to, at: new Date().toISOString(), list })) } catch { }
    } catch (e) {
      let saved: { from: string; to: string; at: string; list: MySubmission[] } | null = null
      try { saved = JSON.parse(localStorage.getItem(key) ?? 'null') } catch { }
      if (saved && saved.from === from && saved.to === to) { setItems(saved.list); setSavedCopy(saved.at) }
      else setError(navigator.onLine ? (e as Error).message : 'You are offline. Your list will load when the internet is back.')
    }
    setLoading(false)
  }, [user, from, to])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const on = () => { setOnline(true); void load() }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [load])

  const [pending, setPending] = useState<OutboxItem[]>([])
  useEffect(() => {
    if (!user) return
    let alive = true
    const refresh = () => void listOutbox(user.id).then((l) => { if (alive) setPending(l) })
    refresh()
    const off = onOutboxNotice((n) => {
      refresh()
      if (n.kind === 'sent') void load()
    })
    return () => { alive = false; off() }
  }, [user, load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((s) => {
      if (venueId && s.venue_id !== venueId && !s.issues.some((i) => i.venue_id === venueId)) return false
      if (category && !s.issues.some((i) => i.category_raw === category)) return false
      if (q && ![s.reviewed_transcript, s.guest_name, s.function_name, s.venue?.venue_name, ...s.issues.flatMap((i) => [i.item, i.ai_summary])]
        .some((x) => x?.toLowerCase().includes(q))) return false
      return true
    })
  }, [items, venueId, category, query])

  const byDay = useMemo(() => {
    const m = new Map<string, MySubmission[]>()
    for (const s of filtered) {
      const d = istDayOf(s.created_at)
      m.set(d, [...(m.get(d) ?? []), s])
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  const issueCount = filtered.reduce((n, s) => n + s.issues.length, 0)
  const filtersOn = Boolean(venueId || category || query)

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="My submissions"
        description={loading ? 'Loading…' : <>
          <b className="font-semibold text-ink">{filtered.length}</b> submission{filtered.length === 1 ? '' : 's'},{' '}
          <b className="font-semibold text-ink">{issueCount}</b> issue{issueCount === 1 ? '' : 's'} found
        </>}
        actions={
          <Button variant="secondary" onClick={() => void load()} disabled={loading} aria-label="Refresh">
            <Icon name="refresh" className={loading ? 'animate-spin' : ''} /><span className="hidden sm:inline">Refresh</span>
          </Button>
        } />

      <div className="space-y-2">
        <div className="space-y-2 lg:flex lg:items-center lg:gap-2 lg:space-y-0">
          <SearchInput value={query} onChange={setQuery} placeholder="Search dish, guest, words…" label="Search submissions" className="lg:min-w-0 lg:flex-1" />
          <Segmented label="Date range" value={range} onChange={applyRange} options={RANGES} className="w-full lg:w-[25rem] lg:shrink-0" />
          <div className="grid grid-cols-2 gap-2 lg:w-[21rem] lg:shrink-0">
            <FilterSelect label="Venue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
              <option value="">All venues</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.venue_name}</option>)}
            </FilterSelect>
            <FilterSelect label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </FilterSelect>
          </div>
        </div>
        {range === 'custom' && (
          <div className="sheet-in grid grid-cols-2 gap-2 lg:w-[25rem]">
            <label className="text-xs font-semibold text-muted">From
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputClass('md', 'mt-1')} />
            </label>
            <label className="text-xs font-semibold text-muted">To
              <input type="date" value={to} min={from} max={istToday()} onChange={(e) => setTo(e.target.value)} className={inputClass('md', 'mt-1')} />
            </label>
          </div>
        )}
        {filtersOn && (
          <button type="button" onClick={() => { setVenueId(''); setCategory(''); setQuery('') }}
            className="fade-in inline-flex items-center gap-1 rounded-md px-1 text-sm font-semibold text-muted transition-colors hover:text-ink">
            <Icon name="x" className="size-3.5" />Clear filters
          </button>
        )}
      </div>

      {savedCopy && (
        <Alert tone="info" icon="wifiOff" className="mt-4">
          {online ? 'Could not reach the server.' : 'You are offline.'} Showing your list as it was at {new Date(savedCopy).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. It updates by itself.
        </Alert>
      )}
      {error && <Alert tone="danger" className="mt-4" action={<Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button>}>{error}</Alert>}

      {pending.length > 0 && (
        <section aria-label="Sending" className="mt-6">
          <h2 className="mb-3 flex items-baseline gap-2">
            <span className="text-lg font-bold">Sending</span>
            <span className="text-sm font-medium text-muted">{online ? 'Saved on this phone' : 'Saved on this phone. Sends by itself when the internet is back.'}</span>
            <span className="ml-auto text-sm font-semibold tabular-nums text-muted">{pending.length}</span>
          </h2>
          <ul className="space-y-3">
            {pending.map((p) => (
              <li key={p.clientSubmissionId} className="relative overflow-hidden rounded-2xl border border-line/80 bg-surface py-3.5 pl-5 pr-4 shadow-card">
                <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${p.attempts > 2 && p.lastError ? 'bg-warn' : 'bg-marigold'}`} />
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold tabular-nums">{new Date(p.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</span>
                  <PlayRecording blob={p.blob} durationSec={p.durationSec} />
                  <span className="ml-auto">
                    {!online
                      ? <Badge tone="warn">Waiting for internet</Badge>
                      : p.attempts > 2 && p.lastError ? <Badge tone="warn">Not sent yet</Badge>
                      : <Badge tone="accent" dot>Sending…</Badge>}
                  </span>
                </div>
                {online && p.attempts > 2 && p.lastError && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 text-xs text-muted">{p.lastError}</p>
                    <Button size="sm" variant="secondary" onClick={() => user && void runOutbox(user.id, true)}><Icon name="refresh" />Try again</Button>
                    <Button size="sm" variant="ghost" className="hover:bg-danger-soft! hover:text-danger!"
                      onClick={() => { if (window.confirm('Delete this recording from this phone? It has not been sent.')) void removeFromOutbox(p.clientSubmissionId) }}>
                      <Icon name="trash" />Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6">
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="space-y-3 p-4">
                <div className="flex justify-between"><Skeleton className="h-4 w-20" /><Skeleton className="h-5 w-16 rounded-full" /></div>
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3.5 w-full" />
              </Card>
            ))}
          </div>
        ) : byDay.length === 0 ? (
          <EmptyState icon="submissions"
            title={filtersOn ? 'Nothing matches these filters' : 'Nothing submitted in this period'}
            description={filtersOn ? 'Clear the filters or pick a longer date range.' : 'Recordings you submit will show up here with the issues found in each.'}
            action={filtersOn
              ? <Button variant="secondary" onClick={() => { setVenueId(''); setCategory(''); setQuery('') }}><Icon name="x" />Clear filters</Button>
              : <Link to="/record" className={buttonClass('primary')}><Icon name="mic" className="size-4" />Record an issue</Link>} />
        ) : (
          <div className="space-y-8">
            {byDay.map(([day, list]) => (
              <section key={day} aria-label={fullDate(day)}>
                <h2 className="mb-3 flex items-baseline gap-2">
                  <span className="text-lg font-bold">{relativeDay(day) ?? fullDate(day)}</span>
                  {relativeDay(day) && <span className="text-sm font-medium text-muted">{fullDate(day)}</span>}
                  <span className="ml-auto text-sm font-semibold tabular-nums text-muted">{list.length} sent</span>
                </h2>
                <ul className="space-y-3">
                  {list.map((s) => {
                    const open = openId === s.id
                    const who = [s.guest_name, s.function_name].filter(Boolean).join(' · ')
                    return (
                      <li key={s.id} className={`lift relative overflow-hidden rounded-2xl border bg-surface shadow-card ${s.is_serious ? 'border-danger/40' : 'border-line/80 hover:border-line-strong'}`}>

                        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${stripe(s)}`} />
                        <button type="button" onClick={() => setOpenId(open ? null : s.id)} aria-expanded={open} className="w-full py-3.5 pl-5 pr-4 text-left">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold tabular-nums">
                              {new Date(s.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                            </span>
                            <span className="ml-auto flex items-center gap-1.5">
                              {s.is_serious && <Badge tone="solid-danger"><Icon name="alert" />Serious</Badge>}
                              {statusBadge(s)}
                            </span>
                            <Icon name="chevron" className={`size-4 shrink-0 text-faint transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                          </div>

                          <p className="mt-1 flex items-start gap-1.5 text-sm">
                            <Icon name="pin" className="mt-0.5 size-3.5 shrink-0 text-muted" />
                            <span className="min-w-0">
                              <span className="font-semibold">{s.venue?.venue_name ?? 'Venue not identified'}</span>
                              {who && <span className="text-muted"> · {who}</span>}
                            </span>
                          </p>

                          {s.issues.length > 0 && (
                            <IssuesByItem className="mt-3 border-t border-line pt-3"
                              issues={[...s.issues].sort((a, b) => a.issue_index - b.issue_index)}
                              itemOf={(i) => i.item} categoryOf={(i) => i.category_raw}
                              renderIssue={(i) => (
                                <div className="text-sm">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <CategoryChip name={i.category_raw} />
                                    {i.venue?.venue_name && i.venue.venue_name !== s.venue?.venue_name && <span className="text-xs text-muted">at {i.venue.venue_name}</span>}
                                  </div>
                                  <p className="mt-1 leading-relaxed text-ink/75">{i.ai_summary}</p>
                                </div>
                              )} />
                          )}
                        </button>
                        {open && (
                          <div className="fade-in border-t border-line bg-subtle py-3.5 pl-5 pr-4">
                            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted"><Icon name="mic" className="size-3.5" />What you said</p>
                            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{s.reviewed_transcript}</p>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
