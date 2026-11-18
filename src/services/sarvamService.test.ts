import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const invoke = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }))
const toWavChunks = vi.fn()
vi.mock('../utils/audioChunks', () => ({ toWavChunks: (...a: unknown[]) => toWavChunks(...a) }))

import { transcribe, TranscriptionError } from './sarvamService'

const chunks = (n: number) => ({
  chunks: Array.from({ length: n }, (_, i) => ({ blob: new Blob([String(i)]), startSec: i * 29, durationSec: 29 })),
  totalSec: n * 29, silent: false,
})
const ok = (text: string) => ({ data: { transcript: text, language_code: 'hi-IN', request_id: 'r' }, error: null })
const bodyOf = (call: unknown[]) => (call[1] as { body: FormData }).body

beforeEach(() => {
  invoke.mockReset()
  toWavChunks.mockReset()
  vi.stubGlobal('navigator', { onLine: true })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('transcribe', () => {
  it('sends every chunk and joins the text in order', async () => {
    toWavChunks.mockResolvedValue(chunks(3))
    invoke.mockImplementation(async (_n: string, { body }: { body: FormData }) => ok(`part${body.get('chunk_index')}  `))
    const progress: number[] = []
    const res = await transcribe(new Blob(['a']), 'cid', (d) => progress.push(d))
    expect(res.text).toBe('part0 part1 part2')
    expect(progress[0]).toBe(0)
    expect(progress[progress.length - 1]).toBe(3)
    expect(res.meta).toMatchObject({ provider: 'sarvam', audio_seconds: 87 })
    expect(invoke.mock.calls.every((c) => bodyOf(c).get('client_submission_id') === 'cid')).toBe(true)
  })

  it('rejects silent recordings without calling the server', async () => {
    toWavChunks.mockResolvedValue({ ...chunks(1), silent: true })
    await expect(transcribe(new Blob(['a']), 'cid', () => {})).rejects.toMatchObject({ retryable: false })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('reports undecodable audio as a TranscriptionError', async () => {
    toWavChunks.mockRejectedValue(new Error('decode'))
    await expect(transcribe(new Blob(['a']), 'cid', () => {})).rejects.toBeInstanceOf(TranscriptionError)
  })

  it('only redoes missing chunks when given a previous partial state', async () => {
    toWavChunks.mockResolvedValue(chunks(3))
    invoke.mockImplementation(async (_n: string, { body }: { body: FormData }) => ok(`new${body.get('chunk_index')}`))
    const previous = { total: 3, results: [{ text: 'old0', language: null, requestId: null }, null, { text: 'old2', language: null, requestId: null }] }
    const res = await transcribe(new Blob(['a']), 'cid', () => {}, previous)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(bodyOf(invoke.mock.calls[0]).get('chunk_index')).toBe('1')
    expect(res.text).toBe('old0 new1 old2')
  })

  it('ignores a previous state with a different chunk count', async () => {
    toWavChunks.mockResolvedValue(chunks(2))
    invoke.mockResolvedValue(ok('x'))
    await transcribe(new Blob(['a']), 'cid', () => {}, { total: 5, results: [null, null, null, null, null] })
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('throws when nothing was recognised', async () => {
    toWavChunks.mockResolvedValue(chunks(1))
    invoke.mockResolvedValue(ok('   '))
    await expect(transcribe(new Blob(['a']), 'cid', () => {})).rejects.toThrow(/No words/)
  })

  it('retries a temporary failure twice, then gives up with the partial state', async () => {
    vi.useFakeTimers()
    try {
      toWavChunks.mockResolvedValue(chunks(1))
      invoke.mockResolvedValue({ data: null, error: new Error('net') })
      const p = transcribe(new Blob(['a']), 'cid', () => {})
      const assertion = expect(p).rejects.toMatchObject({ retryable: true, partial: { total: 1 } })
      await vi.runAllTimersAsync()
      await assertion
      expect(invoke).toHaveBeenCalledTimes(3) // 1 try + 2 auto-retries
    } finally {
      vi.useRealTimers()
    }
  })
})
