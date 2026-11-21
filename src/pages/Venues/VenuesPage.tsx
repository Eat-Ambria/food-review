// Admin page to manage venues and the other names people use for them.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { addAlias, defaultAliases, importFromCalendar, listVenues, removeAlias, saveVenue } from '../../services/venueService'
import { fetchCalendarCategories } from '../../services/eventCalendarService'
import type { CalendarCategory, Venue } from '../../types/events'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { ChoiceRow, TextField, inputClass } from '../../components/ui/Field'
import { Alert, Card, EmptyState, PageHeader, Skeleton } from '../../components/ui/Layout'
import { Toast, useToast } from '../../components/ui/Toast'
import { Icon } from '../../components/Icon'

function AliasAdder({ venueId, onAdded, onError }: { venueId: string; onAdded: () => void; onError: (m: string) => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!value.trim() || busy) return
    setBusy(true)
    try { await addAlias(venueId, value); setValue(''); onAdded() } catch (err) { onError((err as Error).message) }
    setBusy(false)
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Add a name people use…" maxLength={60}
        aria-label="New alias"
        className={inputClass('md', 'h-9 flex-1')} />
      <Button type="submit" variant="secondary" loading={busy} className="h-9">{!busy && <Icon name="plus" />}Add</Button>
    </form>
  )
}

export function VenuesPage() {
  const [venues, setVenues] = useState<Venue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, showToast, hideToast] = useToast()

  const [importOpen, setImportOpen] = useState(false)
  const [categories, setCategories] = useState<CalendarCategory[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setVenues(await listVenues(true)) } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const openImport = async () => {
    setImportOpen(true)
    setImportError(null)
    setCategories([])
    try {
      const cats = (await fetchCalendarCategories()).filter((c) => c.is_active)
      setCategories(cats)

      setPicked(new Set(cats.filter((c) => c.category_type === 'venue').map((c) => c.venue_id)))
    } catch (e) {
      setImportError((e as Error).message)
    }
  }

  const runImport = async () => {
    setImportBusy(true)
    setImportError(null)
    try {
      const res = await importFromCalendar(categories.filter((c) => picked.has(c.venue_id)))
      setImportOpen(false)
      showToast(`Imported: ${res.created} new, ${res.updated} refreshed.`)
      await load()
    } catch (e) {
      setImportError((e as Error).message)
    }
    setImportBusy(false)
  }

  const toggleActive = async (v: Venue) => {
    try {
      await saveVenue({ id: v.id, venue_name: v.venue_name, calendar_venue_id: v.calendar_venue_id, sub_venues: v.sub_venues, is_active: !v.is_active })
      await load()
    } catch (e) { showToast((e as Error).message, 'error') }
  }

  const createVenue = async (e: FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    try {
      await saveVenue({ venue_name: newName, calendar_venue_id: null, sub_venues: [], is_active: true })
      setAddOpen(false)
      setNewName('')
      await load()
    } catch (err) { showToast((err as Error).message, 'error') }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Venues"
        description="Every name people use for a venue. The app uses these to recognise the venue in a recording and find the event in the Calendar."
        actions={<>
          <Button variant="secondary" onClick={() => setAddOpen(true)}><Icon name="plus" />Add venue</Button>
          <Button onClick={() => void openImport()}><Icon name="download" />Import from Calendar</Button>
        </>} />

      <p className="text-sm text-muted">
        Add the Hindi name too, like <b className="font-semibold text-ink">पुष्पांजलि</b> or <b className="font-semibold text-ink">मानकटाला</b>, so venues are found when staff say them in Hindi.
      </p>

      {error && <Alert tone="danger" className="mt-4" action={<Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button>}>{error}</Alert>}

      <div className="mt-6">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} className="space-y-4 p-5">
                <Skeleton className="h-5 w-1/2" />
                <div className="flex gap-1.5"><Skeleton className="h-7 w-16 rounded-full" /><Skeleton className="h-7 w-20 rounded-full" /><Skeleton className="h-7 w-14 rounded-full" /></div>
                <Skeleton className="h-9 w-full" />
              </Card>
            ))}
          </div>
        ) : venues.length === 0 ? (
          <EmptyState icon="pin" title="No venues yet"
            description="Import from the Event Calendar to bring in AP, AM, AE, AR and the others, with their usual names."
            action={<Button onClick={() => void openImport()}><Icon name="download" />Import from Calendar</Button>} />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {venues.map((v) => (
              <Card as="li" key={v.id} className={`flex flex-col p-5 ${v.is_active ? '' : 'bg-subtle'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`truncate text-base font-bold ${v.is_active ? '' : 'text-muted'}`}>{v.venue_name}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {v.calendar_venue_id
                        ? <Badge tone="ok" dot>Calendar: {v.calendar_venue_id}</Badge>
                        : <Badge tone="warn" dot>Not linked to Calendar</Badge>}
                      {!v.is_active && <Badge>Inactive</Badge>}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => void toggleActive(v)}>
                    {v.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>

                <p className="mt-5 text-xs font-semibold text-muted">Names people use</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {v.aliases.length === 0 && <span className="text-sm text-faint">None yet</span>}
                  {v.aliases.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-0.5 rounded-full bg-ink/[0.05] py-1 pl-3 pr-1 text-[13px] font-medium">
                      {a.alias}
                      <button type="button" onClick={() => void removeAlias(a.id).then(load).catch((e) => showToast((e as Error).message, 'error'))}
                        aria-label={`Remove ${a.alias}`} className="rounded-full p-0.5 text-faint transition-colors hover:bg-ink/10 hover:text-ink">
                        <Icon name="x" className="size-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="mt-3">
                  <AliasAdder venueId={v.id} onAdded={() => void load()} onError={(m) => showToast(m, 'error')} />
                </div>

                {v.sub_venues.length > 0 && (
                  <div className="mt-5 border-t border-line pt-4">
                    <p className="text-xs font-semibold text-muted">Lawns and halls (from Calendar)</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink/80">{v.sub_venues.join(', ')}</p>
                  </div>
                )}
              </Card>
            ))}
          </ul>
        )}
      </div>

      <Modal open={importOpen} title="Import venues from Calendar" onClose={() => setImportOpen(false)}
        description="Safe to run again: existing venues are refreshed, not duplicated."
        footer={<>
          <Button variant="secondary" onClick={() => setImportOpen(false)}>Cancel</Button>
          <Button loading={importBusy} disabled={!picked.size} onClick={() => void runImport()}>Import {picked.size}</Button>
        </>}>
        {importError && <Alert tone="danger" className="mb-3">{importError}</Alert>}
        {!importError && categories.length === 0 && (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
        )}
        <div className="space-y-2">
          {categories.map((c) => (
            <ChoiceRow key={c.venue_id} checked={picked.has(c.venue_id)}
              onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(c.venue_id)) n.delete(c.venue_id); else n.add(c.venue_id); return n })}
              title={<>{c.name} <span className="font-medium text-muted">({c.venue_id})</span></>}
              description={<>Names: {defaultAliases(c).join(', ')}</>} />
          ))}
        </div>
      </Modal>

      <Modal open={addOpen} title="Add venue" onClose={() => setAddOpen(false)}
        footer={<>
          <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button type="submit" form="add-venue">Add venue</Button>
        </>}>
        <form id="add-venue" onSubmit={createVenue} className="space-y-3">
          <TextField label="Venue name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus maxLength={80} />
          <Alert tone="warn">Venues added by hand are not linked to the Calendar, so their events can&rsquo;t be matched. Prefer Import from Calendar.</Alert>
        </form>
      </Modal>

      <Toast toast={toast} onClose={hideToast} />
    </div>
  )
}
