// Service worker: shows phone notifications (even when the app is closed) and caches the app so it opens fast.
const SHELL = 'issue-desk-shell-v2'
const ASSETS = 'issue-desk-assets-v2'
const MAX_ASSETS = 80

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil((async () => {

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
  if (url.origin !== self.location.origin) return
  if (url.pathname.endsWith('/version.json')) return

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

  if (/\.(png|webmanifest)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL)
      const hit = await cache.match(req)
      const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res }).catch(() => hit)
      return hit || fresh
    })())
  }
})

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
    silent: false,
    vibrate: serious ? [400, 150, 400, 150, 400, 150, 400] : [200, 80, 200],
    requireInteraction: serious,
    icon: new URL('icon-192.png', self.registration.scope).href,
    badge: new URL('icon-192.png', self.registration.scope).href,

    data: { url: new URL(issueLink(data), self.registration.scope).href },
  }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

    await self.registration.showNotification(title, options)

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
