/* Service Worker – App-Shell aus dem Cache, Daten bevorzugt aus dem Netz. */

const CACHE = 'bully-v11';

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
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

/* Die App meldet sich, sobald der Nutzer auf „Aktualisieren" tippt. */
self.addEventListener('message', (e) => {
  if (e.data === 'UEBERNEHMEN') self.skipWaiting();
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

  // Zugangsdaten und Spieldaten: erst Netz, Cache nur als Rückfallebene.
  if (url.pathname.includes('/data/') || url.pathname.endsWith('/konfig.js')) {
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

  // Vereinslogos: aus dem Cache, sonst holen und dort ablegen.
  if (url.pathname.includes('/icons/teams/')) {
    e.respondWith(
      caches.match(e.request).then((treffer) => treffer || fetch(e.request).then((antwort) => {
        if (antwort.ok) {
          const kopie = antwort.clone();
          caches.open(CACHE).then((c) => c.put(e.request, kopie));
        }
        return antwort;
      }))
    );
    return;
  }

  e.respondWith(caches.match(e.request).then((treffer) => treffer || fetch(e.request)));
});
