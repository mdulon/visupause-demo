const CACHE_NAME = 'visupause-pro-v10';
const APP_SHELL = [
  './',
  './index.html',
  './privacy.html',
  './terms.html',
  './styles.css?v=10',
  './app.js?v=10',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/exercises.js',
  './src/animations.js',
  './src/score.js',
  './src/selector.js',
  './src/storage.js',
  './src/i18n.js?v=10'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (!response.ok) return response;
          const copy = response.clone();
          return caches.open(CACHE_NAME)
            .then(cache => cache.put(event.request, copy))
            .then(() => response);
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (!response.ok || response.type !== 'basic') return response;
      const copy = response.clone();
      return caches.open(CACHE_NAME)
        .then(cache => cache.put(event.request, copy))
        .then(() => response);
    }))
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './index.html', self.location.href);
  if (event.notification.tag === 'visupause-break-due') targetUrl.hash = 'pause-due';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const sameAppClient = clientList.find(client => client.url.startsWith(self.registration.scope));
      if (sameAppClient) {
        sameAppClient.postMessage({
          type: 'VISUPAUSE_NOTIFICATION_CLICK',
          tag: event.notification.tag,
          url: targetUrl.href
        });
        return sameAppClient.focus();
      }
      return clients.openWindow(targetUrl.href);
    })
  );
});
