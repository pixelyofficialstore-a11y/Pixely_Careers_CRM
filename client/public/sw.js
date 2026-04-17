self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'SHOW_NOTIFICATION') return;

  const { title, body, priority } = data;

  const options = {
    body: body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'pixelcrm-' + Date.now(),
    requireInteraction: priority === 'action_required',
    vibrate: priority === 'action_required' ? [200, 100, 200] : undefined,
    data: { url: '/orders' },
  };

  event.waitUntil(
    self.registration.showNotification(title || 'PixelCRM', options)
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
