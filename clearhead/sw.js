/* Clearhead service worker — offline shell, push alarms, notification clicks.
   Location-agnostic: all URLs resolve relative to this script's scope. */
'use strict';

const CACHE = 'clearhead-v3';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-mask-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('clearhead-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  if (new URL(req.url).pathname.startsWith('/api/')) return; // never cache the alarm API
  if (req.mode === 'navigate') {
    // Fresh app when online, cached shell in a bar with no signal.
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(CACHE);
        c.put('./', net.clone()).catch(() => undefined);
        return net;
      } catch {
        return (await caches.match('./')) || (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const net = await fetch(req);
    if (net.ok) {
      const c = await caches.open(CACHE);
      c.put(req, net.clone()).catch(() => undefined);
    }
    return net;
  })());
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Clearhead', {
    body: d.body || '',
    tag: d.tag || 'clearhead-alarm',
    renotify: true,
    requireInteraction: !!d.urgent,
    vibrate: d.urgent ? [400, 150, 400, 150, 700, 200, 700] : [300, 120, 300, 120, 500],
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: d.url || './#focus' },
    // quick buttons on the notification itself (Android; iOS ignores them)
    actions: [{ action: 'water', title: '💧 Logged water' }, { action: 'focus', title: '⏱ Timer' }],
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const act = e.action || '';
  let url = (e.notification.data && e.notification.data.url) || './#focus';
  if (act === 'water') url = './#act=water';
  else if (act === 'drink') url = './#act=drink';
  else if (act === 'focus') url = './#focus';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
        // app already open: hand it the action instead of reloading it
        if (act) c.postMessage({ act });
        else c.postMessage({ act: 'focus' });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
