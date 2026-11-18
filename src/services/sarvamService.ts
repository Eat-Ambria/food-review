// =============================================================================
// WHAT THIS FILE IS
//   Browser-side transcription: cut the recording into WAV chunks, send each
//   to the transcribe-audio Edge Function, and join the text.
// WHY IT EXISTS
//   • Retries: a failed chunk is retried automatically (twice, with a short
//     wait) when the error is temporary. A finished chunk is never sent again,
//     so a retry after a network drop only pays for what's missing.
//   • Progress: reports "chunk 2 of 4" for the screen.
//   • Every chunk carries the recording's client_submission_id. The server uses
//     it to return saved text for a chunk it has already done (never paid
//     twice) and to apply the per-user limits. "busy" (the same chunk is in
//     progress elsewhere) → wait and ask again. "limited" → give up for now and
//     report WHEN to try again (retryAt); the screen schedules that retry.
//   • Provider swap: the screen only knows transcribe(). Switching provider or
//     model later only touches this file and the Edge Function.
// USED BY
//   pages/Recording/RecordPage.tsx
// DEPENDS ON
//   utils/audioChunks.ts, Edge Function transcribe-audio
// =============================================================================
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { toWavChunks } from '../utils/audioChunks'

export interface ChunkResult { text: string; language: string | null; requestId: string | null }

export interface TranscriptionState {
  total: number
  results: (ChunkResult | null)[]   // null = not done yet
}

export class TranscriptionError extends Error {
  retryable: boolean
  partial: TranscriptionState | null
  /** Set when a usage limit was hit: the earliest time to try again (ISO). */
  retryAt: string | null
  constructor(message: string, retryable: boolean, partial: TranscriptionState | null, retryAt: string | null = null) {
    super(message)
    this.retryable = retryable
    this.partial = partial
    this.retryAt = retryAt
  }
}

const AUTO_RETRIES = 2
const BUSY_RETRIES = 8      // "busy" = another tab is doing this chunk; its answer will be saved shortly
const PARALLEL = 5          // a 2-min recording is at most 5 parts; Sarvam pay-as-you-go allows 60 requests/min
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function sendChunk(blob: Blob, index: number, clientId: string): Promise<ChunkResult> {
  const form = new FormData()
  form.append('file', blob, `chunk-${index}.wav`)
  form.append('chunk_index', String(index))
  form.append('client_submission_id', clientId)

  let busyCount = 0
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.functions.invoke('transcribe-audio', { body: form })
    if (!error) {
      return { text: String(data?.transcript ?? ''), language: data?.language_code ?? null, requestId: data?.request_id ?? null }
    }
    let message = navigator.onLine ? 'Could not reach the transcription service.' : 'You are offline.'
    let retryable = true
    let retryAt: string | null = null
    let busy = false
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json()
        message = body?.error ?? message
        retryable = body?.retryable !== false
        retryAt = body?.retry_after ?? null
        busy = body?.busy === true
      } catch { /* keep defaults */ }
    }
    if (busy && busyCount < BUSY_RETRIES) {     // doesn't use up the normal retries
      busyCount++
      attempt--
      await wait(4000)
      continue
    }
    if (retryAt) throw new TranscriptionError(message, true, null, retryAt)
    if (!retryable || attempt >= AUTO_RETRIES || !navigator.onLine) throw new TranscriptionError(message, retryable, null)
    await wait(1500 * (attempt + 1))
  }
}

/**
 * Transcribes a recording. Pass `previous` (from a failed attempt) to only
 * redo the chunks that are still missing.
 */
export async function transcribe(
  recording: Blob,
  clientId: string,
  onProgress: (done: number, total: number) => void,
  previous?: TranscriptionState | null,
): Promise<{ text: string; state: TranscriptionState; meta: Record<string, unknown> }> {
  let prepared
  try {
    prepared = await toWavChunks(recording)
  } catch {
    throw new TranscriptionError('This recording could not be processed on this device. Please record again.', false, null)
  }
  if (prepared.silent) {
    throw new TranscriptionError('No speech was detected. Check the microphone and record again.', false, null)
  }

  const { chunks } = prepared
  // Re-use earlier results only if the chunking is identical (same recording).
  const state: TranscriptionState = previous && previous.total === chunks.length
    ? { total: chunks.length, results: [...previous.results] }
    : { total: chunks.length, results: Array(chunks.length).fill(null) }

  const countDone = () => state.results.filter(Boolean).length
  onProgress(countDone(), state.total)

  const queue = chunks.map((_, i) => i).filter((i) => !state.results[i])
  let failure: TranscriptionError | null = null

  const worker = async () => {
    while (queue.length && !failure) {
      const i = queue.shift()!
      try {
        state.results[i] = await sendChunk(chunks[i].blob, i, clientId)
        onProgress(countDone(), state.total)
      } catch (e) {
        failure = e as TranscriptionError
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length || 1) }, worker))

  if (failure) {
    const f = failure as TranscriptionError
    throw new TranscriptionError(f.message, f.retryable, state, f.retryAt)
  }

  const text = state.results.map((r) => r!.text).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  if (!text) throw new TranscriptionError('No words could be recognised. Please speak clearly and record again.', false, null)

  return {
    text,
    state,
    meta: {
      provider: 'sarvam',
      chunks: chunks.map((c, i) => ({
        start_sec: Math.round(c.startSec * 10) / 10,
        duration_sec: Math.round(c.durationSec * 10) / 10,
        language: state.results[i]?.language ?? null,
        request_id: state.results[i]?.requestId ?? null,
      })),
      audio_seconds: Math.round(prepared.totalSec * 10) / 10,
    },
  }
}
