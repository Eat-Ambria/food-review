// Service worker: shows phone notifications (even when the app is closed) and keeps the app on the phone so it opens without internet.
const SHELL = 'issue-desk-shell-v3'
const ASSETS = 'issue-desk-assets-v3'
const MAX_ASSETS = 80
const NAV_TIMEOUT_MS = 3500

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i])
}

async function keepAssetsOf(html) {
  const cache = await caches.open(ASSETS)
  const links = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.registration.scope).href)
  if (!links.length) return
  await Promise.all(links.map(async (url) => {
    if (await cache.match(url)) return
    try { const res = await fetch(url); if (res.ok) await cache.put(url, res) } catch { }
  }))
  const keep = new Set(links)
  const lazy = (await cache.keys()).filter((req) => !keep.has(req.url))
  for (const req of lazy.slice(0, Math.max(0, lazy.length - (MAX_ASSETS - keep.size)))) await cache.delete(req)
}

async function saveShell(res) {
  const forCache = res.clone()
  const html = await res.clone().text()
  await (await caches.open(SHELL)).put('shell', forCache)
  await keepAssetsOf(html)
}

self.addEventListener('install', (event) => event.waitUntil((async () => {
  let saved = false
  try {
    const res = await fetch(self.registration.scope, { cache: 'no-store', credentials: 'same-origin' })
    if (res.ok) { await saveShell(res); saved = true }
  } catch { }
  if (!saved) {
    for (const key of await caches.keys()) {
      if (key === SHELL || !key.startsWith('issue-desk-shell-')) continue
      const old = await (await caches.open(key)).match('shell')
      if (!old) continue
      await (await caches.open(SHELL)).put('shell', old.clone())
      const assets = await caches.open(ASSETS)
      const links = [...(await old.text()).matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.registration.scope).href)
      for (const url of links) { const hit = await caches.match(url); if (hit) await assets.put(url, hit) }
      break
    }
  }
  await self.skipWaiting()
})()))

self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (![SHELL, ASSETS].includes(key)) await caches.delete(key)
  await self.clients.claim()
})()))

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.endsWith('/version.json')) return

  if (req.mode === 'navigate') {
    const network = fetch(req.url, { cache: 'no-store', credentials: 'same-origin' })
    event.waitUntil(network.then((res) => (res.ok ? saveShell(res.clone()) : null)).catch(() => { }))
    event.respondWith((async () => {
      const cached = () => caches.open(SHELL).then((c) => c.match('shell'))
      try {
        return await Promise.race([
          network,
          new Promise((resolve, reject) => setTimeout(async () => {
            const hit = await cached()
            if (hit) resolve(hit); else reject(new Error('slow'))
          }, NAV_TIMEOUT_MS)),
        ])
      } catch {
        try { return await network } catch { return (await cached()) || Response.error() }
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
