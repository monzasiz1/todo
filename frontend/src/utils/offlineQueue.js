/**
 * Offline Queue – speichert fehlgeschlagene API-Mutationen in IndexedDB
 * und replayed sie sobald die App wieder online ist.
 *
 * Unterstützte Operationen: createTask, updateTask, deleteTask, toggleTask
 */

const DB_NAME = 'beequ-offline';
const DB_VERSION = 1;
const STORE_NAME = 'queue';

function openDB() {
  return new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    } catch (err) {
      reject(err);
    }
  });
}

// Wrapper: silently resolves with fallback when IDB is unavailable
async function safeIDB(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Einen neuen Request in die Queue einreihen */
export async function enqueueRequest({ method, endpoint, body, tempId }) {
  return safeIDB(async () => {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.add({
        method,
        endpoint,
        body,
        tempId: tempId ?? null,
        createdAt: Date.now(),
        retries: 0,
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }, null);
}

/** Alle Einträge in Reihenfolge lesen */
export async function getAllQueued() {
  return safeIDB(async () => {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.index('createdAt').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }, []);
}

/** Alte/falsche Auth-Queue Einträge entfernen (z.B. frühere Offline-Login Versuche) */
export async function purgeAuthQueueEntries() {
  const entries = await getAllQueued();
  const authEntries = entries.filter((e) => String(e.endpoint || '').startsWith('/auth/'));
  if (authEntries.length === 0) return 0;

  await Promise.all(authEntries.map((e) => removeQueued(e.id)));
  return authEntries.length;
}

/** Eintrag nach erfolgreichem Replay löschen */
export async function removeQueued(id) {
  return safeIDB(async () => {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  });
}

/** Retry-Zähler erhöhen (max 5 Versuche, danach verwerfen) */
export async function incrementRetry(id) {
  return safeIDB(async () => {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const entry = getReq.result;
        if (!entry) return resolve(false);
        entry.retries = (entry.retries || 0) + 1;
        if (entry.retries >= 5) {
          store.delete(id);
          resolve(false);
        } else {
          store.put(entry);
          resolve(true);
        }
      };
      getReq.onerror = () => resolve(false);
    });
  }, false);
}

/** Anzahl wartender Requests */
export async function getQueueCount() {
  const entries = await getAllQueued();
  return entries.filter((e) => !String(e.endpoint || '').startsWith('/auth/')).length;
}

