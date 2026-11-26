// One good-feedback line on the Issues page; opens to show what was said and play the recording.
import { useRef, useState, type ReactNode } from 'react'
import { audioUrl, type Compliment } from '../services/issueService'
import { playingNow } from '../lib/singleAudio'
import { Icon } from './Icon'
import { Spinner } from './ui/Spinner'

export function PraiseRow({ p, meta }: { p: Compliment; meta: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [src, setSrc] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const retried = useRef(false)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && p.audio_path && !src) {
      try { setSrc(await audioUrl(p.audio_path)) } catch (e) { setErr((e as Error).message) }
    }
  }

  return (
    <li>
      <button type="button" onClick={() => void toggle()} aria-expanded={open}
        className="flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-subtle/70">
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-relaxed">
            {p.item && <span className="font-semibold">{p.item}: </span>}
            <span className="text-ink/85">{p.summary}</span>
          </span>
          <span className="mt-0.5 block text-xs text-muted">{meta}</span>
        </span>
        <Icon name="chevron" className={`mt-1 size-4 shrink-0 text-ink/60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="fade-in space-y-3 px-4 pb-4">
          {(p.transcript || p.original_text) && (
            <div className="rounded-lg border border-line bg-surface px-3.5 py-3">
              <p className="text-xs font-semibold text-muted">What was said</p>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{p.transcript ?? p.original_text}</p>
            </div>
          )}
          {p.audio_path ? (
            src ? (
              <audio controls preload="none" src={src} className="h-10 w-full" onPlay={(e) => playingNow(e.currentTarget)}
                onError={() => {
                  if (!p.audio_path || retried.current) { setSrc(null); setErr('This recording could not be played.'); return }
                  retried.current = true
                  void audioUrl(p.audio_path).then(setSrc).catch(() => setErr('This recording could not be played.'))
                }} />
            ) : err ? <p className="text-xs text-danger">{err}</p>
              : <p className="flex items-center gap-2 text-xs text-muted"><Spinner className="size-3" />Loading recording…</p>
          ) : (
            <p className="text-xs text-muted">Recording no longer available.</p>
          )}
        </div>
      )}
    </li>
  )
}
