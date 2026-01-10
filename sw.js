// sw.js - Service Worker
// 修正版：app.js分割に対応、キャッシュ戦略最適化

const VERSION = 'v2026-01.10.1';

// ここは必須：未定義だとSWが起動直後に落ちます
const ENTRY_HTML = './index.html';
const STATIC_CACHE = `static-${VERSION}`;

// キャッシュ対象の静的アセット
const STATIC_ASSETS = [
  './',
  ENTRY_HTML,
  './styles.css?v=20251031',
  
  // app.js分割モジュール
  './app-core.js',
  './app-utils.js',
  './app-init.js',
  './app-storage.js',
  './app-render.js',
  './app-navigation.js',
  './app-dialog.js',
  './app-export.js',
  
  // その他のスクリプト
  './pwa.js',
  './auth.js',
  './gasClient.js',
  './supabaseClient.js',
  './core.dates.js',
  './assignRules.js',
  './rules.js',
  './marks.js',
  './holidayRules.js',
  './nightBand.js',
  './dataExportImport.js',
  './buttonHandlers.js',
  './cellOperations.js',
  './autoAssignLogic.js',
  './employeeDialog.js',
  
  // マニフェスト
  './manifest.webmanifest',
  
  // アイコン
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// キャッシュ対象外のパターン（GAS等のクロスオリジン）
const NON_CACHEABLE_PATTERNS = [
  /script\.google\.com/,
  /googleapis\.com/,
  /gstatic\.com/,
  /supabase\.co/
];


/**
 * URLがキャッシュ対象外か判定
 */
function isNonCacheable(url) {
  return NON_CACHEABLE_PATTERNS.some(pattern => pattern.test(url));
}

/**
 * キャッシュ削除（古いバージョンのクリーンアップ）
 */
async function cleanupOldCaches() {
  const keys = await caches.keys();
  return Promise.all(
    keys
      .filter(k => k !== STATIC_CACHE)
      .map(k => {
        console.log(`[SW] Deleting old cache: ${k}`);
        return caches.delete(k);
      })
  );
}

/**
 * キャッシュの初期化
 */
async function initializeCache() {
  try {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(STATIC_ASSETS);
    console.log(`[SW] Cache initialized: ${STATIC_CACHE}`);
  } catch (error) {
    console.error('[SW] Cache initialization failed:', error);
  }
}

// ============================================
// Service Worker イベントハンドラ
// ============================================

/**
 * install イベント：キャッシュの初期化
 */
self.addEventListener('install', (e) => {
  console.log(`[SW] Installing version: ${VERSION}`);
  e.waitUntil(
    initializeCache()
      .then(() => self.skipWaiting())
  );
});

/**
 * activate イベント：古いキャッシュの削除
 */
self.addEventListener('activate', (e) => {
  console.log(`[SW] Activating version: ${VERSION}`);
  e.waitUntil(
    cleanupOldCaches()
      .then(() => self.clients.claim())
  );
});

/**
 * message イベント：クライアントからのメッセージ処理
 * - MANUAL_SYNC: 手動でキャッシュを再構築
 */
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'MANUAL_SYNC') return;

  console.log('[SW] Manual sync requested');
  
  e.waitUntil((async () => {
    try {
      // 古いキャッシュを削除
      await cleanupOldCaches();
      
      // キャッシュを再初期化
      await initializeCache();
      
      // クライアントに完了を通知
      const clients = await self.clients.matchAll({ 
        type: 'window', 
        includeUncontrolled: true 
      });
      
      for (const client of clients) {
        client.postMessage({ 
          type: 'MANUAL_SYNC_DONE', 
          version: VERSION,
          timestamp: new Date().toISOString()
        });
      }
      
      console.log('[SW] Manual sync completed');
    } catch (error) {
      console.error('[SW] Manual sync failed:', error);
      
      // クライアントにエラーを通知
      const clients = await self.clients.matchAll({ 
        type: 'window', 
        includeUncontrolled: true 
      });
      
      for (const client of clients) {
        client.postMessage({ 
          type: 'MANUAL_SYNC_ERROR', 
          error: error.message 
        });
      }
    }
  })());
});

/**
 * fetch イベント：キャッシュ戦略の実装
 * - ナビゲーション（HTML）: network-first
 * - 静的アセット: cache-first
 * - クロスオリジン: network-only
 */
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  // GET リクエストのみ処理
  if (e.request.method !== 'GET') return;
  
  // クロスオリジンまたはキャッシュ対象外の場合はスキップ
  if (url.origin !== self.location.origin || isNonCacheable(url.href)) {
    return;
  }
  
  // ナビゲーション（HTML）: network-first
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          // 成功時：レスポンスをキャッシュに保存
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(STATIC_CACHE)
              .then((c) => c.put(ENTRY_HTML, copy))
              .catch(err => console.error('[SW] Cache put failed:', err));
          }
          return res;
        })
        .catch(() => {
          // ネットワーク失敗時：キャッシュから取得
          return caches.match(ENTRY_HTML)
            .catch(err => {
              console.error('[SW] Cache match failed:', err);
              return new Response('Offline - Page not available', {
                status: 503,
                statusText: 'Service Unavailable'
              });
            });
        })
    );
    return;
  }
  
  // 静的アセット: cache-first
  e.respondWith(
    caches.match(e.request)
      .then((cached) => {
        if (cached) {
          return cached;
        }
        
        // キャッシュにない場合：ネットワークから取得
        return fetch(e.request)
          .then((res) => {
            // 成功時：キャッシュに保存
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(STATIC_CACHE)
                .then((c) => c.put(e.request, copy))
                .catch(err => console.error('[SW] Cache put failed:', err));
            }
            return res;
          })
          .catch((err) => {
            console.error(`[SW] Fetch failed for ${url.href}:`, err);
            // ネットワーク失敗時のフォールバック
            return new Response('Offline - Resource not available', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
      .catch(err => {
        console.error('[SW] Cache match failed:', err);
        return new Response('Service Worker error', {
          status: 500,
          statusText: 'Internal Server Error'
        });
      })
  );
});

// ============================================
// デバッグ用ログ
// ============================================

console.log(`[SW] Service Worker loaded: ${VERSION}`);