self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {}

  const notificationTitle = data.title || 'Pixely CRM';
  const body = data.body || '';
  const priority = data.priority || 'update';

  const options = {
    body: notificationTitle === 'Pixely CRM' ? body : `${notificationTitle}: ${body}`,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.tag || 'pixelcrm-notification',
    requireInteraction: priority === 'action_required',
    vibrate: priority === 'action_required' ? [200, 100, 200] : undefined,
    data: { url: data.url || '/orders' },
  };

  event.waitUntil(
    self.registration.showNotification('Pixely CRM', options)
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'SHOW_NOTIFICATION') return;

  const { title, body, priority, url, tag } = data;

  const options = {
    body: title ? `${title}: ${body || ''}` : (body || ''),
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: tag || 'pixelcrm-notification',
    requireInteraction: priority === 'action_required',
    vibrate: priority === 'action_required' ? [200, 100, 200] : undefined,
    data: { url: url || '/orders' },
  };

  event.waitUntil(
    self.registration.showNotification('Pixely CRM', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/orders';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(targetUrl);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
