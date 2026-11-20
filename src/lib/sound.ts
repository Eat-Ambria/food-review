// Plays the in-app notification sound, and stores the sound On/Off choice.
type Kind = 'normal' | 'serious'
const KEY = 'issue-desk-sound'
const RATE = 44100
const LENGTH: Record<Kind, number> = { normal: 2.2, serious: 3 }

let ctx: AudioContext | null = null
const urls: Partial<Record<Kind, string>> = {}
const players: Partial<Record<Kind, HTMLAudioElement>> = {}
const unlocked = new Set<Kind>()
let silentUrl = ''

export function soundEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}
export function setSoundEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { }
}

function bell(ac: BaseAudioContext, dest: AudioNode, freq: number, start: number, dur: number, peak: number) {
  for (const [mult, level] of [[1, 1], [2.76, 0.35], [5.4, 0.12]] as const) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq * mult, start)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(peak * level, start + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur / mult ** 0.3)
    osc.connect(gain).connect(dest)
    osc.start(start)
    osc.stop(start + dur + 0.05)
  }
}

function sweep(ac: BaseAudioContext, dest: AudioNode, start: number, dur: number, peak: number) {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(900, start)
  osc.frequency.linearRampToValueAtTime(1800, start + dur * 0.5)
  osc.frequency.linearRampToValueAtTime(900, start + dur)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.03)
  gain.gain.setValueAtTime(peak, start + dur - 0.06)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(gain).connect(dest)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

function loudOutput(ac: BaseAudioContext): AudioNode {
  const master = ac.createGain()
  master.gain.value = 2.4
  const limiter = ac.createDynamicsCompressor()
  limiter.threshold.value = -6
  limiter.knee.value = 4
  limiter.ratio.value = 12
  limiter.attack.value = 0.002
  limiter.release.value = 0.15
  master.connect(limiter).connect(ac.destination)
  return master
}

function compose(ac: BaseAudioContext, dest: AudioNode, kind: Kind, t: number) {
  if (kind === 'serious') {
    for (let r = 0; r < 3; r++) sweep(ac, dest, t + r * 0.62, 0.55, 0.5)
    bell(ac, dest, 1975, t + 1.95, 0.5, 1)
    bell(ac, dest, 1975, t + 2.25, 0.6, 1)
  } else {
    bell(ac, dest, 1318.5, t, 0.9, 1)
    bell(ac, dest, 1046.5, t + 0.28, 0.9, 1)
    bell(ac, dest, 1568, t + 0.56, 1.2, 1)
  }
}

function wav(samples: Float32Array): string {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true)
  return URL.createObjectURL(new Blob([view], { type: 'audio/wav' }))
}

async function render(kind: Kind): Promise<void> {
  try {
    const Offline = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
    const off = new Offline(1, Math.round(RATE * LENGTH[kind]), RATE)
    compose(off, loudOutput(off), kind, 0.02)
    urls[kind] = wav((await off.startRendering()).getChannelData(0))
  } catch { }
}

function player(kind: Kind): HTMLAudioElement | null {
  if (!urls[kind]) return null
  if (!players[kind]) {
    const el = new Audio()
    el.preload = 'auto'
    players[kind] = el
  }
  return players[kind]!
}

function unlockPlayer(kind: Kind) {
  const el = player(kind)
  if (!el || unlocked.has(kind)) return
  el.src = silentUrl
  el.play().then(() => { el.pause(); el.src = urls[kind]!; el.load(); unlocked.add(kind) }).catch(() => {})
}

function webAudio(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx = new Ctx()
    }
    return ctx
  } catch { return null }
}

if (typeof window !== 'undefined') {
  silentUrl = wav(new Float32Array(RATE / 10))
  void render('normal')
  void render('serious')
  const unlock = () => {
    unlockPlayer('normal')
    unlockPlayer('serious')
    const ac = webAudio()
    if (ac && ac.state !== 'running') void ac.resume().catch(() => {})
  }
  for (const type of ['touchend', 'click', 'keydown']) window.addEventListener(type, unlock, { passive: true })
}

function playWebAudio(kind: Kind) {
  const ac = webAudio()
  if (!ac || ac.state !== 'running') return
  compose(ac, loudOutput(ac), kind, ac.currentTime + 0.02)
}

export function playNotificationSound(kind: Kind = 'normal'): void {
  if (!soundEnabled()) return
  try { navigator.vibrate?.(kind === 'serious' ? [400, 150, 400, 150, 400, 150, 400] : [200, 80, 200]) } catch { }
  const el = player(kind)
  if (el && el.src === urls[kind]) {
    el.currentTime = 0
    el.play().catch(() => playWebAudio(kind))
  } else playWebAudio(kind)
}
