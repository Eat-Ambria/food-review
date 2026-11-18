// =============================================================================
// WHAT THIS FILE IS
//   Admin → Serious alerts: the keywords that make a complaint "serious", who
//   receives the WhatsApp alert, and a test button.
// WHY IT EXISTS
//   When a submitted complaint contains one of these words (Hindi or English),
//   the process-issue function flags it Serious and sends a WhatsApp message to
//   every POC who has a mobile number, through Whapi.Cloud (the same service as
//   the attendance "Aria" bot). Matching is on whole words: "aag" does not match
//   inside "aage".
//   The recipients list shows every POC, and points out who has no usable
//   mobile number (add it under Users).
// USED BY
//   App.tsx route "/admin/alerts"
// DEPENDS ON
//   table alert_keywords (migration 16), process-issue action "whatsapp_test"
// =============================================================================
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { listUsers } from '../../services/userAdminService'
import type { ManagedUser } from '../../types/users'
import { rolesOf } from '../../types/auth'
import { Button } from '../../components/ui/Button'
import { inputClass } from '../../components/ui/Field'
import { Alert, Card, PageHeader, SectionHeader } from '../../components/ui/Layout'
import { Icon } from '../../components/Icon'

interface Keyword { id: string; keyword: string }

// Starting ideas, shown as one-tap suggestions (nothing is added until tapped).
const SUGGESTIONS = ['aag', 'आग', 'fire', 'dhuan', 'धुआं', 'smoke', 'short circuit', 'current', 'करंट', 'chot', 'चोट',
  'injury', 'ambulance', 'behosh', 'बेहोश', 'gas leak', 'police', 'ladai', 'लड़ाई', 'fight', 'chori', 'चोरी', 'food poisoning', 'ulti', 'उल्टी']

const usableNumber = (m: string | null) => {
  const d = (m ?? '').replace(/\D/g, '')
  return (d.length === 10 && /^[6-9]/.test(d)) || (d.length === 12 && d.startsWith('91')) || (d.length === 11 && d.startsWith('0'))
}

export function AlertsPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [pocs, setPocs] = useState<ManagedUser[]>([])
  const [newKw, setNewKw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('alert_keywords').select('id, keyword').order('created_at')
    if (e) setError('Could not load keywords. ' + e.message)
    else setKeywords((data ?? []) as Keyword[])
    try { setPocs((await listUsers()).filter((u) => u.is_active && rolesOf(u).includes('poc'))) } catch { /* shown as empty */ }
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

  const sendTest = async () => {
    setTesting(true); setTestMsg(null)
    const { error: e } = await supabase.functions.invoke('process-issue', { body: { action: 'whatsapp_test', to: testTo } })
    if (e) {
      let text = 'Could not send.'
      if (e instanceof FunctionsHttpError) { try { text = (await e.context.json())?.error ?? text } catch { /* keep */ } }
      setTestMsg({ ok: false, text })
    } else setTestMsg({ ok: true, text: 'Sent. Check WhatsApp on that phone.' })
    setTesting(false)
  }

  const have = new Set(keywords.map((k) => k.keyword.toLowerCase()))
  const withNumber = pocs.filter((p) => usableNumber(p.mobile_number))
  const withoutNumber = pocs.filter((p) => !usableNumber(p.mobile_number))

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Serious alerts"
        description={<>If a complaint contains any of these words, it is marked <b className="font-semibold text-danger">Serious</b> and every POC gets a WhatsApp message straight away.</>} />

      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      <div className="space-y-4">
        {/* Keywords */}
        <Card as="section" className="p-5 md:p-6">
          <SectionHeader title={<>Keywords{keywords.length > 0 && <span className="ml-2 font-semibold text-muted">{keywords.length}</span>}</>}
            description={<>Add both spellings, e.g. <b className="text-ink">aag</b> and <b className="text-ink">आग</b>. Whole words only: &ldquo;aag&rdquo; does not match &ldquo;aage&rdquo;.</>} />
          <div className="mt-4 flex flex-wrap gap-1.5">
            {keywords.length === 0 && <p className="text-sm text-muted">No keywords yet, so nothing is treated as serious.</p>}
            {keywords.map((k) => (
              <span key={k.id} className="inline-flex items-center gap-0.5 rounded-full bg-danger-soft py-1 pl-3 pr-1 text-[13px] font-semibold text-danger">
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

        {/* Recipients */}
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
                      <span className="truncate font-semibold">{p.name}</span>
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

        {/* Test */}
        <Card as="section" className="p-5 md:p-6">
          <SectionHeader title="Send a test message" description="Checks that WhatsApp sending works (Whapi token set up)." />
          <div className="mt-4 flex flex-wrap gap-2">
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} inputMode="tel" placeholder="10-digit mobile number" aria-label="Test number"
              className={inputClass('md', 'w-full sm:w-60')} />
            <Button variant="secondary" loading={testing} disabled={!testTo.trim()} onClick={() => void sendTest()}>Send test</Button>
          </div>
          {testMsg && <Alert tone={testMsg.ok ? 'ok' : 'danger'} className="mt-3">{testMsg.text}</Alert>}
        </Card>
      </div>
    </div>
  )
}
