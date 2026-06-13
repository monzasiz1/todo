// Wiederherstellung aus kaputtem Cache-/Chunk-Zustand.
//
// Symptom: Nach einem Deploy ändern sich die gehashten JS-Chunk-Dateinamen.
// Der Service Worker liefert die App aber cache-first — die alte index.html/
// alte Module verweisen dann auf nicht mehr existierende Chunks. Der dynamische
// Import schlägt fehl → weiße Seite, die bleibt, bis der Cache erneuert wird.
//
// Erkennung + einmaliger, harter Reload (Caches + Service Worker geleert) lösen
// das automatisch, ohne dass der Nutzer die App neu installieren muss.

const CHUNK_ERROR_PATTERNS = [
  /Loading chunk [\w-]+ failed/i,
  /Loading CSS chunk/i,
  /ChunkLoadError/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /'text\/html' is not a valid JavaScript MIME type/i,
  /Unexpected token '<'/i, // index.html (HTML) statt JS-Modul ausgeliefert
];

export function isChunkLoadError(err) {
  const msg = String(err?.message || err?.reason?.message || err?.reason || err || '');
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(msg));
}

// Caches + Service Worker leeren und EINMALIG neu laden. Mehrfach-Schutz über
// einen kurzen Zeitstempel, damit keine Reload-Schleife entsteht, falls der
// Fehler doch bestehen bleibt.
export async function recoverFromBrokenCache(reason = 'unknown') {
  try {
    const last = Number(sessionStorage.getItem('bq:recoverTs') || 0);
    if (Date.now() - last < 20000) return; // kürzlich schon versucht → keine Schleife
    sessionStorage.setItem('bq:recoverTs', String(Date.now()));
  } catch { /* sessionStorage evtl. blockiert → trotzdem versuchen */ }

  // eslint-disable-next-line no-console
  console.warn('[recover] Cache-/Chunk-Problem erkannt, setze App zurück:', reason);

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* ignore */ }

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch { /* ignore */ }

  // Cache-bustender Reload (replace → kein Eintrag in der History).
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('_r', String(Date.now()));
    window.location.replace(u.toString());
  } catch {
    window.location.reload();
  }
}

// Globale Listener für Chunk-Lade-Fehler registrieren (vor dem ersten Render).
export function installChunkErrorRecovery() {
  // Vite feuert dieses Event, wenn ein dynamischer Import fehlschlägt.
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault?.();
    recoverFromBrokenCache('vite:preloadError');
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event?.reason)) {
      event.preventDefault?.();
      recoverFromBrokenCache('unhandledrejection');
    }
  });

  window.addEventListener('error', (event) => {
    if (isChunkLoadError(event)) {
      recoverFromBrokenCache('error');
    }
  });
}
