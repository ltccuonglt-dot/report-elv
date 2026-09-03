// Service worker tối giản — chỉ để trình duyệt (Chrome/Edge/Android) coi app
// là "cài đặt được" (installable), không cache gì cả nên luôn lấy bản mới nhất
// từ server mỗi lần mở, không sợ bị kẹt bản cũ.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // Không can thiệp gì — để trình duyệt tự lấy dữ liệu qua mạng như bình thường.
});
