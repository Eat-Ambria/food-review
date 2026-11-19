// Stops pinch and double-tap zoom on phones.
const stop = (e: Event) => e.preventDefault()

if (typeof document !== 'undefined') {

  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, stop, { passive: false })
  }

  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault() }, { passive: false })
}

export {}
