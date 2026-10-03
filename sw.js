// Link cũ đã chuyển (03/10/2026): service worker này xoá cache cũ rồi tự gỡ, để app cũ
// đã cài trên máy luôn tải trang "Cập nhật" mới nhất thay vì bản app cũ còn trong cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.navigate(c.url));
  })());
});
