// Shows all issues to POCs and Admin, grouped by day, venue and function, with filters.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchCompliments, fetchIssues, listCategories, submissionDays, type Compliment, type FeedIssue } from '../../services/issueService'
import { listVenues } from '../../services/venueService'
import type { Venue } from '../../types/events'
import { IssueCard, IssueTableHead } from '../../components/IssueCard'
import { PraiseRow } from '../../components/PraiseRow'
import { ItemTag } from '../../components/ItemTag'
import { itemCounts, sortByItem } from '../../utils/itemGroups'
import { FilterSelect, SearchInput, inputClass } from '../../components/ui/Field'
import { Alert, Card, EmptyState, ListSkeleton, Skeleton } from '../../components/ui/Layout'
import { useBarTitle } from '../../layouts/barTitle'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/Icon'
import { SHIFT_ORDER, shiftIcon } from '../../utils/categoryStyle'
import { dayMonth, istDayOf } from '../../utils/dates'
import { personName } from '../../utils/personName'
import { displayItem } from '../../utils/itemName'

type Range = 'today' | 'yesterday' | '7d' | '30d' | 'custom'

const istToday = () => {
  const d = new Date(Date.now() + 5.5 * 3600_000)
  return d.toISOString().slice(0, 10)
}
const shift = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const fullDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

const relativeDay = (iso: string) => {
  const t = istToday()
  return iso === t ? 'Today' : iso === shift(t, -1) ? 'Yesterday' : null
}

interface EventGroup {
  key: string; identified: boolean; issues: FeedIssue[]
  guest: string | null; fn: string | null; shift: string | null; area: string | null; title: string | null
}
interface VenueGroup { key: string; name: string; events: EventGroup[]; count: number }
interface DayGroup { day: string; venues: VenueGroup[]; count: number }

function group(rows: FeedIssue[]): DayGroup[] {
  const days = new Map<string, Map<string, Map<string, FeedIssue[]>>>()
  for (const r of rows) {
    const v = r.venue_id ?? 'none'
    const e = r.calendar_event_id ?? 'none'
    if (!days.has(r.event_day)) days.set(r.event_day, new Map())
    const vm = days.get(r.event_day)!
    if (!vm.has(v)) vm.set(v, new Map())
    const em = vm.get(v)!
    if (!em.has(e)) em.set(e, [])
    em.get(e)!.push(r)
  }
  return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, vm]) => {
    const venues = [...vm.entries()].map(([vKey, em]) => {
      const events: EventGroup[] = [...em.entries()].map(([eKey, issues]) => {
        const f = issues[0]
        return {
          key: eKey,
          identified: eKey !== 'none',
          guest: f.guest_name, fn: f.function_name, shift: f.shift, area: f.sub_venue, title: f.event_title,
          issues,
        }
      })

        .sort((a, b) => Number(b.identified) - Number(a.identified)
          || (SHIFT_ORDER[a.shift ?? ''] ?? 9) - (SHIFT_ORDER[b.shift ?? ''] ?? 9))
      return { key: vKey, name: em.values().next().value?.[0]?.venue_name ?? 'Venue not identified', events,
               count: events.reduce((n, e) => n + e.issues.length, 0) }
    }).sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.name.localeCompare(b.name)))
    return { day, venues, count: venues.reduce((n, v) => n + v.count, 0) }
  })
}

type ItemCount = { key: string; item: string; category: string | null; count: number }

function ItemsLine({ items }: { items: ItemCount[] }) {
  const [all, setAll] = useState(false)
  if (!items.length) return <span className="min-w-0 flex-1 text-sm text-faint">—</span>
  const more = all ? 0 : items.length - 2
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-1 sm:flex-wrap ${all ? 'flex-wrap' : 'overflow-hidden'}`}>
      {items.map((x, i) => (
        <ItemTag key={x.key} item={x.item} category={x.category} count={x.count} showOne size="sm"
          className={all ? '' : i < 2 ? 'min-w-0' : 'max-sm:hidden!'} />
      ))}
      {more > 0 && (
        <button type="button" onClick={() => setAll(true)}
          className="shrink-0 rounded-full bg-ink/[0.06] px-2 py-0.5 text-xs font-semibold text-ink/70 hover:bg-ink/10 sm:hidden">+{more}</button>
      )}
    </div>
  )
}

export function IssuesPage() {
  const [range, setRange] = useState<Range>('today')
  const [from, setFrom] = useState(istToday())
  const [to, setTo] = useState(istToday())
  const [venueId, setVenueId] = useState('')
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const [venues, setVenues] = useState<Venue[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [rows, setRows] = useState<FeedIssue[]>([])
  const [praise, setPraise] = useState<Compliment[]>([])
  const [praiseOpen, setPraiseOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleVenue = (key: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n })
  useBarTitle('Issues')

  useEffect(() => {
    void listVenues().then(setVenues).catch(() => {})
    void listCategories().then(setCategories).catch(() => {})
  }, [])

  const applyRange = (r: Range) => {
    setFocusId(null)
    setRange(r)
    const t = istToday()
    if (r === 'today') { setFrom(t); setTo(t) }
    if (r === 'yesterday') { setFrom(shift(t, -1)); setTo(shift(t, -1)) }
    if (r === '7d') { setFrom(shift(t, -6)); setTo(t) }
    if (r === '30d') { setFrom(shift(t, -29)); setTo(t) }
  }

  const [params, setParams] = useSearchParams()
  const urlQ = params.get('q')

  const urlSub = params.get('submission')
  const [focusId, setFocusId] = useState<string | null>(null)
  useEffect(() => {
    if (!urlSub) return
    let gone = false
    void submissionDays(urlSub).then((d) => {
      if (gone) return
      if (d) { setRange('custom'); setFrom(d.from); setTo(d.to); setFocusId(urlSub); setVenueId(''); setCategory(''); setQuery('') }

      setParams((p) => { p.delete('submission'); return p }, { replace: true })
    }).catch(() => setParams((p) => { p.delete('submission'); return p }, { replace: true }))
    return () => { gone = true }
  }, [urlSub, setParams])
  const backToToday = () => { setFocusId(null); applyRange('today') }
  useEffect(() => {
    if (urlQ === null) return
    setQuery(urlQ)
    if (urlQ) { setFiltersOpen(true); applyRange('30d') }
    setParams((p) => { p.delete('q'); return p }, { replace: true })
  }, [urlQ, setParams])
  const focusedRows = focusId ? rows.filter((r) => r.submission_id === focusId) : []

  const loadSeq = useRef(0)
  const load = useCallback(async (quiet = false) => {
    if (!from || !to) return
    const seq = ++loadSeq.current
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const [lo, hi] = from <= to ? [from, to] : [to, from]
      const [issues, good] = await Promise.all([
        fetchIssues({ from: lo, to: hi, venueId: venueId || null, category: category || null }),
        fetchCompliments(lo, hi),
      ])
      if (seq !== loadSeq.current) return
      setRows(issues)
      setPraise(good)
      setUpdatedAt(new Date())
    } catch (e) { if (seq === loadSeq.current) setError((e as Error).message) }
    if (seq === loadSeq.current) setLoading(false)
  }, [from, to, venueId, category])

  useEffect(() => { void load() }, [load])

  const dayRef = useRef(istToday())
  useEffect(() => {
    const tick = () => {
      const now = istToday()
      if (now !== dayRef.current && range !== 'custom') {
        const back = range === 'yesterday' ? 1 : range === '7d' ? 6 : range === '30d' ? 29 : 0
        dayRef.current = now
        setFrom(shift(now, -back))
        setTo(range === 'yesterday' ? shift(now, -1) : now)
        return
      }
      if (document.visibilityState === 'visible') void load(true)
    }
    const id = setInterval(tick, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [load, range])

  const searchText = useDeferredValue(query)
  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => [r.summary, r.description, r.item, r.item ? displayItem(r.item) : null, r.guest_name, r.function_name,
      r.venue_name, r.transcript, r.recorded_by, personName(r.recorded_by), r.category, r.shift, r.sub_venue, r.event_title]
      .some((x) => x?.toLowerCase().includes(q)))
  }, [rows, searchText])

  const groups = useMemo(() => group(filtered), [filtered])
  const filtersOn = Boolean(venueId || category || query)
  const activeFilters = [venueId, category, query].filter(Boolean).length
  const today = istToday()
  const rangeLabel = (r: Range) => r === 'today' ? fullDate(today) : r === 'yesterday' ? fullDate(shift(today, -1))
    : r === '7d' ? 'Last 7 days' : r === '30d' ? 'Last 30 days'
    : range !== 'custom' ? 'Custom dates…'
    : from === to ? `Custom: ${fullDate(from)}` : `${dayMonth(from)} – ${dayMonth(to)}`
  const multiDay = groups.length > 1 || from !== to

  return (
    <div className="mx-auto max-w-[110rem]">

      <div className="mb-4 flex items-center gap-3 md:hidden">
        <h1 className="font-serif text-[2.1rem] font-medium leading-none tracking-[-0.02em]">Issues</h1>
        {!loading && <span className="rounded-full bg-ink/[0.07] px-2.5 py-0.5 text-sm font-semibold tabular-nums text-ink/80">{filtered.length}</span>}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2.5">
        <button type="button" onClick={() => applyRange('today')} aria-pressed={range === 'today'}
          className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-3.5 text-[15px] font-semibold transition-colors sm:h-11 sm:px-4
            ${range === 'today' ? 'bg-[#fbe9c3] text-ink' : 'bg-ink/[0.05] text-ink/80 hover:bg-ink/[0.08]'}`}>
          <Icon name="calendar" className="size-[18px] text-accent" />Today
        </button>
        <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-ink/10 sm:mx-1" />
        <label className="relative min-w-0">
          <span className="sr-only">Date range</span>
          <select value={range} onChange={(e) => applyRange(e.target.value as Range)}
            className="h-10 max-w-full cursor-pointer appearance-none truncate rounded-xl bg-transparent pl-2 pr-8 text-[15px] font-medium text-ink outline-none sm:h-11 sm:pr-9 transition-colors hover:bg-ink/[0.04] focus-visible:ring-4 focus-visible:ring-ink/[0.05]">
            {(['today', 'yesterday', '7d', '30d', 'custom'] as const).map((r) => <option key={r} value={r}>{rangeLabel(r)}</option>)}
          </select>
          <Icon name="chevron" className="pointer-events-none absolute right-2.5 top-1/2 size-[18px] -translate-y-1/2 text-ink/70" />
        </label>

        <div className="ml-auto flex shrink-0 items-center">
          <p className="hidden pr-4 text-[15px] font-semibold tabular-nums text-ink sm:block">
            {loading ? '…' : `${filtered.length} Issue${filtered.length === 1 ? '' : 's'}`}
          </p>
          <span aria-hidden="true" className="hidden h-8 w-px bg-ink/10 sm:block" />
          <button type="button" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}
            className={`inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-[15px] font-semibold transition-colors sm:ml-2 sm:h-11 sm:px-4
              ${filtersOpen || activeFilters ? 'bg-ink/[0.08] text-ink' : 'text-ink/80 hover:bg-ink/[0.05]'}`}>
            <Icon name="filter" className="size-[18px]" />Filter
            {activeFilters > 0 && <span className="flex size-5 items-center justify-center rounded-full bg-ink text-[11px] text-white">{activeFilters}</span>}
          </button>
        </div>
      </div>

      {(filtersOpen || (range === 'custom' && !focusId)) && (
        <Card className="sheet-in mt-3 p-3">
          <div className="grid grid-cols-2 gap-2 lg:flex lg:items-center">
            <FilterSelect label="Venue" value={venueId} onChange={(e) => setVenueId(e.target.value)} className="lg:w-48">
              <option value="">All venues</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.venue_name}</option>)}
            </FilterSelect>
            <FilterSelect label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="lg:w-48">
              <option value="">All departments</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </FilterSelect>
            <SearchInput value={query} onChange={setQuery} placeholder="Search guest, dish, words…" label="Search issues" className="col-span-2 lg:flex-1" />
            <div className="col-span-2 flex items-center gap-2 lg:col-span-1">
              {filtersOn && <Button variant="ghost" onClick={() => { setVenueId(''); setCategory(''); setQuery('') }}><Icon name="x" />Clear</Button>}
              <Button variant="secondary" onClick={() => void load()} disabled={loading} className="ml-auto">
                <Icon name="refresh" className={loading ? 'animate-spin' : ''} />Refresh
              </Button>
            </div>
          </div>
          {range === 'custom' && (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:flex">
              <label className="text-xs font-semibold text-muted">From
                <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputClass('md', 'mt-1 sm:w-44')} />
              </label>
              <label className="text-xs font-semibold text-muted">To
                <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={inputClass('md', 'mt-1 sm:w-44')} />
              </label>
            </div>
          )}
          {updatedAt && <p className="mt-2 px-1 text-xs text-faint">Updates every minute · last {updatedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</p>}
        </Card>
      )}

      {focusId && (
        <Alert tone="info" icon="bell" className="mt-3"
          action={<Button size="sm" variant="secondary" onClick={backToToday}><Icon name="calendar" />Back to Today</Button>}>
          Showing the complaint from your notification
          {focusedRows[0] && <> · {fullDate(focusedRows[0].event_day)}</>}
          {focusedRows.length > 0 && <> · {focusedRows.length} issue{focusedRows.length === 1 ? '' : 's'} highlighted</>}
        </Alert>
      )}

      {error && <Alert tone="danger" className="mt-4" action={<Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button>}>{error}</Alert>}

      {(() => {
        const q = query.trim().toLowerCase()
        const shown = praise.filter((p) => (!venueId || p.venue_id === venueId)
          && (!q || [p.item, p.summary, p.venue_name, p.recorded_by].some((x) => x?.toLowerCase().includes(q))))
        if (!shown.length || category || focusId) return null
        const list = praiseOpen ? shown : shown.slice(0, 3)
        return (
          <Card className="mt-4 overflow-hidden border-ok/25">
            <div className="flex items-center gap-2 bg-ok-soft/70 px-4 py-2.5">
              <Icon name="checkCircle" className="size-[18px] text-ok" />
              <p className="font-semibold text-ink">Good feedback</p>
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold tabular-nums text-ok">{shown.length}</span>
            </div>
            <ul className="divide-y divide-line">
              {list.map((p) => (
                <PraiseRow key={p.id} p={p} meta={[p.venue_name ?? 'Venue not identified', personName(p.recorded_by), multiDay ? fullDate(p.event_day) : null,
                  istDayOf(p.created_at) !== p.event_day ? `Recorded ${dayMonth(istDayOf(p.created_at))}` : null,
                  new Date(p.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })].filter(Boolean).join('  |  ')} />
              ))}
            </ul>
            {shown.length > 3 && (
              <button type="button" onClick={() => setPraiseOpen((o) => !o)}
                className="w-full border-t border-line px-4 py-2 text-sm font-semibold text-ink/80 hover:bg-subtle">
                {praiseOpen ? 'Show less' : `Show all ${shown.length}`}
              </button>
            )}
          </Card>
        )
      })()}

      <div className="mt-5">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-5 w-40" />
            <ListSkeleton rows={4} label="Loading issues" />
            <ListSkeleton rows={2} label="Loading issues" />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState icon="checkCircle"
            title={filtersOn ? 'No issues match these filters' : 'No issues in this period'}
            description={filtersOn ? 'Clear the filters or pick a longer date range.' : 'Nothing has been reported. Try a longer date range to see older issues.'}
            action={filtersOn
              ? <Button variant="secondary" onClick={() => { setVenueId(''); setCategory(''); setQuery('') }}><Icon name="x" />Clear filters</Button>
              : range !== '30d' ? <Button variant="secondary" onClick={() => applyRange('30d')}>Show last 30 days</Button> : undefined} />
        ) : (
          <div className="space-y-8">
            {groups.map((d) => (
              <section key={d.day} aria-label={fullDate(d.day)}>

                {multiDay && (
                  <h2 className="mb-3 flex items-baseline gap-2">
                    <span className="font-serif text-[1.5rem] leading-none">{relativeDay(d.day) ?? fullDate(d.day)}</span>
                    {relativeDay(d.day) && <span className="text-sm font-medium text-muted">{fullDate(d.day)}</span>}
                    <span className="ml-auto text-sm font-semibold tabular-nums text-muted">{d.count} issue{d.count === 1 ? '' : 's'}</span>
                  </h2>
                )}

                <div className="space-y-5">
                  {d.venues.map((v) => {
                    const fnCount = v.events.filter((e) => e.identified).length
                    const cardKey = d.day + '|' + v.key
                    const folded = collapsed.has(cardKey)
                    return (
                      <Card key={v.key} className="card-hover overflow-hidden border-transparent! p-2">

                        <button type="button" onClick={() => toggleVenue(cardKey)} aria-expanded={!folded}
                          className="pin-hover flex w-full items-center gap-3 rounded-xl bg-[#fbf3e3] px-4 py-3.5 text-left transition-colors hover:bg-[#f8ebd0]">
                          <Icon name="pin" className={`pin-bounce size-[22px] shrink-0 self-start sm:self-center ${v.key === 'none' ? 'text-faint' : 'text-marigold'}`} />

                          <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                            <span className="min-w-0 text-xl font-bold leading-tight tracking-tight sm:flex-1 sm:truncate">{v.name}</span>
                            <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink/70 sm:text-sm sm:text-ink">
                              {fnCount > 0 && <>{fnCount} Function{fnCount === 1 ? '' : 's'} <span className="text-ink/40">•</span> </>}{v.count} Issue{v.count === 1 ? '' : 's'}
                            </span>
                          </span>
                          <Icon name="chevron" className={`size-5 shrink-0 text-ink/70 transition-transform duration-200 ${folded ? '' : 'rotate-180'}`} />
                        </button>

                        {!folded && v.events.map((e) => {
                          const icon = shiftIcon(e.shift)
                          const items = itemCounts(e.issues, (i) => i.item, (i) => i.category)
                          return (
                            <div key={e.key}>

                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3 pt-4">
                                {e.identified ? (
                                  <>
                                    {e.shift && (
                                      <span className="inline-flex items-center gap-2 text-[15px] font-bold text-ink">
                                        <Icon name={icon ?? 'calendar'} className="size-5 text-ink/70" />{e.shift}
                                      </span>
                                    )}
                                    {e.shift && <span aria-hidden="true" className="h-4 w-px bg-line-strong" />}
                                    <span className="text-[15px] text-ink/90">{[e.guest, e.fn].filter(Boolean).join(' - ') || e.title || 'Function'}</span>
                                    {e.area && <span className="rounded-full bg-ink/[0.06] px-2.5 py-0.5 text-[13px] text-ink/70">{e.area}</span>}
                                  </>
                                ) : (
                                  <span className="text-[15px] text-ink/80">Not linked to a function</span>
                                )}
                              </div>

                              <div className="flex items-center gap-2 border-t border-line/70 px-4 py-2.5">
                                <span className="text-sm text-ink/80">Items:</span>
                                <ItemsLine items={items} />
                                <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] px-2 text-sm font-semibold tabular-nums">{e.issues.length}</span>
                              </div>

                              <div className="@container pb-1">
                                <IssueTableHead />
                                <ul className="divide-y divide-line">
                                  {sortByItem(e.issues, (i) => i.item).map((i) => <IssueCard key={i.issue_id} issue={i} focused={i.submission_id === focusId} onDeleted={() => void load(true)} />)}
                                </ul>
                              </div>
                            </div>
                          )
                        })}
                      </Card>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
