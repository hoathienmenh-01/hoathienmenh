/**
 * Phase PWA-1 — Auxiliary push handler imported into Workbox-generated
 * service worker via `workbox.importScripts: ['push-sw.js']`.
 *
 * Responsibilities:
 *   - Handle `push` event: parse JSON payload from server, render
 *     `Notification` via `registration.showNotification`.
 *   - Handle `notificationclick`: focus or open `payload.url`.
 *
 * Payload shape (`WebPushPayload` từ `@xuantoi/shared`):
 *   { type, title, body, url?, tag?, ts }
 */

/* eslint-env serviceworker */

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = null;
  try {
    payload = event.data.json();
  } catch {
    try {
      payload = { title: 'Xuân Tôi', body: event.data.text() };
    } catch {
      payload = { title: 'Xuân Tôi', body: 'Bạn có thông báo mới.' };
    }
  }
  const title = (payload && payload.title) || 'Xuân Tôi';
  const body = (payload && payload.body) || '';
  const url = (payload && payload.url) || '/';
  const tag = (payload && payload.tag) || null;
  const opts = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url },
    tag: tag || undefined,
    // `renotify` only meaningful with `tag`.
    renotify: Boolean(tag),
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target =
    (event.notification && event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientsList) => {
        for (const c of clientsList) {
          if (typeof c.focus === 'function' && c.url.includes(target)) {
            return c.focus();
          }
        }
        if (typeof self.clients.openWindow === 'function') {
          return self.clients.openWindow(target);
        }
        return null;
      }),
  );
});
