// Converts a recording into WAV parts of at most 29 seconds for transcription.
export const SAMPLE_RATE = 16000
const MAX_CHUNK_SEC = 29
const SEARCH_WINDOW_SEC = 5
const FRAME_SEC = 0.1

export interface WavChunk { blob: Blob; startSec: number; durationSec: number }

async function decodeTo16kMono(blob: Blob): Promise<Float32Array> {
  const arrayBuf = await blob.arrayBuffer()
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctx()
  let decoded: AudioBuffer
  try {
    decoded = await new Promise<AudioBuffer>((resolve, reject) => {

      const p = ctx.decodeAudioData(arrayBuf, resolve, reject)
      if (p && typeof p.then === 'function') p.then(resolve, reject)
    })
  } finally {
    void ctx.close().catch(() => {})
  }

  const length = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE))
  const offline = new OfflineAudioContext(1, length, SAMPLE_RATE)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start(0)
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

function quietestPoint(samples: Float32Array, from: number, to: number): number {
  const frame = Math.floor(FRAME_SEC * SAMPLE_RATE)
  let best = to
  let bestEnergy = Infinity
  for (let start = from; start + frame <= to; start += frame) {
    let e = 0
    for (let i = start; i < start + frame; i++) e += samples[i] * samples[i]
    if (e < bestEnergy) { bestEnergy = e; best = start + Math.floor(frame / 2) }
  }
  return best
}

function encodeWav(samples: Float32Array): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, 1, true); v.setUint32(24, SAMPLE_RATE, true)
  v.setUint32(28, SAMPLE_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

export function rms(samples: Float32Array): number {
  let s = 0
  for (const x of samples) s += x * x
  return Math.sqrt(s / Math.max(1, samples.length))
}

const MAX_TOTAL_SEC = 125

export async function toWavChunks(blob: Blob): Promise<{ chunks: WavChunk[]; totalSec: number; silent: boolean }> {
  const decoded = await decodeTo16kMono(blob)
  const samples = decoded.length > MAX_TOTAL_SEC * SAMPLE_RATE ? decoded.subarray(0, MAX_TOTAL_SEC * SAMPLE_RATE) : decoded
  const max = MAX_CHUNK_SEC * SAMPLE_RATE
  const chunks: WavChunk[] = []
  let pos = 0
  while (pos < samples.length) {
    let end = Math.min(pos + max, samples.length)
    if (end < samples.length) {
      end = quietestPoint(samples, Math.max(pos + 1, end - SEARCH_WINDOW_SEC * SAMPLE_RATE), end)
    }

    if (end - pos >= 0.3 * SAMPLE_RATE || chunks.length === 0) {
      const piece = samples.subarray(pos, end)
      chunks.push({ blob: encodeWav(piece), startSec: pos / SAMPLE_RATE, durationSec: piece.length / SAMPLE_RATE })
    }
    pos = end
  }
  return { chunks, totalSec: samples.length / SAMPLE_RATE, silent: rms(samples) < 0.003 }
}
