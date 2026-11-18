// =============================================================================
// WHAT THIS FILE IS
//   Pull-to-refresh for phones: at the top of a page, drag down and let go to
//   reload the app (always the newest version, via lib/refreshApp.ts).
// WHY IT EXISTS
//   The installed app (Add to Home Screen / Install app) has no browser reload
//   button, so staff had no way to refresh. A round marigold indicator follows
//   the finger and its arrow turns; past the threshold it says "Release to
//   refresh".
//   It stays OFF when:
//     • the page is not scrolled to the very top (normal scrolling wins)
//     • something marked data-no-pull is on screen (the recorder while
//       recording: a reload would lose the recording in progress)
//     • a dialog is open, or the finger starts inside a scrolled box
//   The browser's own pull-to-refresh is switched off in index.css
//   (overscroll-behavior), so only this one runs.
// USED BY
//   layouts/AppLayout.tsx
// =============================================================================
import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { refreshApp } from '../lib/refreshApp'

const THRESHOLD = 70     // px of (damped) pull needed to refresh
const MAX = 110

/** How far the page is scrolled, whichever element is doing the scrolling. */
const pageScrollTop = () =>
  Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop,
    document.getElementById('root')?.scrollTop ?? 0)

/** True if the touch began inside something that is itself scrolled down. */
function insideScrolledBox(el: EventTarget | null): boolean {
  for (let n = el as HTMLElement | null; n; n = n.parentElement) {
    if (n.scrollTop > 0) return true
  }
  return false
}

export function PullToRefresh() {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const pullRef = useRef(0)

  useEffect(() => {
    const blocked = () =>
      pageScrollTop() > 0 || document.querySelector('[data-no-pull], [role="dialog"]') !== null

    const onStart = (e: TouchEvent) => {
      if (refreshing || e.touches.length !== 1 || blocked() || insideScrolledBox(e.target)) { startY.current = null; return }
      startY.current = e.touches[0].clientY
    }
    const onMove = (e: TouchEvent) => {
      if (startY.current === null) return
      const dy = e.touches[0].clientY - startY.current
      // Finger moving up, or the page has started scrolling: this is a scroll, let it go.
      if (dy <= 0 || pageScrollTop() > 0) { startY.current = null; pullRef.current = 0; setPull(0); return }
      e.preventDefault()                                   // we handle this drag, not the page
      const damped = Math.min(MAX, dy * 0.5)
      pullRef.current = damped
      setPull(damped)
    }
    const onEnd = () => {
      if (startY.current === null) return
      startY.current = null
      if (pullRef.current >= THRESHOLD) {
        setRefreshing(true)
        setPull(THRESHOLD)
        void refreshApp()
      } else {
        pullRef.current = 0
        setPull(0)
      }
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [refreshing])

  if (pull <= 0 && !refreshing) return null
  const ready = pull >= THRESHOLD
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex flex-col items-center md:hidden"
      style={{ transform: `translateY(${pull + 8}px)`, transition: startY.current === null ? 'transform 200ms ease' : 'none' }}>
      <span className={`flex size-10 items-center justify-center rounded-full bg-white shadow-pop ring-1 ring-black/5 transition-colors ${ready ? 'text-accent' : 'text-muted'}`}>
        {refreshing
          ? <span className="size-5 animate-spin rounded-full border-2 border-marigold border-r-transparent" />
          : <Icon name="refresh" className="size-5" style={{ transform: `rotate(${pull * 3}deg)` }} />}
      </span>
      <span className="mt-1.5 rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-semibold text-ink/80 shadow-sm">
        {refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}
      </span>
    </div>
  )
}
