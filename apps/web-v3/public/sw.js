const version = new URL(self.location.href).searchParams.get('v') || 'dev';
const SHELL_CACHE = `arena-v3-shell-${version}`;
const STATIC_CACHE = `arena-v3-static-${version}`;
const SHELL_KEY = new Request(new URL('/__arena-v3-shell__', self.location.origin));
const CORE_ASSETS = ['/manifest.webmanifest', '/pwa/arena-icon.svg'];

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function staticRequest(request, url) {
  return sameOrigin(url) && (
    ['script', 'style', 'image', 'font'].includes(request.destination)
    || url.pathname === '/manifest.webmanifest'
    || url.pathname.startsWith('/pwa/')
  );
}

async function cacheShell() {
  const response = await fetch(new Request('/', { cache: 'reload' }));
  if (!response.ok) throw new Error(`Shell returned ${response.status}`);

  const shellCache = await caches.open(SHELL_CACHE);
  await shellCache.put(SHELL_KEY, response.clone());

  const html = await response.text();
  const discovered = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(match => match[1])
    .filter(Boolean)
    .map(value => new URL(value, self.location.origin))
    .filter(sameOrigin)
    .map(url => `${url.pathname}${url.search}`);
  const urls = [...new Set([...CORE_ASSETS, ...discovered])];
  const staticCache = await caches.open(STATIC_CACHE);
  await Promise.allSettled(urls.map(url => staticCache.add(new Request(url, { cache: 'reload' }))));
}

async function cleanOldCaches() {
  const keep = new Set([SHELL_CACHE, STATIC_CACHE, 'arena-v3-api-last-good-v1']);
  const names = await caches.keys();
  await Promise.all(names
    .filter(name => (name.startsWith('arena-v3-shell-') || name.startsWith('arena-v3-static-')) && !keep.has(name))
    .map(name => caches.delete(name)));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      await cacheShell();
    } finally {
      await self.skipWaiting();
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await cleanOldCaches();
    try {
      await cacheShell();
    } catch {
      // A previous shell can still serve the app if the activation refresh is offline.
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate' && sameOrigin(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(SHELL_KEY, response.clone());
        return response;
      } catch {
        return await cache.match(SHELL_KEY)
          || new Response('ARENA is offline and the app shell is not cached yet.', {
            status: 503,
            headers: { 'content-type': 'text/plain; charset=utf-8' }
          });
      }
    })());
    return;
  }

  if (!staticRequest(request, url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
