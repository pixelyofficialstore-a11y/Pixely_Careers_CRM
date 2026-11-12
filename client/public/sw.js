/* Pixely Workspace service worker: web push + offline shell. */
const VERSION = 'px-v3';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const MAX_ASSETS = 80;
const PRECACHE = [
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/badge-96.png',
  '/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API data (per-user, always live).
  if (url.pathname.startsWith('/api/')) return;

  // App pages: network first; offline → last good shell → offline page.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put('/', res.clone());
        }
        return res;
      } catch (_) {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('/')) || (await cache.match('/offline.html')) || Response.error();
      }
    })());
    return;
  }

  // Built, hashed files never change: cache first (keeps the offline shell working).
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) {
        cache.put(req, res.clone());
        trimCache(ASSET_CACHE, MAX_ASSETS);
      }
      return res;
    })());
    return;
  }

  // Icons / manifest / sounds: stale-while-revalidate.
  if (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/sounds/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const hit = await cache.match(req);
      const refresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || refresh;
    })());
  }
});

/* ---------------- Push ---------------- */

const UA = self.navigator.userAgent || '';
// Safari/iOS revokes push permission if a push does not show a notification.
const MUST_ALWAYS_SHOW = /AppleWebKit/.test(UA) && !/Chrome|Chromium|CriOS|Edg|Android/.test(UA);

function notificationOptions(data) {
  const actionRequired = data.priority === 'action_required';
  return {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/badge-96.png',
    tag: data.tag || 'px-general',
    renotify: true,
    requireInteraction: actionRequired,
    vibrate: actionRequired ? [200, 100, 200] : [100],
    timestamp: Date.now(),
    data: { url: data.url || '/' },
  };
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const focused = windows.some((c) => c.focused && c.visibilityState === 'visible');
    // An open, focused CRM already shows it in-app (toast + bell). Test pushes always show.
    if (focused && !MUST_ALWAYS_SHOW && data.tag !== 'px-test') return;
    await self.registration.showNotification(data.title || 'Pixely Workspace', notificationOptions(data));
  })());
});

// In-app fallback (tab hidden, this device has no push subscription).
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'SHOW_NOTIFICATION') return;
  event.waitUntil(self.registration.showNotification(data.title || 'Pixely Workspace', notificationOptions(data)));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find((c) => c.url.startsWith(self.location.origin));
    if (client) {
      await client.focus();
      // The app routes in place (no reload); fall back to a full navigation.
      client.postMessage({ type: 'NAVIGATE', url: target.slice(self.location.origin.length) });
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

// The browser rotated the subscription: re-subscribe now; the app sends the
// new one to the server the next time it opens (it needs the session cookie).
self.addEventListener('pushsubscriptionchange', (event) => {
  const key = event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey;
  if (!key) return;
  event.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(() => {}));
});
