const CACHE_NAME = 'visupause-pro-v17';
const APP_SHELL = [
  './',
  './index.html',
  './privacy.html',
  './terms.html',
  './styles.css?v=17',
  './app.js?v=17',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/exercises.js?v=17',
  './src/animations.js?v=17',
  './src/rhythm.js?v=17',
  './src/background-timer.js?v=17',
  './src/selector.js?v=17',
  './src/storage.js?v=17',
  './src/i18n.js?v=17'
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
  const reminderKind = ['visual', 'posture'].includes(event.notification.data?.reminderKind)
    ? event.notification.data.reminderKind
    : 'visual';
  const action = event.action === 'snooze' ? 'snooze' : 'start-break';
  const reminderId = event.notification.data?.reminderId || '';
  if (event.notification.tag === 'visupause-break-due') {
    targetUrl.hash = new URLSearchParams({ 'pause-due': reminderKind, action, id: reminderId }).toString();
  }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const appUrl = new URL('./index.html', self.location.href);
      const rootUrl = new URL('./', self.location.href);
      const sameAppClient = clientList.find(client => {
        const url = new URL(client.url);
        return url.origin === appUrl.origin && [appUrl.pathname, rootUrl.pathname].includes(url.pathname);
      });
      if (sameAppClient) {
        sameAppClient.postMessage({
          type: 'VISUPAUSE_NOTIFICATION_CLICK',
          tag: event.notification.tag,
          reminderKind,action,reminderId,
          url: targetUrl.href
        });
        if (event.notification.tag === 'visupause-break-due' && action === 'snooze') return;
        return sameAppClient.focus();
      }
      return clients.openWindow(targetUrl.href);
    })
  );
});
