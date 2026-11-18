// =============================================================================
// WHAT THIS FILE IS
//   The Issues page for POCs and Admin: every complaint, grouped
//   Date → Venue → Event, with filters.
// WHY IT EXISTS
//   Decision: every POC sees every issue. There is no assignment and no
//   "resolve" button; this page simply shows what came up, where, and at which
//   event, so the right people act on it. It refreshes itself every minute
//   while open.
//   Layout (from the design mockup):
//     top bar      "Issues" title (desktop, via useBarTitle)
//     toolbar      [Today] [date ▾]                     N Issues | [Filter]
//                  Filter opens venue / category / search / custom dates.
//     venue card   pin + venue name, "1 Function • 8 Issues", collapse ▾
//       function   shift icon + shift | guest - function
//       items      Items: Food ×3, Chap ×1 …                         [8]
//       table      Department | Priority | Item | Issue | Reported by | Time
//   Opened from a notification (?submission=<id>): jumps to the day(s) of that
//   complaint and highlights its issues, with "Back to Today". The id is then
//   removed from the address, so a refresh shows the normal Today list.
//   Grouping keys:
//     date  = the event's date (or the recording day if no event was found)
//     venue = the issue's own venue (one recording can cover several venues)
//     event = the Calendar booking (guest · function · shift), or "Event not identified"
// USED BY
//   App.tsx route "/issues"
// DEPENDS ON
//   services/issueService.ts (SQL function issues_feed), services/venueService.ts
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchIssues, listCategories, submissionDays, type FeedIssue } from '../../services/issueService'
import { listVenues } from '../../services/venueService'
import type { Venue } from '../../types/events'
import { IssueCard, IssueTableHead } from '../../components/IssueCard'
import { ItemTag } from '../../components/ItemTag'
import { itemCounts, sortByItem } from '../../utils/itemGroups'
import { FilterSelect, SearchInput, inputClass } from '../../components/ui/Field'
import { Alert, Card, EmptyState, ListSkeleton, Skeleton } from '../../components/ui/Layout'
import { useBarTitle } from '../../layouts/barTitle'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/Icon'
import { SHIFT_ORDER, shiftIcon } from '../../utils/categoryStyle'

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
/** "Today" / "Yesterday" / null, shown next to the full date. */
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
        // Functions in the order of the day (Morning → Lunch → Sundowner → Dinner);
        // anything not matched to a function goes last.
        .sort((a, b) => Number(b.identified) - Number(a.identified)
          || (SHIFT_ORDER[a.shift ?? ''] ?? 9) - (SHIFT_ORDER[b.shift ?? ''] ?? 9))
      return { key: vKey, name: em.values().next().value?.[0]?.venue_name ?? 'Venue not identified', events,
               count: events.reduce((n, e) => n + e.issues.length, 0) }
    }).sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.name.localeCompare(b.name)))
    return { day, venues, count: venues.reduce((n, v) => n + v.count, 0) }
  })
}

export function IssuesPage() {
  const [range, setRange] = useState<Range>('today')   // default: today's issues
  const [from, setFrom] = useState(istToday())
  const [to, setTo] = useState(istToday())
  const [venueId, setVenueId] = useState('')
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const [venues, setVenues] = useState<Venue[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [rows, setRows] = useState<FeedIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())   // venue cards folded by the user
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

  // Search from the top bar arrives as ?q=… → fill the box and look back 30 days.
  const [params, setParams] = useSearchParams()
  const urlQ = params.get('q')

  // Opened from a notification: show that complaint's day and highlight it.
  const urlSub = params.get('submission')
  const [focusId, setFocusId] = useState<string | null>(null)
  useEffect(() => {
    if (!urlSub) return
    let gone = false
    void submissionDays(urlSub).then((d) => {
      if (gone) return
      if (d) { setRange('custom'); setFrom(d.from); setTo(d.to); setFocusId(urlSub) }
      // Drop the id from the address: a refresh then shows the normal Today list.
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

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError(null)
    try {
      setRows(await fetchIssues({ from, to, venueId: venueId || null, category: category || null }))
      setUpdatedAt(new Date())
    } catch (e) { setError((e as Error).message) }
    if (!quiet) setLoading(false)
  }, [from, to, venueId, category])

  useEffect(() => { void load() }, [load])

  // Refresh quietly every minute while the tab is visible.
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load(true) }, 60_000)
    return () => clearInterval(id)
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => [r.summary, r.description, r.item, r.guest_name, r.function_name, r.venue_name, r.transcript, r.recorded_by]
      .some((x) => x?.toLowerCase().includes(q)))
  }, [rows, query])

  const groups = useMemo(() => group(filtered), [filtered])
  const filtersOn = Boolean(venueId || category || query)
  const activeFilters = [venueId, category, query].filter(Boolean).length
  const today = istToday()
  const rangeLabel = (r: Range) => r === 'today' ? fullDate(today) : r === 'yesterday' ? fullDate(shift(today, -1))
    : r === '7d' ? 'Last 7 days' : r === '30d' ? 'Last 30 days' : from === to ? fullDate(from) : 'Custom dates'
  const multiDay = groups.length > 1 || from !== to

  return (
    <div className="mx-auto max-w-[110rem]">
      {/* Phones have no top bar title, so the page shows it. */}
      <h1 className="mb-4 font-serif text-[2.1rem] font-medium leading-none tracking-[-0.02em] md:hidden">Issues</h1>

      {/* ---------------- Toolbar ---------------- */}
      <div className="flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={() => applyRange('today')} aria-pressed={range === 'today'}
          className={`inline-flex h-11 items-center gap-2 rounded-full px-4 text-[15px] font-semibold transition-colors
            ${range === 'today' ? 'bg-[#fbe9c3] text-ink' : 'bg-ink/[0.05] text-ink/80 hover:bg-ink/[0.08]'}`}>
          <Icon name="calendar" className="size-[18px] text-accent" />Today
        </button>
        <span aria-hidden="true" className="mx-1 h-6 w-px bg-ink/10" />
        <label className="relative">
          <span className="sr-only">Date range</span>
          <select value={range} onChange={(e) => applyRange(e.target.value as Range)}
            className="h-11 cursor-pointer appearance-none rounded-xl bg-transparent pl-2 pr-9 text-[15px] font-medium text-ink outline-none transition-colors hover:bg-ink/[0.04] focus-visible:ring-4 focus-visible:ring-marigold/15">
            {(['today', 'yesterday', '7d', '30d', 'custom'] as const).map((r) => <option key={r} value={r}>{rangeLabel(r)}</option>)}
          </select>
          <Icon name="chevron" className="pointer-events-none absolute right-2.5 top-1/2 size-[18px] -translate-y-1/2 text-ink/70" />
        </label>

        <div className="ml-auto flex items-center">
          <p className="pr-4 text-[15px] font-semibold tabular-nums text-ink">
            {loading ? '…' : `${filtered.length} Issue${filtered.length === 1 ? '' : 's'}`}
          </p>
          <span aria-hidden="true" className="h-8 w-px bg-ink/10" />
          <button type="button" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}
            className={`ml-2 inline-flex h-11 items-center gap-2 rounded-full px-4 text-[15px] font-semibold transition-colors
              ${filtersOpen || activeFilters ? 'bg-ink/[0.08] text-ink' : 'text-ink/80 hover:bg-ink/[0.05]'}`}>
            <Icon name="filter" className="size-[18px]" />Filter
            {activeFilters > 0 && <span className="flex size-5 items-center justify-center rounded-full bg-ink text-[11px] text-white">{activeFilters}</span>}
          </button>
        </div>
      </div>

      {/* Filter panel: venue, category, search, custom dates, refresh. */}
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
                {/* Day heading only when more than one day is on screen. */}
                {multiDay && (
                  <h2 className="mb-3 flex items-baseline gap-2">
                    <span className="font-serif text-[1.5rem] leading-none">{relativeDay(d.day) ?? fullDate(d.day)}</span>
                    {relativeDay(d.day) && <span className="text-sm font-medium text-muted">{fullDate(d.day)}</span>}
                    <span className="ml-auto text-sm font-semibold tabular-nums text-muted">{d.count} issue{d.count === 1 ? '' : 's'}</span>
                  </h2>
                )}

                {/* One card per venue; its functions are sections inside it. */}
                <div className="space-y-5">
                  {d.venues.map((v) => {
                    const fnCount = v.events.filter((e) => e.identified).length
                    const cardKey = d.day + '|' + v.key
                    const folded = collapsed.has(cardKey)
                    return (
                      <Card key={v.key} className="card-hover overflow-hidden border-transparent! p-2">
                        {/* Venue header (tap to fold / unfold) */}
                        <button type="button" onClick={() => toggleVenue(cardKey)} aria-expanded={!folded}
                          className="pin-hover flex w-full items-center gap-3 rounded-xl bg-[#fbf3e3] px-4 py-3.5 text-left transition-colors hover:bg-[#f8ebd0]">
                          <Icon name="pin" className={`pin-bounce size-[22px] shrink-0 ${v.key === 'none' ? 'text-faint' : 'text-marigold'}`} />
                          <span className="min-w-0 flex-1 truncate text-xl font-bold tracking-tight">{v.name}</span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                            {fnCount > 0 && <>{fnCount} Function{fnCount === 1 ? '' : 's'} <span className="text-ink/40">•</span> </>}{v.count} Issue{v.count === 1 ? '' : 's'}
                          </span>
                          <Icon name="chevron" className={`size-5 shrink-0 text-ink/70 transition-transform duration-200 ${folded ? '' : 'rotate-180'}`} />
                        </button>

                        {!folded && v.events.map((e) => {
                          const icon = shiftIcon(e.shift)
                          const items = itemCounts(e.issues, (i) => i.item, (i) => i.category)
                          return (
                            <div key={e.key}>
                              {/* Function: shift icon + shift | guest - function · area */}
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

                              {/* Items: each dish / thing once with a count; total on the right. */}
                              <div className="flex items-center gap-2 border-t border-line/70 px-4 py-3">
                                <span className="text-sm text-ink/80">Items:</span>
                                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                                  {items.length > 0
                                    ? items.map((x) => <ItemTag key={x.key} item={x.item} category={x.category} count={x.count} showOne />)
                                    : <span className="text-sm text-faint">—</span>}
                                </div>
                                <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] px-2 text-sm font-semibold tabular-nums">{e.issues.length}</span>
                              </div>

                              {/* The issues as a table, same dish / thing together */}
                              <div className="pb-1">
                                <IssueTableHead />
                                <ul className="divide-y divide-line">
                                  {sortByItem(e.issues, (i) => i.item).map((i) => <IssueCard key={i.issue_id} issue={i} focused={i.submission_id === focusId} />)}
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
