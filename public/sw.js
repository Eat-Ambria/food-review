// =============================================================================
// WHAT THIS FILE IS
//   The service worker: a small script the phone keeps alive in the background
//   so it can show a notification even when the app is closed.
// WHY IT EXISTS
//   Web Push messages are delivered to the service worker, not to the page.
//   • "push": show the notification (title, body), tagged per recording so
//     a retry replaces it instead of stacking a second one.
//   • "notificationclick": focus an open app window and go to the Issues
//     page, or open a new window if none is open.
//   Offline / fast start, with a SAFE cache only:
//   • built files under /assets/ (hashed names, never change) → cache first
//   • icons, manifest → cache, refreshed in the background
//   • the page itself (index.html) → network first, cached copy only when offline
//   • EVERYTHING else is untouched. Supabase (issues, transcripts, audio
//     links) is on another domain and never cached, so private data is never
//     stored by the browser cache.
//   Notifications are shown with registration.showNotification(). Never use
//   `new Notification()`: it throws on Chrome for Android.
// USED BY
//   src/lib/push.ts (registers it); the Edge Function process-issue sends the pushes
// =============================================================================

// v2: the page is now always fetched past the browser's HTTP cache (see below);
// the new names also clear any page copy saved by the old worker.
const SHELL = 'issue-desk-shell-v2'
const ASSETS = 'issue-desk-assets-v2'
const MAX_ASSETS = 80

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  // Remove caches from older versions of this file.
  for (const key of await caches.keys()) if (![SHELL, ASSETS].includes(key)) await caches.delete(key)
  await self.clients.claim()
})()))

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i])
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return            // Supabase etc.: never touched
  if (url.pathname.endsWith('/version.json')) return          // update check must always be live

  // The page: network first, cached copy only when offline.
  // cache: 'no-store' skips the browser's HTTP cache: GitHub Pages allows
  // index.html to be kept 10 minutes, which kept bringing back the OLD version
  // after "Reload".
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req.url, { cache: 'no-store', credentials: 'same-origin' })
        if (res.ok) (await caches.open(SHELL)).put('shell', res.clone())
        return res
      } catch {
        return (await caches.open(SHELL)).match('shell') || Response.error()
      }
    })())
    return
  }

  // Hashed build files: cache first.
  if (url.pathname.includes('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS)
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok) { cache.put(req, res.clone()); trim(ASSETS, MAX_ASSETS) }
      return res
    })())
    return
  }

  // Icons + manifest: serve cached, refresh in the background.
  if (/\.(png|webmanifest)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL)
      const hit = await cache.match(req)
      const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res }).catch(() => hit)
      return hit || fresh
    })())
  }
})

/** Page to open for a push: issues?submission=<id> when the tag carries the id. */
function issueLink(data) {
  const m = /^issues-([0-9a-f-]{36})$/i.exec(data.tag || '')
  return m ? 'issues?submission=' + m[1] : (data.url || 'issues')
}

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'New issue', body: event.data?.text() ?? '' } }
  const title = data.title || 'New issue'
  const serious = /^serious/i.test(title)
  const options = {
    body: data.body || '',
    tag: data.tag || 'issue-desk',
    renotify: true,
    silent: false,                                   // always the phone's own notification sound
    vibrate: serious ? [400, 150, 400, 150, 400, 150, 400] : [200, 80, 200],
    requireInteraction: serious,                     // a serious alert stays until it is seen
    icon: new URL('icon-192.png', self.registration.scope).href,
    badge: new URL('icon-192.png', self.registration.scope).href,
    // The tag is "issues-<submission id>": open that complaint's issues, not just today's list.
    data: { url: new URL(issueLink(data), self.registration.scope).href },
  }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // The phone's own sound ALWAYS plays (app open or closed). Muting it while the
    // app is open was tried, but iPhone only lets a web app play sound right after
    // a tap, so an open-but-untouched app ended up completely silent. The app's own
    // chime (src/lib/sound.ts) is an extra on top, when the phone allows it.
    await self.registration.showNotification(title, options)
    // Tell any open app window, so it refreshes the bell and plays its sound now.
    for (const w of wins) w.postMessage({ type: 'issue-desk-push', serious })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || self.registration.scope
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus()
        if ('navigate' in w) await w.navigate(target).catch(() => {})
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})
