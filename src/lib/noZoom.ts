// =============================================================================
// WHAT THIS FILE IS
//   Stops pinch-zoom (and double-tap zoom) on phones, so the app behaves like a
//   native app.
// WHY IT EXISTS
//   On iPhone the page could be pinched OUT into a small box with empty space
//   around it, and Safari ignores "user-scalable=no" in the viewport tag. So
//   three layers, any one of which is enough on most phones:
//     1. index.html viewport: maximum-scale=1, user-scalable=no (Android)
//     2. index.css: touch-action: pan-x pan-y (only scrolling, no zoom gestures)
//     3. here: cancel iPhone's own pinch events ("gesture…") and any two-finger
//        move.
//   Text is already sized for phones (inputs are 16px, so iPhone does not
//   auto-zoom when a field is tapped).
// USED BY
//   main.tsx (imported once, before the app renders)
// =============================================================================

const stop = (e: Event) => e.preventDefault()

if (typeof document !== 'undefined') {
  // Safari (iPhone / iPad) pinch gestures
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, stop, { passive: false })
  }
  // Any browser: a move with two or more fingers is a pinch, not a scroll
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault() }, { passive: false })
}

export {}
