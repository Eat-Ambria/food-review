// Admin page to manage the serious-issue keywords and see who gets the WhatsApp alerts.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { listUsers } from '../../services/userAdminService'
import { listVenues } from '../../services/venueService'
import { matchKeywords, placeNames, placesContaining } from '../../utils/seriousMatch'
import type { ManagedUser } from '../../types/users'
import { rolesOf } from '../../types/auth'
import { Button } from '../../components/ui/Button'
import { inputClass } from '../../components/ui/Field'
import { Alert, Card, PageHeader, SectionHeader } from '../../components/ui/Layout'
import { Icon } from '../../components/Icon'
import { personName } from '../../utils/personName'

interface Keyword { id: string; keyword: string }

const SUGGESTIONS = ['food poisoning', 'ulti', 'aag', 'injury']

const usableNumber = (m: string | null) => {
  const d = (m ?? '').replace(/\D/g, '')
  return (d.length === 10 && /^[6-9]/.test(d)) || (d.length === 12 && d.startsWith('91')) || (d.length === 11 && d.startsWith('0'))
}

export function AlertsPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [pocs, setPocs] = useState<ManagedUser[]>([])
  const [newKw, setNewKw] = useState('')
  const [places, setPlaces] = useState<string[]>([])
  const [sample, setSample] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('alert_keywords').select('id, keyword').order('created_at')
    if (e) setError('Could not load keywords. ' + e.message)
    else setKeywords((data ?? []) as Keyword[])
    try { setPocs((await listUsers()).filter((u) => u.is_active && rolesOf(u).includes('poc'))) } catch { }
    try { setPlaces(placeNames(await listVenues(true))) } catch { }
  }, [])
  useEffect(() => { void load() }, [load])

  const add = async (kw: string) => {
    const clean = kw.trim().replace(/\s+/g, ' ')
    if (clean.length < 2) return
    setError(null)
    const { error: e } = await supabase.from('alert_keywords').insert({ keyword: clean })
    if (e && e.code !== '23505') setError('Could not add. ' + e.message)
    setNewKw('')
    void load()
  }
  const remove = async (id: string) => {
    await supabase.from('alert_keywords').delete().eq('id', id)
    void load()
  }
  const onSubmit = (e: FormEvent) => { e.preventDefault(); void add(newKw) }

  const have = new Set(keywords.map((k) => k.keyword.toLowerCase()))
  const clashes = keywords.map((k) => ({ k, in: placesContaining(k.keyword, places) })).filter((c) => c.in.length > 0)
  const clashOf = new Map(clashes.map((c) => [c.k.id, c.in]))
  const newClash = placesContaining(newKw, places)
  const found = sample.trim() ? matchKeywords(keywords.map((k) => k.keyword), [sample], places) : []
  const withNumber = pocs.filter((p) => usableNumber(p.mobile_number))
  const withoutNumber = pocs.filter((p) => !usableNumber(p.mobile_number))

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Serious alerts"
        description={<>If a complaint about food or drink being unsafe (something in it, stale, spoiled, people falling ill) contains any of these words, it is marked <b className="font-semibold text-danger">Serious</b> and every POC gets a WhatsApp message straight away. Venue, lawn and hall names are ignored, so &ldquo;Glass House&rdquo; does not count as &ldquo;glass&rdquo;.</>} />

      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      <div className="space-y-4">

        <Card as="section" className="p-5 md:p-6">
          <SectionHeader title={<>Keywords{keywords.length > 0 && <span className="ml-2 font-semibold text-muted">{keywords.length}</span>}</>}
            description={<>Add both spellings, e.g. <b className="text-ink">aag</b> and <b className="text-ink">आग</b>. Whole words only: &ldquo;aag&rdquo; does not match &ldquo;aage&rdquo;.</>} />
          <div className="mt-4 flex flex-wrap gap-1.5">
            {keywords.length === 0 && <p className="text-sm text-muted">No keywords yet, so nothing is treated as serious.</p>}
            {keywords.map((k) => (
              <span key={k.id} title={clashOf.has(k.id) ? `Also part of: ${clashOf.get(k.id)!.join(', ')}` : undefined}
                className={`inline-flex items-center gap-0.5 rounded-full py-1 pl-3 pr-1 text-[13px] font-semibold ${clashOf.has(k.id) ? 'bg-warn-soft text-warn' : 'bg-danger-soft text-danger'}`}>
                {clashOf.has(k.id) && <Icon name="alert" className="mr-1 size-3.5" />}
                {k.keyword}
                <button type="button" onClick={() => void remove(k.id)} aria-label={`Remove ${k.keyword}`} className="rounded-full p-0.5 transition-colors hover:bg-danger/15">
                  <Icon name="x" className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
          <form onSubmit={onSubmit} className="mt-4 flex gap-2">
            <input value={newKw} onChange={(e) => setNewKw(e.target.value)} placeholder="Add a word or phrase…" maxLength={60} aria-label="New keyword"
              className={inputClass('md', 'flex-1')} />
            <Button type="submit" disabled={newKw.trim().length < 2}><Icon name="plus" />Add</Button>
          </form>
          {newClash.length > 0 && (
            <p className="mt-2 text-xs text-warn">&ldquo;{newKw.trim()}&rdquo; is also part of {newClash.join(', ')}. Mentions of the venue are ignored, so only real food problems will count.</p>
          )}
          {clashes.length > 0 && (
            <Alert tone="warn" className="mt-4">
              {clashes.map((c) => <span key={c.k.id} className="block"><b>{c.k.keyword}</b> is also part of {c.in.join(', ')}.</span>)}
              <span className="mt-1 block text-xs">The venue name itself never makes a complaint serious. If the venue has a short name that is the same word, remove that keyword or rename the alias.</span>
            </Alert>
          )}
          {SUGGESTIONS.some((s) => !have.has(s.toLowerCase())) && (
            <div className="mt-5 border-t border-line pt-4">
              <p className="text-xs font-semibold text-muted">Suggestions (tap to add)</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SUGGESTIONS.filter((s) => !have.has(s.toLowerCase())).map((s) => (
                  <button type="button" key={s} onClick={() => void add(s)}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-danger/40 hover:bg-danger-soft hover:text-danger">
                    <Icon name="plus" className="size-3" />{s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card as="section" className="p-5 md:p-6">
          <SectionHeader title="Test a sentence" description="Type what staff might say to see which keywords it would catch. The AI also checks that it is really about food, so a match here is not always an alert." />
          <textarea value={sample} onChange={(e) => setSample(e.target.value)} rows={2} maxLength={500} aria-label="Sentence to test"
            placeholder="e.g. Glass House mein dal mein kaanch mila" className={inputClass('md', 'mt-4 h-auto! w-full resize-none py-2.5')} />
          {sample.trim() && (
            <p className="mt-2 text-sm">
              {found.length
                ? <>Would catch: {found.map((k) => <b key={k} className="mr-1.5 text-danger">{k}</b>)}</>
                : <span className="text-muted">No keyword caught.</span>}
            </p>
          )}
        </Card>

        <Card as="section" className="p-5 md:p-6">
          <SectionHeader title="Who gets the WhatsApp" description="Every active POC with a mobile number (not the person who recorded it)." />
          {pocs.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No POCs yet. Give users the POC role under <Link to="/admin/users" className="font-semibold text-ink underline underline-offset-2">Users</Link>.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
              {[...withNumber, ...withoutNumber].map((p) => {
                const ok = usableNumber(p.mobile_number)
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Icon name={ok ? 'checkCircle' : 'alert'} className={`size-4 shrink-0 ${ok ? 'text-ok' : 'text-warn'}`} />
                      <span className="truncate font-semibold">{personName(p.name)}</span>
                    </span>
                    <span className={`shrink-0 text-xs tabular-nums ${ok ? 'text-muted' : 'font-semibold text-warn'}`}>{ok ? p.mobile_number : 'No mobile number'}</span>
                  </li>
                )
              })}
            </ul>
          )}
          {withoutNumber.length > 0 && (
            <p className="mt-3 text-xs text-muted">Add the missing numbers under <Link to="/admin/users" className="font-semibold text-ink underline underline-offset-2">Users</Link>, then Edit.</p>
          )}
        </Card>

      </div>
    </div>
  )
}
