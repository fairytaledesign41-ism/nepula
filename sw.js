/* Nebula Service Worker — bulletproof offline (Network-First → Cache fallback)
 * Compatible with Netlify, iOS Safari, iPadOS, Samsung Internet, Chrome, Edge, Firefox.
 * - Promise.allSettled precache (never crashes on a single failed asset)
 * - No strict response.type filter (Netlify-friendly)
 * - Skips unsupported schemes (chrome-extension, data:, blob:)
 */
const VERSION = 'nebula-v1.3.0';
const STATIC_CACHE  = 'nebula-static-'  + VERSION;
const RUNTIME_CACHE = 'nebula-runtime-' + VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './logo.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Tajawal:wght@400;500;700;800&family=Cairo:wght@400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // Promise.allSettled => one failed asset never kills the install
    const results = await Promise.allSettled(
      PRECACHE_URLS.map(async (url) => {
        try {
          const req = new Request(url, { cache: 'reload', mode: 'no-cors' });
          const res = await fetch(req);
          // accept any response (basic | opaque | cors) — Netlify/CDN friendly
          if (res) await cache.put(url, res.clone());
        } catch (e) {
          console.warn('[SW] precache skip:', url, e && e.message);
        }
      })
    );
    const failed = results.filter(r => r.status === 'rejected').length;
    console.log('[SW] precache done. failed:', failed);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map(k => caches.delete(k))
    );
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch(e){}
    }
    await self.clients.claim();
  })());
});

function isSupportedScheme(url){
  return url.startsWith('http://') || url.startsWith('https://');
}

async function networkFirst(request, preloadResponsePromise) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    if (preloadResponsePromise) {
      const preload = await preloadResponsePromise;
      if (preload) {
        cache.put(request, preload.clone()).catch(()=>{});
        return preload;
      }
    }
    const fresh = await fetch(request);
    // cache any successful or opaque response (do NOT check response.type)
    if (fresh && (fresh.ok || fresh.type === 'opaque')) {
      cache.put(request, fresh.clone()).catch(()=>{});
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(request) || await caches.match(request);
    if (cached) return cached;
    // Navigation fallback => offline shell
    if (request.mode === 'navigate') {
      const shell = await caches.match('./index.html') || await caches.match('./');
      if (shell) return shell;
    }
    return new Response('Offline', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (!isSupportedScheme(req.url)) return;

  // Network-first for everything (HTML, JS, CSS, fonts, images)
  event.respondWith(networkFirst(req, event.preloadResponse));
});

// Allow page to trigger immediate activation
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
