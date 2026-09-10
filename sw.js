// 合成星核 H5 — Service Worker（PWA 离线缓存）
// 策略：HTML 走网络优先（保证更新），静态资源走缓存优先；跨域请求（广告 SDK）不缓存。
const CACHE = 'starcore-v1';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/audio.js',
  './js/ads.js',
  './js/shop.js',
  './js/game.js',
  './store/icon-192.png',
  './store/icon-512.png',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 逐个添加，个别资源缺失不影响整体安装
      return Promise.all(ASSETS.map(function (u) { return c.add(u).catch(function () {}); }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  // 跨域（优量汇广告 SDK、支付等）必须实时联网，不纳入缓存
  if (url.origin !== self.location.origin) return;

  const isHTML = e.request.mode === 'navigate' ||
                 url.pathname.endsWith('.html') ||
                 url.pathname.endsWith('/');

  if (isHTML) {
    // 网络优先：拿得到就用最新的并回写缓存，离线时回退到缓存的首页
    e.respondWith(
      fetch(e.request).then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        }
        return res;
      }).catch(function () { return caches.match('./index.html'); })
    );
    return;
  }

  // 静态资源：stale-while-revalidate
  // 有缓存则立即返回（快），同时后台拉取新版本写入缓存，下次访问生效。
  // 这样重新构建后不必手动清缓存，也不会因纯缓存优先而永久停在旧版本。
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      const network = fetch(e.request).then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || network;
    })
  );
});
