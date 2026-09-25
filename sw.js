// Service worker: cache-first cho asset tĩnh (icon, ảnh maps, CDN thư viện,
// font Google) để app mở lại NHANH và chạy được khi mạng yếu; network-first
// cho index.html + version.json để cơ chế auto-update (so APP_BUILD với
// version.json) tiếp tục hoạt động không bị SW giữ bản cũ.
//
// Nâng CACHE_VERSION mỗi khi đổi danh sách STATIC_ASSETS hay chiến lược cache.
const CACHE_VERSION = 'v2';
const STATIC_CACHE  = 'reportelv-static-' + CACHE_VERSION;
const RUNTIME_CACHE = 'reportelv-runtime-' + CACHE_VERSION;

// Precache những file gắn liền với shell của app — nhẹ, ít thay đổi.
const STATIC_ASSETS = [
  './icon-192.png',
  './icon-512.png',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Chiến lược phân loại request:
//  - index.html / version.json / API Supabase / Apps Script: network-only, KHÔNG cache
//    (dữ liệu động, giữ nguyên hành vi cũ, tránh hiển thị số liệu cũ)
//  - Font Google, CDN thư viện, ảnh maps, icon, manifest: cache-first + refresh nền
//    (giảm băng thông, mở lại nhanh, chạy được offline)
function isNoCache(url) {
  return url.pathname.endsWith('/index.html')
      || url.pathname.endsWith('/version.json')
      || url.hostname.includes('supabase')
      || url.hostname.includes('script.google.com')
      || url.hostname.includes('googleusercontent.com')
      || url.hostname.includes('r2.dev')
      || url.hostname.includes('cloudflarestorage');
}
function isCacheable(url) {
  return url.hostname === self.location.hostname
      || url.hostname.includes('fonts.googleapis.com')
      || url.hostname.includes('fonts.gstatic.com')
      || url.hostname.includes('cdn.jsdelivr.net')
      || url.hostname.includes('cdnjs.cloudflare.com');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  if (isNoCache(url)) return; // để trình duyệt tự đi mạng như bình thường
  if (!isCacheable(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    const networkFetch = fetch(req).then((res) => {
      if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    }).catch(() => null);
    // Trả bản cache trước cho nhanh; đồng thời cập nhật nền (stale-while-revalidate).
    return cached || (await networkFetch) || new Response('', { status: 504, statusText: 'Offline' });
  })());
});
