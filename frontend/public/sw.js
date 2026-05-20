const CACHE_NAME = 'beequ-v14';
const API_CACHE_NAME = 'beequ-api-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Wird beim Build vom Vite-Plugin `beequ-sw-precache-manifest` durch eine
// JSON-Liste aller gehashten Asset-URLs ersetzt. Im Dev-Modus bleibt der
// Ausdruck stehen und liefert ein leeres Array (warmAppShell uebernimmt dann).
const PRECACHE_MANIFEST = self.__PRECACHE_MANIFEST__ || [];

// API-Pfade, die NICHT im SW-Cache landen sollen (sensible / mutierende
// Endpunkte, oder solche bei denen Frische zwingend ist).
const API_CACHE_BLOCKLIST = [
  '/auth/login',
  '/auth/register',
  '/auth/verify-code',
  '/auth/resend-code',
  '/auth/2fa',
  '/auth/realtime-token',
  '/billing',
  '/notifications/log',
  '/tasks/reminders/due',
  // Notes immer frisch: Cache fuehrte in der PWA zu veralteten Listen
  // und "Nicht autorisiert"-Eindruecken, wenn cached Antwort vom alten
  // Token kam. Network-Only ist hier wichtiger als Offline-Verhalten.
  '/notes',
];

// Max. Alter eines API-Cache-Eintrags, ab dem er beim Offline-Fallback
// noch geliefert, beim Online-Treffer aber sofort revalidiert wird.
const API_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage

function isApiCacheable(url) {
  if (!url.pathname.startsWith('/api/')) return false;
  const sub = url.pathname.slice(4); // '/auth/...'
  return !API_CACHE_BLOCKLIST.some((p) => sub.startsWith(p));
}

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

// Robustes Bulk-Precache: nutzt einzelne fetch+put pro URL und ignoriert
// Einzelfehler, damit ein einziges 404 nicht den gesamten install kippt.
async function precacheUrls(cache, urls) {
  if (!urls || !urls.length) return;
  await Promise.all(urls.map(async (url) => {
    try {
      // Bereits gecacht? Dann nichts tun (spart Bandbreite bei Reinstalls).
      const existing = await cache.match(url).catch(() => null);
      if (existing) return;
      const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
      if (res && res.status === 200) {
        await cache.put(url, res.clone());
      }
    } catch {
      // ignore (offline waehrend install, oder Asset wurde geloescht)
    }
  }));
}

// Install: cache static assets + alle gehashten Vite-Chunks
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Pflicht-Shell zuerst – darf scheitern, kippt den Install aber nicht.
      try { await cache.addAll(STATIC_ASSETS); } catch { /* einzelne fehler okay */ }
      await warmAppShell(cache);
      // Build-Manifest: ALLE Vite-Chunks (auch dynamische Imports wie
      // CalendarPage, NotesPage, ChatPage …), Icons & Fonts vorab cachen,
      // damit die App auch beim ersten Offline-Besuch funktionsfaehig ist.
      await precacheUrls(cache, PRECACHE_MANIFEST);
    }).catch(() => {})
  );
  self.skipWaiting();
});

// Activate: clean old caches + nachziehen neuer Chunks
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      const allowed = new Set([CACHE_NAME, API_CACHE_NAME]);
      await Promise.all(
        keys.filter((key) => !allowed.has(key)).map((key) => caches.delete(key).catch(() => {}))
      );
      const cache = await caches.open(CACHE_NAME);
      await warmAppShell(cache);
      // Auch beim Activate (z.B. nach App-Update) alle Chunks nachladen.
      await precacheUrls(cache, PRECACHE_MANIFEST);
    }).catch(() => {})
  );
  self.clients.claim();
});

// Fetch: cache-first shell, stale-while-revalidate APIs, cache-first assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (Mutationen laufen weiter ueber normales fetch +
  // Offline-Queue im App-Code).
  if (request.method !== 'GET') return;

  // ── API GETs: stale-while-revalidate ──
  // Cache-Treffer wird sofort zurueckgegeben (Null-Ladezeit), parallel laeuft
  // ein Network-Fetch der den Cache aktualisiert. Offline -> Cache, dann 503.
  if (url.pathname.startsWith('/api/')) {
    if (!isApiCacheable(url)) return; // sensible Endpunkte unangetastet

    event.respondWith((async () => {
      const cache = await caches.open(API_CACHE_NAME).catch(() => null);
      const cached = cache ? await cache.match(request).catch(() => null) : null;

      const networkPromise = fetch(request).then(async (response) => {
        try {
          if (response && response.status === 200 && cache) {
            const ct = response.headers.get('content-type') || '';
            if (ct.includes('application/json') || ct.includes('text/json')) {
              const clone = response.clone();
              const headers = new Headers(clone.headers);
              headers.set('sw-cached-at', String(Date.now()));
              const body = await clone.blob();
              const stamped = new Response(body, {
                status: clone.status,
                statusText: clone.statusText,
                headers,
              });
              cache.put(request, stamped).catch(() => {});
            }
          }
        } catch { /* ignore cache write errors */ }
        return response;
      }).catch(() => null);

      if (cached) {
        // Hintergrund-Update nicht awaiten -> Antwort ist sofort da.
        event.waitUntil(networkPromise);
        return cached;
      }

      const networkRes = await networkPromise;
      if (networkRes) return networkRes;

      // Offline und kein Cache -> kontrollierter 503 statt TypeError,
      // damit der App-Code sauber in den localStorage/offlineQueue-Fallback geht.
      return new Response(JSON.stringify({ error: 'offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    })());
    return;
  }

  // ── Navigation: cache-first mit Hintergrund-Revalidate ──
  // App-Shell laedt SOFORT aus dem Cache (kein FOUC, keine Ladezeit), im
  // Hintergrund wird die neueste index.html geholt und der Cache aktualisiert.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME).catch(() => null);
      const cached = cache ? await cache.match('/').catch(() => null) : null;

      const networkPromise = fetch(request, { cache: 'no-store' }).then(async (response) => {
        try {
          if (response && response.status === 200 && cache) {
            const ct = response.headers.get('content-type') || '';
            if (ct.includes('text/html')) {
              cache.put('/', response.clone()).catch(() => {});
            }
          }
        } catch { /* ignore */ }
        return response;
      }).catch(() => null);

      if (cached) {
        event.waitUntil(networkPromise);
        return cached;
      }

      const networkRes = await networkPromise;
      return networkRes || offlineHtmlResponse();
    })());
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
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request, { ignoreSearch: true }).catch(() => null);
          if (cached) return cached;
          if (request.destination === 'script') return offlineScriptResponse();
          return offlineStyleResponse();
        })
    );
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith(
    caches.match(request).catch(() => null).then((cached) => {
      const fetchPromise = fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
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
  if (event.tag === 'beequ-offline-sync') {
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

const IDB_NAME = 'beequ-sw-store';
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
    return new Promise((res) => {
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch {
    /* storage unavailable (private mode, quota, etc.) — silent */
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
    data = { title: 'BeeQu', body: event.data.text() };
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
    self.registration.showNotification(data.title || 'BeeQu', options)
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

  // Beim Logout / User-Wechsel: API-Cache leeren, damit keine Daten
  // des vorherigen Accounts an einen neuen Nutzer geliefert werden.
  if (event.data?.type === 'CLEAR_API_CACHE') {
    event.waitUntil(
      caches.delete(API_CACHE_NAME).catch(() => false).then(() => {
        console.log('[SW] API cache cleared');
      })
    );
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
            type: 'reminder_seen',
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

