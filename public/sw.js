/* Cache the application shell, never live news or API responses. */
const CACHE_PREFIX = 'world-brief-shell-';
const CACHE_NAME = `${CACHE_PREFIX}ai-v2`;
const CORE_FILES = ['/', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];

function isStaticAsset(url) {
  return url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') && url.pathname !== '/api' &&
    (/^\/(?:assets|art)\/.*\.(?:js|css|svg|png|jpe?g|webp|avif|woff2?)$/i.test(url.pathname) ||
      CORE_FILES.slice(1).includes(url.pathname));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_FILES);
    const shell = await cache.match('/');
    const html = await shell.text();
    // Vite writes hashed JS/CSS references into the production HTML.
    const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(match => new URL(match[1], self.location.origin))
      .filter(isStaticAsset)
      .map(url => url.href);
    await cache.addAll([...new Set(assets)]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        // Cache only the root HTML shell, never unknown routes or errors.
        if (response.ok && url.pathname === '/' &&
            response.headers.get('content-type')?.includes('text/html')) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('/', response.clone());
        }
        return response;
      } catch {
        const shell = await caches.match('/', { cacheName: CACHE_NAME });
        return shell || new Response(
          '<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI BRIEF · Offline</title><body style="font-family:system-ui;max-width:36rem;margin:15vh auto;padding:2rem"><h1>AI BRIEF</h1><p>คุณออฟไลน์อยู่ เชื่อมต่ออินเทอร์เน็ตเพื่ออ่านข่าวล่าสุด</p><p>You are offline. Reconnect to read the latest news.</p></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
      return response;
    })());
  }
});
