// Tests for splitting audio into parts.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { rms, toWavChunks, SAMPLE_RATE } from './audioChunks'

function fakeAudio(samples: Float32Array) {
  class FakeCtx {
    decodeAudioData() { return Promise.resolve({ duration: samples.length / SAMPLE_RATE }) }
    close() { return Promise.resolve() }
  }
  class FakeOffline {
    createBufferSource() { return { buffer: null, connect() {}, start() {} } }
    get destination() { return {} }
    startRendering() { return Promise.resolve({ getChannelData: () => samples }) }
  }
  vi.stubGlobal('window', { AudioContext: FakeCtx })
  vi.stubGlobal('OfflineAudioContext', FakeOffline)
}

const tone = (sec: number, amp = 0.5) => {
  const a = new Float32Array(Math.round(sec * SAMPLE_RATE))
  for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin(i / 5)
  return a
}

afterEach(() => { vi.unstubAllGlobals() })

describe('rms', () => {
  it('is 0 for silence and for an empty array', () => {
    expect(rms(new Float32Array(100))).toBe(0)
    expect(rms(new Float32Array(0))).toBe(0)
  })
  it('equals the amplitude for a constant signal', () => {
    expect(rms(new Float32Array(10).fill(0.5))).toBeCloseTo(0.5)
  })
})

describe('toWavChunks', () => {
  it('keeps a short recording as one chunk with a valid WAV header', async () => {
    fakeAudio(tone(10))
    const { chunks, totalSec, silent } = await toWavChunks(new Blob(['x']))
    expect(chunks).toHaveLength(1)
    expect(totalSec).toBeCloseTo(10)
    expect(silent).toBe(false)
    const head = new Uint8Array(await chunks[0].blob.arrayBuffer())
    expect(String.fromCharCode(...head.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...head.slice(8, 12))).toBe('WAVE')
    expect(chunks[0].blob.size).toBe(44 + 10 * SAMPLE_RATE * 2)
    expect(chunks[0].blob.type).toBe('audio/wav')
  })

  it('flags a silent recording', async () => {
    fakeAudio(new Float32Array(5 * SAMPLE_RATE))
    expect((await toWavChunks(new Blob(['x']))).silent).toBe(true)
  })

  it('splits long audio into chunks of at most 29 s, cutting at a pause', async () => {

    const s = tone(60)
    s.fill(0, 26 * SAMPLE_RATE, 26.5 * SAMPLE_RATE)
    fakeAudio(s)
    const { chunks, totalSec } = await toWavChunks(new Blob(['x']))
    expect(totalSec).toBeCloseTo(60)
    for (const c of chunks) expect(c.durationSec).toBeLessThanOrEqual(29)

    expect(chunks[0].durationSec).toBeGreaterThanOrEqual(26)
    expect(chunks[0].durationSec).toBeLessThanOrEqual(26.5)

    let pos = 0
    for (const c of chunks) { expect(c.startSec).toBeCloseTo(pos); pos += c.durationSec }
    expect(pos).toBeCloseTo(60)
  })
})
