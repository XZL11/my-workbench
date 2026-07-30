// sw.js - PWA 离线缓存（应用壳）
const CACHE = 'workbench-v1';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './css/styles.css',
  './js/store.js', './js/ui.js', './js/sync.js', './js/app.js',
  './js/js-modules/tasks.js', './js/js-modules/calendar.js', './js/js-modules/notes.js',
  './js/js-modules/habits.js', './js/js-modules/bookmarks.js', './js/js-modules/finance.js',
  './js/js-modules/content.js', './js/js-modules/planning.js', './js/js-modules/settings.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(
    caches.match(req).then(r => r || fetch(req).then(resp => {
      const cp = resp.clone();
      caches.open(CACHE).then(c => c.put(req, cp));
      return resp;
    }).catch(() => r))
  );
});
