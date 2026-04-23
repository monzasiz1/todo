const CACHE_NAME = 'taski-v4';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

function offlineFallbackResponse() {
  return new Response('Offline', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function offlineHtmlResponse() {
  return new Response(
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title></head><body><h1>Offline</h1><p>Keine Verbindung. Bitte Internet aktivieren und erneut versuchen.</p></body></html>',
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  );
}

async function warmAppShell(cache) {
  try {
    const res = await fetch('/', { cache: 'no-store' });
    if (!res.ok) return;
    const html = await res.text();
    await cache.put('/', new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }));

    const assetPaths = new Set();
    const scriptRe = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
    const styleRe = /<link[^>]+href=["']([^"']+)["'][^>]*>/gi;

    let m;
    while ((m = scriptRe.exec(html)) !== null) {
      const src = m[1];
      if (src && !src.startsWith('http')) assetPaths.add(src);
    }
    while ((m = styleRe.exec(html)) !== null) {
      const href = m[1];
      if (href && !href.startsWith('http')) assetPaths.add(href);
    }

    await Promise.all(Array.from(assetPaths).map(async (path) => {
      try {
        const assetRes = await fetch(path, { cache: 'no-store' });
        if (assetRes && assetRes.status === 200) {
          await cache.put(path, assetRes.clone());
        }
      } catch {
        // ignore per-asset failures
      }
    }));
  } catch {
    // ignore shell warm-up failures (e.g. offline during install/activate)
  }
}

function offlineScriptResponse() {
  return new Response(
    "document.body.innerHTML = '<div style=\"font-family:system-ui,sans-serif;padding:24px;line-height:1.5\"><h2>Offline</h2><p>Die App-Dateien sind noch nicht vollstaendig zwischengespeichert. Bitte einmal online oeffnen und neu laden.</p></div>';",
    {
      status: 200,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    }
  );
}

function offlineStyleResponse() {
  return new Response('/* offline css fallback */', {
    status: 200,
    headers: { 'Content-Type': 'text/css; charset=utf-8' },
  });
}

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(STATIC_ASSETS);
      await warmAppShell(cache);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
      const cache = await caches.open(CACHE_NAME);
      await warmAppShell(cache);
    })
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // API requests: network only (always need fresh data)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // For navigation requests, always prefer a fresh HTML shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(async () => {
        const shell = await caches.match('/');
        return shell || offlineHtmlResponse();
      })
    );
    return;
  }

  // JS/CSS module assets: never accept an HTML fallback response.
  // If server/CDN misroutes to index.html, fail fast and fallback to cache.
  if (request.destination === 'script' || request.destination === 'style') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('text/html')) {
            throw new Error('Invalid asset response: HTML returned for script/style');
          }
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request, { ignoreSearch: true });
          if (cached) return cached;
          if (request.destination === 'script') return offlineScriptResponse();
          return offlineStyleResponse();
        })
    );
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached || offlineFallbackResponse());

      return cached || fetchPromise || offlineFallbackResponse();
    })
  );
});

// ─── Background Sync ───
// Wenn der Browser Background Sync unterstützt, wird beim Wiederherstellen
// der Verbindung ein 'sync' Event ausgelöst, das den App-Client benachrichtigt.
self.addEventListener('sync', (event) => {
  if (event.tag === 'taski-offline-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          client.postMessage({ type: 'OFFLINE_SYNC_READY' });
        }
      })
    );
  }
});

// ─── Push Notifications ───
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Taski', body: event.data.text() };
  }

  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'default',
    renotify: !!data.tag,
    data: { url: data.url || '/' },
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open', title: 'Öffnen' },
      { action: 'dismiss', title: 'OK' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Taski', options)
  );
});

// ─── Notification Click ───
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing tab if open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new tab
      return clients.openWindow(url);
    })
  );
});
