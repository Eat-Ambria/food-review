// =============================================================================
// WHAT THIS FILE IS
//   A compact play/pause + seek bar for a recorded audio Blob.
// WHY IT EXISTS
//   The browser's built-in <audio controls> looks different on every phone,
//   and on Chrome it shows "0:00 / Infinity" for webm recordings (they carry no
//   length). We already know the real length from the recorder, so this
//   player uses that value.
// USED BY
//   pages/Recording/RecordPage.tsx
// =============================================================================
import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { fmtTime } from '../utils/format'

export function AudioPlayer({ blob, durationSec }: { blob: Blob; durationSec: number }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)

  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    setPos(0)
    setPlaying(false)
    return () => URL.revokeObjectURL(u)
  }, [blob])

  const toggle = async () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) {
      try { await a.play() } catch { /* autoplay rules: user tapped, so this should succeed */ }
    } else a.pause()
  }

  const seek = (v: number) => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = v
    setPos(v)
  }

  const pct = durationSec > 0 ? (Math.min(pos, durationSec) / durationSec) * 100 : 0

  return (
    <div className="flex items-center gap-3 rounded-lg bg-subtle p-2 pr-3 ring-1 ring-inset ring-line">
      {url && (
        <audio ref={audioRef} src={url} preload="metadata"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setPos(0) }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} />
      )}
      <button type="button" onClick={() => void toggle()} aria-label={playing ? 'Pause' : 'Play recording'}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-colors hover:bg-navy-700">
        <Icon name={playing ? 'pause' : 'play'} className="size-4" strokeWidth={playing ? 2.4 : 0} fill={playing ? 'none' : 'currentColor'} />
      </button>
      {/* Track: a thin bar with a marigold fill; the real range input sits on top (invisible) for touch, keyboard and screen readers. */}
      <div className="relative flex h-6 flex-1 items-center">
        <div className="h-1 w-full overflow-hidden rounded-full bg-line-strong/70">
          <div className="h-full rounded-full bg-marigold" style={{ width: `${pct}%` }} />
        </div>
        <span aria-hidden="true" className="pointer-events-none absolute size-3 -translate-x-1/2 rounded-full bg-surface shadow ring-2 ring-marigold" style={{ left: `${pct}%` }} />
        <input type="range" min={0} max={durationSec} step={0.1} value={Math.min(pos, durationSec)}
          onChange={(e) => seek(Number(e.target.value))} aria-label="Seek"
          className="absolute inset-0 w-full cursor-pointer opacity-0" />
      </div>
      <span className="shrink-0 text-xs font-medium tabular-nums text-muted">
        {fmtTime(pos)} <span className="text-faint">/ {fmtTime(durationSec)}</span>
      </span>
    </div>
  )
}
