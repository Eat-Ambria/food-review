// A small play / pause button for a recording that is saved on this phone.
import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { playingNow } from '../lib/singleAudio'

export function PlayRecording({ blob, durationSec }: { blob: Blob; durationSec: number }) {
  const total = Math.max(1, Math.round(durationSec))
  const blobRef = useRef(blob)
  blobRef.current = blob
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [left, setLeft] = useState(total)

  useEffect(() => () => {
    audioRef.current?.pause()
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])

  const toggle = () => {
    let a = audioRef.current
    if (!a) {
      urlRef.current = URL.createObjectURL(blobRef.current)
      a = new Audio(urlRef.current)
      a.ontimeupdate = () => setLeft(Math.max(0, Math.round(total - a!.currentTime)))
      a.onended = () => { setPlaying(false); setLeft(total) }
      a.onpause = () => setPlaying(false)
      a.onplay = () => { playingNow(a!); setPlaying(true) }
      audioRef.current = a
    }
    if (a.paused) void a.play().catch(() => setPlaying(false))
    else a.pause()
  }

  return (
    <button type="button" onClick={toggle} aria-label={playing ? 'Pause recording' : 'Play recording'}
      className="inline-flex h-9 items-center gap-2 rounded-full bg-ink/[0.06] pl-1 pr-3 text-sm font-medium text-ink transition-colors hover:bg-ink/10">
      <span className="flex size-7 items-center justify-center rounded-full bg-ink text-white">
        <Icon name={playing ? 'pause' : 'play'} className="size-3.5" fill="currentColor" strokeWidth={0} />
      </span>
      <span className="tabular-nums">{left} s</span>
    </button>
  )
}
