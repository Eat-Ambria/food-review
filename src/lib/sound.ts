// =============================================================================
// WHAT THIS FILE IS
//   The in-app notification sound: a soft two-note chime for a new issue, and
//   a sharper triple beep for a SERIOUS one. Plus the user's On/Off choice.
// WHY IT EXISTS
//   When the app is open, the phone often does not sound for a push, so the
//   app plays its own sound. The sounds are generated with the Web Audio API
//   (no audio files to download).
//   Browsers only allow sound after the person has tapped something on the
//   page, so the first tap or keypress "unlocks" audio. That happens naturally
//   at login.
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
    if (ctx.state === 'suspended') void ctx.resume()
    if (!out) {
      // Loud but clean on small phone speakers: boost, then a limiter so it never distorts.
      const master = ctx.createGain()
      master.gain.value = 1.6
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

// Unlock audio on the first interaction (browser autoplay rules).
if (typeof window !== 'undefined') {
  const unlock = () => { audio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock) }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

/** One short tone with a soft attack/decay, so it never clicks. */
function tone(ac: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, peak: number) {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(gain).connect(out ?? ac.destination)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

/**
 * Tuned for phone speakers (they are loudest around 1–2.5 kHz):
 *   normal:  a bright three-note rising chime (~0.8 s)
 *   serious: a sharp alarm, three fast beeps, repeated three times (~2.4 s)
 */
export function playNotificationSound(kind: 'normal' | 'serious' = 'normal'): void {
  if (!soundEnabled()) return
  const ac = audio()
  if (!ac) return
  const t = ac.currentTime + 0.02
  if (kind === 'serious') {
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 3; i++) tone(ac, i % 2 ? 1480 : 1975, t + r * 0.8 + i * 0.15, 0.13, 'square', 0.45)
    }
  } else {
    tone(ac, 1046.5, t, 0.22, 'triangle', 0.9)        // C6
    tone(ac, 1318.5, t + 0.14, 0.24, 'triangle', 0.9) // E6
    tone(ac, 1568, t + 0.28, 0.5, 'triangle', 0.95)   // G6
  }
  try { navigator.vibrate?.(kind === 'serious' ? [400, 150, 400, 150, 400, 150, 400] : [200, 80, 200]) } catch { /* not supported */ }
}
