// Service Worker — Segundo Cerebro
// Cache básico para que la app cargue más rápido y pase la auditoría PWA

const CACHE = 'sc-v1';
const ASSETS = [
  '/segundo-cerebro/',
  '/segundo-cerebro/index.html',
  '/segundo-cerebro/styles.css',
  '/segundo-cerebro/app.js',
  '/segundo-cerebro/manifest.json',
  '/segundo-cerebro/icon-192.png',
  '/segundo-cerebro/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Solo cachear GET, dejar pasar Firebase y APIs externas
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname !== location.hostname) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
