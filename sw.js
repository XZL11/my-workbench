// sw.js - PWA 离线缓存（应用壳）
// 修正：资源清单改为真实存在的文件（原 tasks.js 不存在导致 install 失败、离线失效）；
//       补 icons.js / today.js / 图标；缓存策略改为 stale-while-revalidate，部署后免硬刷新。
const CACHE = 'workbench-v3';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './css/styles.css',
  './js/store.js', './js/ui.js', './js/icons.js', './js/sync.js', './js/app.js',
  './js/js-modules/calendar.js', './js/js-modules/today.js', './js/js-modules/notes.js',
  './js/js-modules/habits.js', './js/js-modules/bookmarks.js', './js/js-modules/finance.js',
  './js/js-modules/content.js', './js/js-modules/planning.js', './js/js-modules/settings.js',
  './icons/icon-192.png', './icons/icon-512.png'
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

// stale-while-revalidate：先返回缓存（秒开、无闪烁），后台静默更新缓存，下次访问即最新。
// 配合 CACHE 版本号（v2），旧缓存会在 activate 阶段被清理，部署无需硬刷新。
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(
    caches.match(req).then(r => {
      const fetched = fetch(req).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const cp = resp.clone();
          caches.open(CACHE).then(c => c.put(req, cp));
        }
        return resp;
      }).catch(() => r);
      return r || fetched;
    })
  );
});
