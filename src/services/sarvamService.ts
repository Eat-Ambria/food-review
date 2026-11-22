// Splits a recording into parts and gets the text from Sarvam.
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { toWavChunks } from '../utils/audioChunks'

export interface ChunkResult { text: string; language: string | null; requestId: string | null }

export interface TranscriptionState {
  total: number
  results: (ChunkResult | null)[]
}

export class TranscriptionError extends Error {
  retryable: boolean
  partial: TranscriptionState | null

  retryAt: string | null
  constructor(message: string, retryable: boolean, partial: TranscriptionState | null, retryAt: string | null = null) {
    super(message)
    this.retryable = retryable
    this.partial = partial
    this.retryAt = retryAt
  }
}

const AUTO_RETRIES = 4
const BUSY_RETRIES = 8
const PARALLEL = 4
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jitter = (ms: number) => Math.round(ms * (0.6 + Math.random() * 0.8))

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
      } catch { }
    }
    if (busy && busyCount < BUSY_RETRIES) {
      busyCount++
      attempt--
      await wait(jitter(4000))
      continue
    }
    if (retryAt) throw new TranscriptionError(message, true, null, retryAt)
    if (!retryable || attempt >= AUTO_RETRIES || !navigator.onLine) throw new TranscriptionError(message, retryable, null)
    await wait(jitter(Math.min(12_000, 1500 * 2 ** attempt)))
  }
}

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
