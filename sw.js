const CACHE_NAME = 'workmap-static-v27-auth-failed-fetch-fix';
const STATIC_FILES = [
  './',
  './index.html',
  './style.css?v=20260723-authfix1',
  './config.js?v=20260723-authfix1',
  './auth-hotfix.js?v=20260723-authfix1',
  './app.js?v=20260723-authfix1',
  './manifest.webmanifest',
  './상상인로고.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(STATIC_FILES.map((file) => cache.add(file)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase, jsDelivr 등 외부 요청은 서비스워커가 절대 가로채거나 캐시하지 않습니다.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (request.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }

        throw new Error('네트워크와 캐시에 응답이 없습니다.');
      })
  );
});
