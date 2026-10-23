// Deliberately never cache authentication, API responses or warehouse data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(() =>
    new Response('<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mất kết nối</title><body style="font:16px Arial;padding:40px;max-width:600px;margin:auto"><h1>Chưa kết nối máy chủ</h1><p>Không có vận đơn nào được xác nhận thành công khi mất mạng. Kết nối lại rồi tải lại ứng dụng để tiếp tục.</p><button onclick="location.reload()">Thử lại</button></body></html>', {status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
