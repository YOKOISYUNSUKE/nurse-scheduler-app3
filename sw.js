// sw.js
const VERSION = 'v2025-12.15.8';

// ここは必須：未定義だとSWが起動直後に落ちます
const ENTRY_HTML = './index.html';
const STATIC_CACHE = `static-${VERSION}`;

const STATIC_ASSETS = [
  './',
  ENTRY_HTML,
  './styles.css?v=20251031',
  './app.js',
  './pwa.js',
  './auth.js',
  './gasClient.js',
  './core.dates.js',
  './assignRules.js',
  './rules.js',
  './marks.js',
  './holidayRules.js',
  './nightBand.js',
  './dataExportImport.js',

  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];



self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then((c) => c.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k !== STATIC_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 手動同期：クライアントからの要求でキャッシュを作り直す
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'MANUAL_SYNC') return;

  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k !== STATIC_CACHE)
      .map((k) => caches.delete(k)));

    const c = await caches.open(STATIC_CACHE);
    await c.addAll(STATIC_ASSETS);

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'MANUAL_SYNC_DONE', version: VERSION });
    }
  })());
});

self.addEventListener('fetch', (e) => {

  const url = new URL(e.request.url);

  // 同一オリジンの GET のみ対応（GAS などクロスオリジンは触らない）
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // ナビゲーション（HTML）：network-first（失敗時にキャッシュ）
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(ENTRY_HTML, copy));
          return res;
        })
        .catch(() => caches.match(ENTRY_HTML))
    );
    return;
  }

  // その他の静的：cache-first（なければ取得→キャッシュ）
  e.respondWith(
    caches.match(e.request)
      .then((cached) => cached || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(STATIC_CACHE).then((c) => c.put(e.request, copy));
        return res;
      }))
  );
});
