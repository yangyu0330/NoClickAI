const CACHE_NAME = 'noclick-ai-v2'
const APP_SHELL = ['/', '/manifest.webmanifest', '/pwa-icon.svg']

function shouldCache(request) {
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return false
  if (url.pathname === '/health' || url.pathname.startsWith('/v1/')) return false
  if (request.headers.has('authorization')) return false
  return request.mode === 'navigate' || url.pathname.startsWith('/assets/') || APP_SHELL.includes(url.pathname)
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  if (!shouldCache(event.request)) return

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const responseClone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone))
        }
        return response
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))),
  )
})
