// =============================================================================
// WHAT THIS FILE IS
//   The app's own notification sound: a loud service-bell "ding-dong-ding" for
//   a new issue, and a siren + bells for a SERIOUS one. Plus the On/Off choice.
//   This is an EXTRA on top of the phone's own notification sound (which always
//   plays, public/sw.js): iPhone only lets a web app make sound shortly after a
//   tap, so this cannot be the only alert. Web apps cannot change the phone's sound.
// WHY IT EXISTS
//   When the app is open, the phone often does not sound for a push, so the
//   app plays its own sound. The sounds are generated with the Web Audio API
//   (no audio files to download).
//   Browsers only allow sound after the person has tapped something on the
//   page. iPhone is strict about it: only a real tap (touchend / click) counts,
//   a short silent sound must be played at that moment, and audio is switched
//   off again ("interrupted") whenever the app goes to the background. So
//   EVERY tap re-unlocks audio if it is not running, not just the first one.
//   The On/Off choice is per device (localStorage); it defaults to On.
// USED BY
//   components/NotificationBell.tsx (plays), components/AccountMenu.tsx (switch)
// =============================================================================

const KEY = 'issue-desk-sound'
let ctx: AudioContext | null = null
let out: AudioNode | null = null        // master chain: gain → limiter → speakers

export function soundEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}
export function setSoundEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* storage blocked: stays on */ }
}

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx = new Ctx()
    }
    if (ctx.state !== 'running') void ctx.resume().catch(() => {})   // "suspended" or iPhone's "interrupted"
    if (!out) {
      // Loud but clean on small phone speakers: boost, then a limiter so it never distorts.
      const master = ctx.createGain()
      master.gain.value = 2.4       // loud; the limiter below keeps it clean
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

// Unlock audio on every tap while it is not running (browser autoplay rules).
// A one-sample silent buffer is played in the tap itself: iPhone needs that.
if (typeof window !== 'undefined') {
  const unlock = () => {
    const ac = audio()
    if (!ac || ac.state === 'running') return
    try {
      const src = ac.createBufferSource()
      src.buffer = ac.createBuffer(1, 1, 22050)
      src.connect(ac.destination)
      src.start(0)
    } catch { /* ignore */ }
  }
  for (const type of ['touchend', 'click', 'keydown']) window.addEventListener(type, unlock, { passive: true })
}

/**
 * A bell-like note: a pure tone plus two quieter overtones, struck hard and
 * ringing out. Sounds like a hotel service bell rather than a beep.
 */
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

/** A rising-falling siren sweep (for SERIOUS). */
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

/**
 * Tuned for phone speakers (loudest around 1–2.5 kHz):
 *   normal:  a service-bell "ding-dong-ding" (~1.4 s)
 *   serious: three siren sweeps followed by two sharp bells (~2.8 s)
 */
export function playNotificationSound(kind: 'normal' | 'serious' = 'normal'): void {
  if (!soundEnabled()) return
  const ac = audio()
  if (!ac) return
  // If audio is still waking up (e.g. the app just came back to the front), play once it runs.
  if (ac.state !== 'running') {
    ac.resume().then(() => { if (ac.state === 'running') schedule(ac, kind) }).catch(() => {})
  } else schedule(ac, kind)
  try { navigator.vibrate?.(kind === 'serious' ? [400, 150, 400, 150, 400, 150, 400] : [200, 80, 200]) } catch { /* not supported */ }
}

function schedule(ac: AudioContext, kind: 'normal' | 'serious') {
  const t = ac.currentTime + 0.02
  if (kind === 'serious') {
    for (let r = 0; r < 3; r++) sweep(ac, t + r * 0.62, 0.55, 0.5)
    bell(ac, 1975, t + 1.95, 0.5, 1)
    bell(ac, 1975, t + 2.25, 0.6, 1)
  } else {
    bell(ac, 1318.5, t, 0.9, 1)          // E6  ding
    bell(ac, 1046.5, t + 0.28, 0.9, 1)   // C6  dong
    bell(ac, 1568, t + 0.56, 1.2, 1)     // G6  ding (rings out)
  }
}
