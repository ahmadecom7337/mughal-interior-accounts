/* Offline fallback only: never cache accounting records, credentials or API responses. */
const CACHE_PREFIX = `mughal-pwa:${new URL(self.registration.scope).pathname}:`;
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const OFFLINE_URL = new URL('offline.html', self.registration.scope).href;
const ICON_URL = new URL('assets/pwa/icon-192.png', self.registration.scope).href;
const APP_PAGES = new Set([self.registration.scope, new URL('index.html', self.registration.scope).href, OFFLINE_URL]);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll([
    new Request(OFFLINE_URL, {cache: 'reload'}),
    new Request(ICON_URL, {cache: 'reload'})
  ])));
  // Existing app windows keep their worker until the user accepts the update.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url), scope = new URL(self.registration.scope);
  if (request.method !== 'GET' || request.headers.has('Authorization') || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (url.href === ICON_URL) {
    event.respondWith(caches.open(CACHE_NAME).then(async cache => (await cache.match(ICON_URL)) || fetch(request)));
    return;
  }
  if (request.mode !== 'navigate' || !APP_PAGES.has(url.origin + url.pathname)) return;
  // Do not cache the app HTML: launches must load the latest code and current accounts.
  event.respondWith(fetch(request, {cache: 'no-store'}).catch(async () => {
    const cache = await caches.open(CACHE_NAME), offline = await cache.match(OFFLINE_URL);
    return offline || new Response('You are offline. Reconnect and reopen Mughal Accounts.', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
  }));
});
