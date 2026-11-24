// 오프라인에서도 앱 화면이 열리도록 하는 간단한 서비스 워커
// - 페이지: 네트워크 우선 (새 버전 반영), 안 되면 저장본
// - JS/CSS/아이콘: 저장본 우선 (파일명에 해시가 붙어 있어 안전)
const CACHE = 'my-calendar-v2'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  const save = (res) => {
    if (res.ok) {
      const copy = res.clone()
      caches.open(CACHE).then((c) => c.put(req, copy))
    }
    return res
  }
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(save).catch(() => caches.match(req).then((r) => r || caches.match('./'))))
    return
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(save)))
})

// 알림을 누르면 앱 창을 앞으로 가져오고 해당 항목을 연다
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const data = e.notification.data
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const win = list[0]
      if (win) {
        win.postMessage({ type: 'open-item', data })
        return win.focus()
      }
      return self.clients.openWindow('./')
    }),
  )
})
