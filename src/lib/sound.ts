// Plays the in-app notification sound, and stores the sound On/Off choice.
const KEY = 'issue-desk-sound'
let ctx: AudioContext | null = null
let out: AudioNode | null = null

export function soundEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}
export function setSoundEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { }
}

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx = new Ctx()
    }
    if (ctx.state !== 'running') void ctx.resume().catch(() => {})
    if (!out) {

      const master = ctx.createGain()
      master.gain.value = 2.4
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = -6
      limiter.knee.value = 4
      limiter.ratio.value = 12
      limiter.attack.value = 0.002
      limiter.release.value = 0.15
      master.connect(limiter).connect(ctx.destination)
      out = master
    }
    return ctx
  } catch { return null }
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    const ac = audio()
    if (!ac || ac.state === 'running') return
    try {
      const src = ac.createBufferSource()
      src.buffer = ac.createBuffer(1, 1, 22050)
      src.connect(ac.destination)
      src.start(0)
    } catch { }
  }
  for (const type of ['touchend', 'click', 'keydown']) window.addEventListener(type, unlock, { passive: true })
}

function bell(ac: AudioContext, freq: number, start: number, dur: number, peak: number) {
  for (const [mult, level] of [[1, 1], [2.76, 0.35], [5.4, 0.12]] as const) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq * mult, start)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(peak * level, start + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur / mult ** 0.3)
    osc.connect(gain).connect(out ?? ac.destination)
    osc.start(start)
    osc.stop(start + dur + 0.05)
  }
}

function sweep(ac: AudioContext, start: number, dur: number, peak: number) {
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
  osc.connect(gain).connect(out ?? ac.destination)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

export function playNotificationSound(kind: 'normal' | 'serious' = 'normal'): void {
  if (!soundEnabled()) return
  const ac = audio()
  if (!ac) return

  if (ac.state !== 'running') {
    ac.resume().then(() => { if (ac.state === 'running') schedule(ac, kind) }).catch(() => {})
  } else schedule(ac, kind)
  try { navigator.vibrate?.(kind === 'serious' ? [400, 150, 400, 150, 400, 150, 400] : [200, 80, 200]) } catch { }
}

function schedule(ac: AudioContext, kind: 'normal' | 'serious') {
  const t = ac.currentTime + 0.02
  if (kind === 'serious') {
    for (let r = 0; r < 3; r++) sweep(ac, t + r * 0.62, 0.55, 0.5)
    bell(ac, 1975, t + 1.95, 0.5, 1)
    bell(ac, 1975, t + 2.25, 0.6, 1)
  } else {
    bell(ac, 1318.5, t, 0.9, 1)
    bell(ac, 1046.5, t + 0.28, 0.9, 1)
    bell(ac, 1568, t + 0.56, 1.2, 1)
  }
}
