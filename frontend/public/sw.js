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

// ─── Auth Token Storage (IndexedDB) ───────────────────────────────────────
// SW doesn't have localStorage, so we use IndexedDB to persist the auth token.
// The app sends the token via postMessage whenever it changes.

const IDB_NAME = 'taski-sw-store';
const IDB_STORE = 'auth';

function openAuthIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveAuthToken(token) {
  try {
    const db = await openAuthIDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(token, 'token');
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    console.error('[SW] saveAuthToken failed:', e);
  }
}

async function getAuthToken() {
  try {
    const db = await openAuthIDB();
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get('token');
    return new Promise((res) => {
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

// ─── Push Notifications ───
self.addEventListener('push', (event) => {
  console.log('Push event received:', event.data ? 'with data' : 'no data');
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Taski', body: event.data.text() };
  }

  console.log('Showing push notification:', data.title, data.body);
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

// ─── Message Handler ──────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  // App sends updated auth token whenever user logs in or token refreshes
  if (event.data?.type === 'SET_AUTH_TOKEN') {
    const token = event.data.token;
    if (token) {
      saveAuthToken(token).then(() => {
        console.log('[SW] Auth token stored in IDB');
      });
    }
    return;
  }

  if (event.data?.type === 'CHECK_REMINDERS') {
    console.log('[SW] Received CHECK_REMINDERS request');
    event.waitUntil(checkAndShowDueReminders());
  }
});

// ─── Background Reminder Check ────────────────────────────────────────────
async function checkAndShowDueReminders() {
  try {
    const token = await getAuthToken();
    if (!token) {
      console.log('[SW] No auth token in IDB, skipping reminder check');
      return;
    }

    const response = await fetch('/api/tasks/reminders/due', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.log('[SW] Reminder check failed:', response.status);
      return;
    }

    const data = await response.json();
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    console.log(`[SW] Background check found ${tasks.length} due reminders`);

    for (const task of tasks) {
      if (!task.reminder_at || task.completed) continue;

      const reminderTime = new Date(task.reminder_at).getTime();
      const now = Date.now();

      // Show if within 20 min after due time
      if (reminderTime <= now && reminderTime > now - 20 * 60 * 1000) {
        const title = '⏰ Erinnerung';
        const body = `${task.title}${task.time ? ' um ' + task.time.slice(0, 5) : ''}`;
        const tag = `reminder-${task.id}`;

        await self.registration.showNotification(title, {
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag,
          renotify: false,
          vibrate: [200, 100, 200],
          data: { url: '/calendar', taskId: task.id },
          actions: [
            { action: 'open', title: 'Öffnen' },
            { action: 'dismiss', title: 'OK' },
          ],
        });

        // Persist to server log so this reminder is not returned again
        await fetch('/api/notifications/log', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'reminder',
            task_id: task.id,
            title,
            body,
          }),
        }).catch(() => null);

        console.log('[SW] Background reminder shown:', tag);
      }
    }
  } catch (err) {
    console.log('[SW] Background reminder check error:', err.message);
  }
}

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
