// =============================================================================
// WHAT THIS FILE IS
//   refreshApp(): reloads the app so it is GUARANTEED to get the newest version.
// WHY IT EXISTS
//   A plain reload could bring back the old version: GitHub Pages tells the
//   browser it may keep index.html for 10 minutes, and an old service worker
//   keeps serving its own copy. So before reloading this:
//     1. asks the browser to fetch the newest service worker (public/sw.js),
//     2. waits (max 4 s) until that new worker is in charge,
//     3. then reloads. The new worker always fetches the page fresh (no cache).
//   Used by the "New version → Reload" button and pull-to-refresh.
// USED BY
//   components/UpdateNotice.tsx, components/PullToRefresh.tsx
// =============================================================================

export async function refreshApp(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.update()
      const next = reg.installing ?? reg.waiting
      if (next) {
        await new Promise<void>((done) => {
          const timer = setTimeout(done, 4000)
          next.addEventListener('statechange', () => {
            if (next.state === 'activated' || next.state === 'redundant') { clearTimeout(timer); done() }
          })
        })
      }
    }
  } catch { /* no service worker (e.g. private mode): a normal reload is fine */ }
  window.location.reload()
}
