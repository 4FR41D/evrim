/* EVRIM web — service worker (çevrimdışı kabuk, göreli yollar) */
const CACHE = 'evrim-web-v8';
const BASE = new URL('.', location.href).pathname;   // "/evrim/" veya "/"
const A = ['index.html', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/store.js', 'js/llm.js', 'js/free.js', 'js/local.js', 'js/nano.js', 'js/evolve.js', 'js/learn.js', 'js/github.js'];
const ASSETS = A.map((p) => BASE + p);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // AI ve GitHub çağrıları her zaman ağdan (önbelleğe almayın)
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const c = res.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)).catch(() => {}); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match(BASE + 'index.html')))
  );
});
