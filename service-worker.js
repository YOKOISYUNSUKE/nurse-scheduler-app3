// service-worker.js

const CACHE_NAME = "medcalc-cache-v11.29.0";

// 初期キャッシュに乗せるファイル一覧
const OFFLINE_ASSETS = [
  "./",
  "./index.html",

  // CSS
  "./css/base.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/responsive.css",

  // 共通 JS
  "./js/include.js",
  "./js/main.js",
  "./js/sortable-init.js",
  "./js/pwa-register.js",

  // 共通パーツ
  "./partials/header.html",
  "./partials/footer.html"
  // 診療科ごとの index.html など、よく使うページがあればここに追加していく
];

// インストール時：事前キャッシュ
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(OFFLINE_ASSETS);
    })
  );
});

// 有効化時：古いキャッシュを削除
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
});

// フェッチ時：キャッシュ優先＋ネットワークフォールバック
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 非 GET リクエストは素通し
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cachedRes) => {
      if (cachedRes) {
        return cachedRes;
      }

      return fetch(req)
        .then((networkRes) => {
          // 取得できたらキャッシュに保存（ナビゲーションや静的アセット）
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, resClone);
          });
          return networkRes;
        })
        .catch(() => {
          // オフライン時のナビゲーションリクエストは index.html へフォールバック
          if (req.mode === "navigate") {
            return caches.match("./index.html");
          }
        });
    })
  );
});
