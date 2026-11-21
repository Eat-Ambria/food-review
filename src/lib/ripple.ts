// Adds a soft ripple from the finger or cursor when any button, link or tappable row is pressed.
const TARGET = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], summary'
const reduce = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined

function spawn(e: PointerEvent) {
  if (e.button !== 0 || reduce?.matches) return
  const el = (e.target as Element | null)?.closest<HTMLElement>(TARGET)
  if (!el || el.closest('[data-no-ripple]') || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return

  const box = el.getBoundingClientRect()
  if (!box.width || !box.height) return
  const x = e.clientX - box.left
  const y = e.clientY - box.top
  const size = 2 * Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y))

  const restore = getComputedStyle(el).position === 'static'
  if (restore) el.style.position = 'relative'

  const clip = document.createElement('span')
  clip.className = 'ripple-clip'
  clip.setAttribute('aria-hidden', 'true')
  const wave = document.createElement('span')
  wave.className = 'ripple-wave'
  wave.style.cssText = `width:${size}px;height:${size}px;left:${x - size / 2}px;top:${y - size / 2}px`
  clip.appendChild(wave)
  el.appendChild(clip)

  let released = false
  let grown = false
  const finish = () => {
    if (!released || !grown) return
    wave.classList.add('ripple-out')
    window.setTimeout(() => {
      clip.remove()
      if (restore && !el.querySelector('.ripple-clip')) el.style.position = ''
    }, 220)
  }
  wave.addEventListener('animationend', () => { grown = true; finish() }, { once: true })
  const release = () => {
    released = true
    finish()
    window.removeEventListener('pointerup', release)
    window.removeEventListener('pointercancel', release)
  }
  window.addEventListener('pointerup', release)
  window.addEventListener('pointercancel', release)
}

if (typeof window !== 'undefined') window.addEventListener('pointerdown', spawn, { passive: true })
