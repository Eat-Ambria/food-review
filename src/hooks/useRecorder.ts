// =============================================================================
// WHAT THIS FILE IS
//   A React hook that wraps the browser's MediaRecorder: start/stop, a live
//   timer, a live loudness level for the waveform, an automatic stop at the
//   time limit, and clear error types.
// WHY IT EXISTS
//   Recording differs between browsers:
//     • Chrome / Android / Firefox record audio/webm (Opus)
//     • Safari / iPhone records audio/mp4 (AAC)
//   We pick the first format the browser supports and keep its MIME type with
//   the audio. Phase 4 converts every format into WAV chunks for Sarvam, so the
//   recording format here doesn't matter to the server.
//   The mic only works on HTTPS or localhost. Opening the app over a plain
//   http:// LAN address shows the "insecure" error instead of failing silently.
// USED BY
//   pages/Recording/RecordPage.tsx
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'stopped'
export type RecorderError = 'denied' | 'no-mic' | 'unsupported' | 'insecure' | 'busy' | 'failed'

export const RECORDER_ERROR_TEXT: Record<RecorderError, string> = {
  denied: 'Microphone permission was blocked. Allow the microphone for this site in your browser settings, then try again.',
  'no-mic': 'No microphone was found on this device.',
  unsupported: 'This browser cannot record audio. Please use the latest Chrome, Safari or Edge.',
  insecure: 'Recording needs a secure (https) connection. Open the app from its https:// address.',
  busy: 'The microphone is being used by another app (e.g. a call). Close it and try again.',
  failed: 'Recording failed to start. Please try again.',
}

// In order of preference. Safari only supports mp4.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t))
}

export interface Recording { blob: Blob; mimeType: string; durationSec: number }

export function useRecorder(maxSeconds: number) {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [error, setError] = useState<RecorderError | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)                 // 0..1, current loudness
  const [recording, setRecording] = useState<Recording | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const rafRef = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)

  /** Stops the mic, the meter and the timer loop. */
  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    setLevel(0)
  }, [])

  const stop = useCallback(() => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()   // onstop builds the Blob
  }, [])

  const start = useCallback(async () => {
    setError(null)
    if (!window.isSecureContext) { setError('insecure'); return }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('unsupported'); return }

    setStatus('requesting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (e) {
      const name = (e as DOMException)?.name
      setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'no-mic'
        : name === 'NotReadableError' || name === 'AbortError' ? 'busy'
        : 'failed')
      setStatus('idle')
      return
    }
    streamRef.current = stream

    const mimeType = pickMimeType()
    let rec: MediaRecorder
    try {
      rec = mimeType ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 }) : new MediaRecorder(stream)
    } catch {
      cleanup(); setError('unsupported'); setStatus('idle'); return
    }
    recorderRef.current = rec
    chunksRef.current = []

    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data) }
    rec.onstop = () => {
      const durationSec = Math.min((performance.now() - startedAtRef.current) / 1000, maxSeconds)
      const type = rec.mimeType || mimeType || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type })
      cleanup()
      if (blob.size === 0) { setError('failed'); setStatus('idle'); return }
      setRecording({ blob, mimeType: type, durationSec })
      setElapsed(durationSec)
      setStatus('stopped')
    }
    // If the phone takes the mic away (incoming call, app switch), keep what we have.
    stream.getAudioTracks()[0]?.addEventListener('ended', () => stop())

    // Live loudness meter for the waveform.
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      audioCtxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)
      const tick = () => {
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (const v of buf) { const x = (v - 128) / 128; sum += x * x }
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4))
        const secs = (performance.now() - startedAtRef.current) / 1000
        setElapsed(secs)
        if (secs >= maxSeconds) { stop(); return }   // hard limit
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch {
      // The meter is cosmetic; recording still works without it. Keep the timer + limit.
      const tick = () => {
        const secs = (performance.now() - startedAtRef.current) / 1000
        setElapsed(secs)
        if (secs >= maxSeconds) { stop(); return }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    startedAtRef.current = performance.now()
    setElapsed(0)
    setRecording(null)
    rec.start(1000)      // gather data every second, so a crash mid-way loses at most 1s
    setStatus('recording')
  }, [cleanup, maxSeconds, stop])

  /** Throw away the current recording and go back to idle. */
  const discard = useCallback(() => {
    setRecording(null)
    setElapsed(0)
    setError(null)
    setStatus('idle')
  }, [])

  /** Load a recording saved earlier (e.g. recovered after a page refresh). */
  const restore = useCallback((r: Recording) => {
    setRecording(r)
    setElapsed(r.durationSec)
    setStatus('stopped')
  }, [])

  // Leaving the page mid-recording: release the mic.
  useEffect(() => () => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop() }
    cleanup()
  }, [cleanup])

  return { status, error, elapsed, level, recording, start, stop, discard, restore }
}
