// Record a complaint, check the transcript and the matched function, then submit it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { RECORDER_ERROR_TEXT, useRecorder, type Recording } from '../../hooks/useRecorder'
import { deleteDraft, loadDraft, saveDraft, updateDraft } from '../../services/draftStore'
import { TranscriptionError, transcribe, type TranscriptionState } from '../../services/sarvamService'
import { matchEvent } from '../../services/eventCalendarService'
import { EventMatchCard } from '../../components/EventMatchCard'
import type { EventMatch } from '../../types/events'
import { DuplicateError, submitRecording, type DuplicateInfo, type SubmitResult } from '../../services/submitService'

const AUTO_RETRY_MAX = 6
const autoRetryDelay = (n: number) => Math.round(8000 * 1.6 ** n * (0.7 + Math.random() * 0.6))
import { AudioPlayer } from '../../components/AudioPlayer'
import { fmtTime } from '../../utils/format'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { Icon } from '../../components/Icon'
import { Alert, Card, PageHeader, Skeleton } from '../../components/ui/Layout'
import { Spinner } from '../../components/ui/Spinner'
import { CategoryChip } from '../../components/CategoryChip'
import { ItemTag } from '../../components/ItemTag'
import { IssuesByItem } from '../../components/IssuesByItem'

const MAX_SECONDS = 120
const WARN_AT = MAX_SECONDS - 15
const BARS = 40

type TxPhase = 'none' | 'running' | 'ready' | 'failed'
interface TxStatus { phase: TxPhase; done: number; total: number; error?: string; retryable?: boolean; retryAt?: string | null }

const idleAmp = (i: number) => {
  const x = i / (BARS - 1)
  const hump = (c: number, h: number, w: number) => h * Math.exp(-((x - c) ** 2) / (2 * w * w))
  return 0.14 + Math.max(hump(0.18, 0.55, 0.05), hump(0.5, 1, 0.045), hump(0.8, 0.6, 0.05), 0.18 * Math.sin(Math.PI * x))
}

function WaveLoader({ big = false }: { big?: boolean }) {
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center gap-[3px] rounded-full bg-[#fbecc7] ${big ? 'size-12' : 'size-8'}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`wave-bar w-[3px] rounded-full bg-marigold ${big ? 'h-5' : 'h-3.5'}`} style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  )
}

function WaitingCard({ until }: { until: string }) {
  const end = new Date(until).getTime() + 2000
  const [start] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  const total = Math.max(1, end - start)
  const pct = Math.min(100, Math.max(6, ((now - start) / total) * 100))
  const left = Math.max(0, Math.ceil((end - now) / 1000))
  return (
    <Card className="p-5">
      <div role="status" className="flex items-center gap-3.5">
        <WaveLoader big />
        <div className="min-w-0">
          <p className="font-semibold">Processing your recording…</p>
          <p className="mt-0.5 text-sm text-muted">Your recording is safe. {left > 0 ? `Starting in ${left} s` : 'Starting now'}</p>
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-marigold transition-[width] duration-300 ease-linear" style={{ width: `${pct}%` }} />
      </div>
    </Card>
  )
}

const idleColour = (amp: number) => {
  const k = Math.max(0, Math.min(1, (amp - 0.35) / 0.65))
  const mix = (a: number, b: number) => Math.round(a + (b - a) * k)
  return `rgb(${mix(196, 120)} ${mix(200, 128)} ${mix(208, 142)})`
}

function mirrored(levels: number[]) {
  const half = levels.slice(-Math.ceil(levels.length / 2))
  const n = half.length
  const left = half.map((v, i) => ({ v, age: (n - 1 - i) / Math.max(1, n - 1) }))
  return [...left, ...[...left].reverse()].slice(0, levels.length)
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

export function RecordPage() {
  const { user } = useAuth()

  const userId = user?.id
  const rec = useRecorder(MAX_SECONDS)
  const [bars, setBars] = useState<number[]>(() => Array(BARS).fill(0))
  const [saved, setSaved] = useState<'no' | 'yes' | 'failed'>('no')
  const [recoveredAt, setRecoveredAt] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const [tx, setTx] = useState<TxStatus>({ phase: 'none', done: 0, total: 0 })
  const [rawText, setRawText] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [match, setMatch] = useState<EventMatch | null>(null)
  const [matchLoading, setMatchLoading] = useState(false)
  const [matchError, setMatchError] = useState<string | null>(null)
  const matchedTextRef = useRef<string | null>(null)
  const [chosenEventId, setChosenEventId] = useState<string | null>(null)
  const eventCardRef = useRef<HTMLDivElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null)
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null)
  const [autoRetries, setAutoRetries] = useState(0)

  const sentRef = useRef<Parameters<typeof submitRecording>[0] | null>(null)
  const partialRef = useRef<TranscriptionState | null>(null)
  const runIdRef = useRef(0)
  const clientIdRef = useRef<string | null>(null)

  const transcriptRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = transcriptRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [text, tx.phase])

  const levelRef = useRef(0)
  levelRef.current = rec.level

  const runTranscription = useCallback(async (blob: Blob) => {
    if (!userId) return
    if (!clientIdRef.current) clientIdRef.current = crypto.randomUUID()
    const clientId = clientIdRef.current
    const runId = ++runIdRef.current
    if (!navigator.onLine) {
      setTx({ phase: 'failed', done: 0, total: 0, retryable: true,
        error: 'You are offline. Your recording is saved; it will be transcribed when you are back online.' })
      return
    }
    setTx({ phase: 'running', done: 0, total: 0 })
    try {
      const res = await transcribe(blob, clientId, (done, total) => {
        if (runId === runIdRef.current) setTx({ phase: 'running', done, total })
      }, partialRef.current)
      if (runId !== runIdRef.current) return
      partialRef.current = null
      setRawText(res.text)
      setText(res.text)
      setTx({ phase: 'ready', done: res.state.total, total: res.state.total })
      await updateDraft(userId, {
        rawTranscript: res.text, editedTranscript: res.text,
        transcriptionState: undefined, transcriptionMeta: res.meta,
      })
    } catch (e) {
      if (runId !== runIdRef.current) return
      const err = e instanceof TranscriptionError ? e : new TranscriptionError('Transcription failed. Please retry.', true, null)
      partialRef.current = err.partial
      if (err.partial) await updateDraft(userId, { transcriptionState: err.partial })
      setTx({ phase: 'failed', done: err.partial ? err.partial.results.filter(Boolean).length : 0,
        total: err.partial?.total ?? 0, error: err.message, retryable: err.retryable, retryAt: err.retryAt })
    }
  }, [userId])

  const { restore } = rec
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void loadDraft(userId).then((d) => {
      if (cancelled || !d) return
      restore({ blob: d.blob, mimeType: d.mimeType, durationSec: d.durationSec })
      clientIdRef.current = d.clientSubmissionId
      setRecoveredAt(d.createdAt)
      setSaved('yes')
      if (d.rawTranscript !== undefined) {
        setRawText(d.rawTranscript)
        if (d.eventMatch) { setMatch(d.eventMatch); matchedTextRef.current = d.editedTranscript ?? d.rawTranscript }
        setText(d.editedTranscript ?? d.rawTranscript)
        setTx({ phase: 'ready', done: 1, total: 1 })
      } else {
        partialRef.current = d.transcriptionState ?? null
        void runTranscription(d.blob)
      }
    })
    return () => { cancelled = true }
  }, [userId, restore, runTranscription])

  const lastHandledRef = useRef<Recording | null>(null)
  useEffect(() => {
    const r = rec.recording
    if (!userId || !r || r === lastHandledRef.current || recoveredAt) return
    lastHandledRef.current = r
    partialRef.current = null
    clientIdRef.current = crypto.randomUUID()
    setRawText(null)
    setText('')
    setMatch(null)
    setMatchError(null)
    matchedTextRef.current = null
    void saveDraft({
      userId,
      clientSubmissionId: clientIdRef.current,
      blob: r.blob,
      mimeType: r.mimeType,
      durationSec: r.durationSec,
      createdAt: new Date().toISOString(),
    }).then((ok) => {
      setSaved(ok ? 'yes' : 'failed')
      void runTranscription(r.blob)
    })
  }, [userId, rec.recording, recoveredAt, runTranscription])

  useEffect(() => {
    if (tx.phase !== 'failed' || !tx.retryAt || !rec.recording) return
    const blob = rec.recording.blob
    const ms = Math.max(1000, new Date(tx.retryAt).getTime() - Date.now() + 2000)

    const id = setTimeout(() => void runTranscription(blob), Math.min(ms, 2 ** 31 - 1))
    return () => clearTimeout(id)
  }, [tx.phase, tx.retryAt, rec.recording, runTranscription])

  useEffect(() => {
    if (tx.phase !== 'failed' || !tx.retryable || tx.retryAt || !rec.recording) return
    const blob = rec.recording.blob
    const onOnline = () => void runTranscription(blob)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [tx.phase, tx.retryable, tx.retryAt, rec.recording, runTranscription])

  useEffect(() => {
    if (!userId || tx.phase !== 'ready' || !text.trim() || text === matchedTextRef.current) return
    let cancelled = false
    const id = setTimeout(async () => {
      setMatchLoading(true)
      setMatchError(null)
      try {
        const m = await matchEvent(text)
        if (cancelled) return
        matchedTextRef.current = text
        setMatch(m)

        setChosenEventId((prev) => (prev === 'none' || m.candidates?.some((c) => c.calendar_event_id === prev)) ? prev : null)
        await updateDraft(userId, { eventMatch: m })
      } catch (e) {
        if (!cancelled) setMatchError((e as Error).message)
      } finally {
        if (!cancelled) setMatchLoading(false)
      }
    }, 1200)
    return () => { cancelled = true; clearTimeout(id); setMatchLoading(false) }
  }, [userId, text, tx.phase])

  useEffect(() => {
    if (!userId || tx.phase !== 'ready') return
    const id = setTimeout(() => void updateDraft(userId, { editedTranscript: text }), 500)
    return () => clearTimeout(id)
  }, [userId, text, tx.phase])

  useEffect(() => {
    if (rec.status !== 'recording') return
    setBars(Array(BARS).fill(0))
    const id = setInterval(() => setBars((b) => [...b.slice(1), levelRef.current]), 80)
    return () => clearInterval(id)
  }, [rec.status])

  const startRecording = useCallback(() => {
    setRecoveredAt(null)
    setSaved('no')
    setTx({ phase: 'none', done: 0, total: 0 })
    void rec.start()
  }, [rec])

  const doSubmit = async (allowDuplicate = false) => {
    const r = rec.recording
    if (!userId || !r || !clientIdRef.current || !text.trim() || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    setDuplicate(null)
    try {
      await updateDraft(userId, { editedTranscript: text })
      const d = await loadDraft(userId)
      const input = {
        userId,
        clientSubmissionId: clientIdRef.current,
        blob: r.blob,
        mimeType: r.mimeType,
        durationSec: r.durationSec,
        reviewedTranscript: text.trim(),
        rawTranscript: rawText,
        transcriptionMeta: d?.transcriptionMeta,
        allowDuplicate,
        chosenCalendarEventId: match?.status === 'ambiguous' ? chosenEventId : null,
      }
      const result = await submitRecording(input)

      sentRef.current = input
      await deleteDraft(userId)
      setAutoRetries(0)
      setSubmitted(result)
    } catch (e) {
      if (e instanceof DuplicateError) setDuplicate(e.info)
      else setSubmitError((e as Error).message)
    }
    setSubmitting(false)
  }

  useEffect(() => {
    if (!submitted || submitted.status !== 'failed' || !submitted.will_retry || autoRetries >= AUTO_RETRY_MAX || !sentRef.current) return
    let cancelled = false
    const id = setTimeout(async () => {
      try {
        const again = await submitRecording(sentRef.current!)
        if (!cancelled) setSubmitted(again)
      } catch { }
      if (!cancelled) setAutoRetries((n) => n + 1)
    }, autoRetryDelay(autoRetries))
    return () => { cancelled = true; clearTimeout(id) }
  }, [submitted, autoRetries])

  const discard = async () => {
    runIdRef.current++
    if (userId) await deleteDraft(userId)
    setSubmitted(null)
    setSubmitError(null)
    setDuplicate(null)
    setAutoRetries(0)
    setChosenEventId(null)
    sentRef.current = null
    lastHandledRef.current = null
    partialRef.current = null
    clientIdRef.current = null
    setRecoveredAt(null)
    setSaved('no')
    setConfirmDiscard(false)
    setTx({ phase: 'none', done: 0, total: 0 })
    setRawText(null)
    setText('')
    setMatch(null)
    setMatchError(null)
    matchedTextRef.current = null
    rec.discard()
  }

  const recording = rec.status === 'recording'

  const mustChoose = !matchLoading && match?.status === 'ambiguous' && (match.candidates?.length ?? 0) > 1 && !chosenEventId
  const remaining = MAX_SECONDS - rec.elapsed
  const edited = rawText !== null && text !== rawText

  if (submitted) {
    const n = submitted.issues.length
    const headline = submitted.status === 'pending_assignment' || submitted.status === 'assigned'
      ? `Submitted. ${n} issue${n === 1 ? '' : 's'} found.`
      : submitted.status === 'needs_review'
        ? 'Submitted. No clear issue was found, so an admin will review it.'
        : submitted.status === 'failed'
          ? (submitted.will_retry
              ? (autoRetries < AUTO_RETRY_MAX
                  ? 'Saved. Reading the issues… trying again.'
                  : 'Saved. The issues will be read automatically in a few minutes.')
              : 'Submitted and saved, but reading the issues failed. An admin will check it.')
          : 'Submitted. It is being processed.'
    const retrying = submitted.status === 'failed' && submitted.will_retry
    const good = submitted.status === 'pending_assignment' || submitted.status === 'assigned'
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="overflow-hidden">
          <div className="px-5 pb-5 pt-6 md:px-6">
            <span className={`flex size-11 items-center justify-center rounded-full ${good ? 'bg-ok-soft text-ok' : retrying ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
              {retrying && autoRetries < AUTO_RETRY_MAX ? <Spinner className="size-5" /> : <Icon name="check" className="size-6" strokeWidth={2.4} />}
            </span>
            <h1 className="mt-4 font-serif text-[1.9rem] font-normal leading-tight tracking-[-0.02em] md:text-[2.3rem]">{headline}</h1>
            {submitted.already_submitted && <p className="mt-1 text-sm text-muted">This recording had already been submitted. Nothing was duplicated.</p>}
            {retrying && (
              <Alert tone="warn" className="mt-4">Your complaint is safely saved. Please don&rsquo;t record it again.</Alert>
            )}
            {submitted.status === 'failed' && submitted.error && <p className="mt-2 text-xs text-muted">Reason: {submitted.error}</p>}
          </div>

          {n > 0 && (

            <IssuesByItem className="border-t border-line px-5 py-5 md:px-6"
              issues={submitted.issues} itemOf={(it) => it.item} categoryOf={(it) => it.category_raw}
              renderIssue={(it) => (
                <div>
                  <CategoryChip name={it.category_raw ?? 'Other'} />
                  <p className="mt-1.5 text-sm leading-relaxed">{it.ai_summary ?? it.description}</p>

                  <p className="mt-1 flex items-start gap-1.5 text-xs text-muted">
                    <Icon name="pin" className="mt-px size-3.5 shrink-0" />
                    {[it.venue?.venue_name,
                      [it.event_info?.guest_name, it.event_info?.function_name].filter(Boolean).join(' · ') || null,
                      it.event_info?.shift, it.location].filter(Boolean).join(' · ') || 'Venue not identified'}
                  </p>
                </div>
              )} />
          )}

          <div className="border-t border-line bg-subtle px-5 py-5 md:px-6">
            <p className="text-sm font-bold">What you said</p>
            {rec.recording && <div className="mt-3"><AudioPlayer blob={rec.recording.blob} durationSec={rec.recording.durationSec} /></div>}
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink/85">{text}</p>
          </div>
        </Card>

        <p className="mt-4 text-center text-xs text-muted">All POCs can now see these issues. Follow them under My submissions.</p>
        <Button size="lg" className="mt-4 w-full" onClick={() => void discard()}><Icon name="mic" />Record another issue</Button>
      </div>
    )
  }

  const warn = recording && rec.elapsed >= WARN_AT

  return (
    <div className="mx-auto max-w-[52rem]">
      <PageHeader align="center" title="Record an issue"
        description={<>Say the venue, the guest or function, and then each problem. The date is taken as <b className="font-bold text-ink">today</b> unless you say another day (e.g. &ldquo;kal&rdquo;). Hindi, English or both are fine.</>} />

      {rec.status !== 'stopped' && (

        <section data-no-pull={recording || rec.status === 'requesting' ? '' : undefined}
          className={`relative isolate mx-auto flex max-w-[51rem] flex-col items-center overflow-hidden rounded-[2rem] border border-white/90 bg-white/80 px-5 pb-7 pt-6 backdrop-blur-sm md:pb-11 md:pt-9 transition-shadow duration-300
          ${recording ? 'shadow-[0_30px_60px_-28px_rgb(192_60_11/0.45)]' : 'shadow-float'}`}>

          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 transition-opacity duration-500"
            style={{
              opacity: recording ? 0.55 + Math.min(rec.level, 1) * 0.45 : 1,
              background: recording
                ? 'radial-gradient(circle at 50% 74%, rgb(192 60 11 / 0.14), transparent 45%)'
                : 'radial-gradient(circle at 50% 74%, rgb(224 162 37 / 0.14), transparent 40%)',
            }} />

          <span className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors
            ${recording ? 'bg-danger-soft text-danger' : rec.status === 'requesting' ? 'bg-accent-soft text-accent' : 'bg-ink/[0.05] text-ink'}`}>
            <span className={`size-2 rounded-full ${recording ? 'rec-dot bg-danger' : rec.status === 'requesting' ? 'bg-marigold' : 'bg-[#22a35a]'}`} />
            {recording ? 'Recording' : rec.status === 'requesting' ? 'Starting mic' : 'Ready'}
          </span>

          <p className={`mt-3 text-5xl font-bold leading-none tabular-nums tracking-tight transition-colors md:mt-4 md:text-[3.5rem] ${warn ? 'text-danger' : 'text-ink'}`}>
            {fmtTime(rec.elapsed)}
          </p>
          <p className="mt-2 text-[15px] text-ink/60">{recording ? `${fmtTime(remaining)} left` : 'Up to 2:00'}</p>

          <div className="mt-5 flex h-12 w-full max-w-md items-center justify-between px-1 md:mt-7 md:h-14" aria-hidden="true">
            {recording
              ? mirrored(bars).map(({ v, age }, i) => (
                <span key={i}
                  className={`h-full w-[3px] rounded-full transition-transform duration-100 ease-out ${warn ? 'bg-danger' : 'bg-ink'}`}
                  style={{ transform: `scaleY(${Math.max(0.08, Math.min(1, v * 1.2))})`, opacity: 1 - age * 0.75 }} />
              ))
              : bars.map((_, i) => (
                <span key={i} className="wave-idle h-full w-[3px] rounded-full"
                  style={{ '--amp': idleAmp(i), animationDelay: `${-i * 60}ms`, background: idleColour(idleAmp(i)) } as React.CSSProperties} />
              ))}
          </div>

          <div className="relative mt-6 flex size-36 items-center justify-center md:mt-10 md:size-40">
            {!recording && (
              <>

                <span aria-hidden="true" className="sonar sonar-slow pointer-events-none absolute inset-[11px] rounded-full border border-marigold/50" />

                <span aria-hidden="true" className="pointer-events-none absolute inset-[11px] rounded-full bg-[conic-gradient(from_210deg,#f6e3ae,#e0a225,#f3d27f,#c98f1c,#f6e3ae)] shadow-[0_8px_30px_-6px_rgb(224_162_37/0.35)]" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-[14px] rounded-full bg-[#fbf6ea]" />
              </>
            )}
            {recording && (
              <>

                {[
                  { inset: 'inset-[18px]', tint: 'bg-danger/20', gain: 0.22, ms: 120, delay: '0s' },
                  { inset: 'inset-[8px]', tint: 'bg-danger/12', gain: 0.4, ms: 220, delay: '0.4s' },
                  { inset: 'inset-0', tint: 'bg-danger/[0.07]', gain: 0.6, ms: 340, delay: '0.8s' },
                ].map((o, i) => (
                  <span key={i} aria-hidden="true" className={`pointer-events-none absolute ${o.inset} rounded-full`}
                    style={{ transform: `scale(${1 + Math.min(rec.level, 1) * o.gain})`, transition: `transform ${o.ms}ms cubic-bezier(0.2, 0.7, 0.3, 1)` }}>
                    <span className={`orb-breathe block size-full rounded-full ${o.tint}`} style={{ animationDelay: o.delay }} />
                  </span>
                ))}
              </>
            )}
            <button type="button"
              onClick={recording ? rec.stop : startRecording}
              disabled={rec.status === 'requesting'}
              aria-label={recording ? 'Stop recording' : 'Start recording'}
              className={`group relative flex size-[6.5rem] items-center justify-center overflow-hidden rounded-full md:size-[7.25rem] text-white transition-[box-shadow,transform] duration-300 hover:scale-[1.04] active:scale-95 disabled:opacity-60 motion-reduce:transform-none
                focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-marigold/50
                ${recording
                  ? 'bg-[radial-gradient(circle_at_35%_25%,#e2683a,var(--color-danger)_60%)] shadow-[0_12px_30px_-10px_rgb(192_60_11/0.7)]'
                  : 'bg-[radial-gradient(circle_at_35%_25%,#36435e,#1b2539_55%,#141c2c)] shadow-[inset_0_-6px_14px_rgb(0_0_0/0.25),0_10px_24px_-10px_rgb(23_32_51/0.6)]'}`}>
              {rec.status === 'requesting'
                ? <Spinner className="size-7" />
                : <span key={recording ? 'stop' : 'mic'} className="icon-pop relative">
                    <Icon name={recording ? 'stop' : 'mic'} className="size-10" strokeWidth={recording ? 0 : 1.8} fill={recording ? 'currentColor' : 'none'} />
                  </span>}
            </button>
          </div>

          <p className={`mt-5 text-base md:mt-7 md:text-[17px] ${warn ? 'font-medium text-danger' : 'text-ink/80'}`} role="status">
            {rec.status === 'requesting' && 'Allow microphone access…'}
            {rec.status === 'idle' && 'Tap to start recording'}
            {recording && (warn ? 'Less than 15 seconds left' : 'Recording… tap to stop')}
          </p>

          {rec.error && <Alert tone="danger" className="mt-6 w-full max-w-sm">{RECORDER_ERROR_TEXT[rec.error]}</Alert>}
        </section>
      )}

      {rec.status === 'stopped' && rec.recording && (
        <section className="mx-auto max-w-2xl space-y-4">
          {recoveredAt && (
            <Alert tone="info" icon="refresh">
              Recovered your unsent recording from {new Date(recoveredAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.
            </Alert>
          )}
          {rec.recording.durationSec >= MAX_SECONDS - 0.5 && (
            <Alert tone="warn" icon="clock">The 2-minute limit was reached, so recording stopped automatically.</Alert>
          )}

          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-bold">Your recording</p>
              <p className="flex items-center gap-1.5 text-xs text-muted">
                {saved === 'yes' && <><Icon name="checkCircle" className="size-3.5 text-ok" />Saved on this device</>}
                {saved === 'failed' && <><Icon name="alert" className="size-3.5 text-warn" />Not backed up</>}
              </p>
            </div>
            <AudioPlayer blob={rec.recording.blob} durationSec={rec.recording.durationSec} />
            {saved === 'failed' && (
              <p className="mt-3 text-xs leading-relaxed text-warn">Could not save a backup on this device (private browsing?). Don&rsquo;t close the app until it is submitted.</p>
            )}
          </Card>

          {tx.phase === 'running' && (
            <Card className="p-5">
              <div role="status" className="flex items-center gap-3">
                <WaveLoader />
                <p className="text-sm font-semibold">Transcribing{tx.total > 1 ? ` part ${Math.min(tx.done + 1, tx.total)} of ${tx.total}` : ''}…</p>
              </div>
              <div className="mt-4 h-1 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-marigold transition-[width] duration-500"
                  style={{ width: `${tx.total ? Math.max(8, (tx.done / tx.total) * 100) : 8}%` }} />
              </div>
              <div className="mt-5 space-y-2" aria-hidden="true">
                <Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-11/12" /><Skeleton className="h-3.5 w-3/5" />
              </div>
            </Card>
          )}

          {tx.phase === 'failed' && tx.retryAt && new Date(tx.retryAt).getTime() - Date.now() < 120_000 && (
            <WaitingCard until={tx.retryAt} />
          )}

          {tx.phase === 'failed' && tx.retryAt && new Date(tx.retryAt).getTime() - Date.now() >= 120_000 && (
            <Alert tone="warn" icon="clock" title="Your recording is saved">
              Many recordings were sent in a short time, so this one will be transcribed automatically at <b>{clock(tx.retryAt)}</b>. Keep this page open, or come back after that time.
            </Alert>
          )}

          {tx.phase === 'failed' && !tx.retryAt && (
            <Alert tone="danger" title={tx.error}
              action={tx.retryable ? (
                <Button size="sm" variant="secondary" onClick={() => void runTranscription(rec.recording!.blob)}>
                  <Icon name="refresh" />Retry
                </Button>
              ) : undefined}>
              {tx.total > 0 && tx.done > 0 ? <>{tx.done} of {tx.total} parts are done and won&rsquo;t be sent again.</> : null}
            </Alert>
          )}

          {tx.phase === 'ready' && (
            <Card className="p-4">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="transcript" className="text-sm font-bold">Transcript</label>
                {edited && (
                  <span className="flex items-center gap-2">
                    <Badge tone="accent">Edited</Badge>
                    <button type="button" onClick={() => setText(rawText ?? '')} className="text-xs font-semibold text-muted underline-offset-2 hover:text-ink hover:underline">
                      Undo my changes
                    </button>
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">Check names, venue and dates. Correct anything that was heard wrong.</p>

              <textarea id="transcript" ref={transcriptRef} value={text} onChange={(e) => setText(e.target.value)}
                rows={3} maxLength={5000} spellCheck={false}
                className="mt-3 max-h-64 min-h-22 w-full resize-none overflow-y-auto rounded-lg border border-line bg-surface px-3.5 py-3 text-[15px] leading-relaxed outline-none transition-[border-color,box-shadow] hover:border-line-strong focus:border-ink/60 focus:ring-[3px] focus:ring-ink/[0.06]" />
              <p className={`mt-1 text-right text-xs tabular-nums ${text.length > 4800 ? 'text-warn' : 'text-faint'}`}>{text.length} / 5000</p>
            </Card>
          )}

          {tx.phase === 'ready' && (
            <div ref={eventCardRef} className="scroll-mt-24">
              <EventMatchCard match={match} loading={matchLoading} error={matchError} chosenId={chosenEventId} onChoose={setChosenEventId} />
            </div>
          )}

          {submitError && <Alert tone="danger">{submitError}</Alert>}

          <div aria-hidden="true" className="h-20 md:hidden" />
          <div className="fixed inset-x-0 bottom-0 z-30 rounded-t-2xl bg-surface px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_30px_-18px_rgb(23_32_51/0.35)] ring-1 ring-black/5 md:static md:rounded-none md:bg-transparent md:p-0 md:shadow-none md:ring-0">
            {mustChoose && (
              <button type="button" onClick={() => eventCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="mb-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent-soft px-3 py-2 text-[13px] font-semibold text-[#7a5408]">
                <Icon name="alert" className="size-4" />Choose the function above to submit (or &ldquo;None of these&rdquo;)
              </button>
            )}
            <div className="flex gap-2.5">
              <Button variant="secondary" size="lg" className="flex-1 px-3" onClick={() => setConfirmDiscard(true)}
                disabled={tx.phase === 'running' || submitting} title={tx.phase === 'running' ? 'Wait for the transcript first' : undefined}>
                <Icon name="refresh" />Record again
              </Button>
              <Button size="lg" className="flex-[1.5]" loading={submitting} disabled={tx.phase !== 'ready' || !text.trim() || mustChoose || matchLoading}
                onClick={() => void doSubmit(false)}>
                {submitting ? 'Submitting…' : <>Submit<Icon name="arrowLeft" className="rotate-180" /></>}
              </Button>
            </div>
            {submitting && <p className="mt-2 text-center text-xs text-muted">Uploading and reading the issues… this can take a few seconds.</p>}
          </div>
        </section>
      )}

      <Modal open={Boolean(duplicate)} title="Already sent?" onClose={() => setDuplicate(null)}
        footer={<>
          <Button variant="secondary" onClick={() => void discard()}>Don&rsquo;t send</Button>
          <Button loading={submitting} onClick={() => void doSubmit(true)}>Send anyway</Button>
        </>}>
        {duplicate && (
          <div className="space-y-3 text-sm leading-relaxed">
            <p>
              You sent an almost identical complaint at{' '}
              <b>{new Date(duplicate.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</b>.
              Sending it again would create the same issues twice.
            </p>
            {duplicate.issues.length > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {duplicate.issues.map((i, k) => (
                  <li key={k} className="px-3 py-2.5">
                    <span className="flex flex-wrap items-center gap-1.5"><span className="font-semibold">{i.category_raw ?? 'Other'}</span><ItemTag item={i.item} category={i.category_raw} size="sm" /></span>
                    <span className="mt-0.5 block text-muted">{i.ai_summary}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">Choose <b className="text-ink">Send anyway</b> only if this is a new, separate problem.</p>
          </div>
        )}
      </Modal>

      <Modal open={confirmDiscard} title="Record again?" onClose={() => setConfirmDiscard(false)}
        footer={<>
          <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>Keep it</Button>
          <Button variant="danger" onClick={() => void discard()}><Icon name="trash" />Delete and re-record</Button>
        </>}>
        <p className="text-sm leading-relaxed text-muted">The current recording and its transcript will be deleted from this device.</p>
      </Modal>
    </div>
  )
}
