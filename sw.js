// sw.js — DOT App service worker
// Cache-first for app shell. Enables full offline use after first load.

const CACHE = 'dot-app-v1';
const PRECACHE = [
  './dot_app.html',
  './dot_core.js',
  './sw.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Let CDN requests (fonts, qrcode, jsqr, simple-peer) bypass cache
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached ?? fetch(e.request))
  );
});
