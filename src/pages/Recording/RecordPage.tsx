// Record a complaint and stop; it is saved and sent in the background, and the page is ready for the next one.
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { RECORDER_ERROR_TEXT, useRecorder, type Recording } from '../../hooks/useRecorder'
import { addToOutbox, onOutboxNotice } from '../../services/outbox'
import { fmtTime } from '../../utils/format'
import { Icon } from '../../components/Icon'
import { Alert, PageHeader } from '../../components/ui/Layout'
import { Spinner } from '../../components/ui/Spinner'
import { Toast, useToast } from '../../components/ui/Toast'

const MAX_SECONDS = 120
const WARN_AT = MAX_SECONDS - 15
const BARS = 40

const idleAmp = (i: number) => {
  const x = i / (BARS - 1)
  const hump = (c: number, h: number, w: number) => h * Math.exp(-((x - c) ** 2) / (2 * w * w))
  return 0.14 + Math.max(hump(0.18, 0.55, 0.05), hump(0.5, 1, 0.045), hump(0.8, 0.6, 0.05), 0.18 * Math.sin(Math.PI * x))
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

export function RecordPage() {
  const { user } = useAuth()
  const userId = user?.id
  const rec = useRecorder(MAX_SECONDS)
  const [bars, setBars] = useState<number[]>(() => Array(BARS).fill(0))
  const [toast, showToast, hideToast] = useToast(6000)
  const [justSaved, setJustSaved] = useState(false)
  useEffect(() => {
    if (!justSaved) return
    const id = setTimeout(() => setJustSaved(false), 4000)
    return () => clearTimeout(id)
  }, [justSaved])

  const levelRef = useRef(0)
  levelRef.current = rec.level

  const { discard } = rec
  const lastHandledRef = useRef<Recording | null>(null)
  useEffect(() => {
    const r = rec.recording
    if (!userId || !r || r === lastHandledRef.current) return
    lastHandledRef.current = r
    void addToOutbox({
      clientSubmissionId: crypto.randomUUID(),
      userId,
      blob: r.blob,
      mimeType: r.mimeType,
      durationSec: r.durationSec,
      createdAt: new Date().toISOString(),
    })
    discard()
    setJustSaved(true)
  }, [userId, rec.recording, discard])

  useEffect(() => onOutboxNotice((n) => {
    if (n.kind === 'changed') return
    if (n.kind === 'dropped') showToast(`A recording was not sent: ${n.message}`, 'error')
    else if (n.kind === 'duplicate') showToast('A recording matched one you already sent, so it was not sent again.', 'error')
    else if (n.result.issues.length > 0 && n.result.issues.every((it) => !it.venue)) {
      showToast('Sent, but the venue was not identified. Say the venue name next time.', 'error')
    }
  }), [showToast])

  useEffect(() => {
    if (rec.status !== 'recording') return
    setBars(Array(BARS).fill(0))
    const id = setInterval(() => setBars((b) => [...b.slice(1), levelRef.current]), 80)
    return () => clearInterval(id)
  }, [rec.status])

  const recording = rec.status === 'recording'
  const remaining = MAX_SECONDS - rec.elapsed

  const warn = recording && rec.elapsed >= WARN_AT

  return (
    <div className="mx-auto max-w-[52rem]">
      <PageHeader align="center" title="Record an issue"
        description={<>Say the venue, the guest or function, and then each problem. The date is taken as <b className="font-bold text-ink">today</b> unless you say another day (e.g. &ldquo;kal&rdquo;). Hindi, English or both are fine.</>} />



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
              onClick={recording ? rec.stop : () => { hideToast(); setJustSaved(false); void rec.start() }}
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
            {rec.status === 'idle' && (justSaved
              ? <span className="inline-flex items-center gap-1.5 font-semibold text-ok"><Icon name="checkCircle" className="size-5" />Saved. Sending it for you.</span>
              : 'Tap to start recording')}
            {recording && (warn ? 'Less than 15 seconds left' : 'Recording… tap to stop')}
          </p>

          {rec.error && <Alert tone="danger" className="mt-6 w-full max-w-sm">{RECORDER_ERROR_TEXT[rec.error]}</Alert>}
        </section>

      <Toast toast={toast} onClose={hideToast} />
    </div>
  )
}
