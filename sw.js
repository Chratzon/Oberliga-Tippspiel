/* Service Worker – App-Shell aus dem Cache, Daten bevorzugt aus dem Netz. */

const CACHE = 'bully-v1';

const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './sync.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Spielplan und Ergebnisse: erst Netz, Cache als Rückfallebene.
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request)
        .then((antwort) => {
          const kopie = antwort.clone();
          caches.open(CACHE).then((c) => c.put(e.request, kopie));
          return antwort;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(caches.match(e.request).then((treffer) => treffer || fetch(e.request)));
});
