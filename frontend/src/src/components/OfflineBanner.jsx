import { useState, useEffect, useMemo } from 'react';
import { WifiOff, X } from 'lucide-react';
import { getQueueCount } from '../utils/offlineQueue';

/**
 * Zeigt oben einen diskreten Banner wenn die App offline ist.
 * Zeigt zusätzlich die Anzahl der wartenden Offline-Änderungen an.
 */
export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [queueCount, setQueueCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const isStandalone = useMemo(() => {
    const byMedia = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    const byIOS = window.navigator.standalone === true;
    return byMedia || byIOS;
  }, []);

  useEffect(() => {
    const onOffline = () => setIsOffline(true);
    const onOnline = () => {
      setIsOffline(false);
      setDismissed(false);
      // Queue-Count kurz noch anzeigen bis Sync fertig
      setTimeout(() => setQueueCount(0), 4000);
    };

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  // Queue-Count aktuell halten wenn offline
  useEffect(() => {
    if (!isOffline) return;
    const update = async () => {
      const count = await getQueueCount();
      setQueueCount(count);
    };
    update();
    const interval = setInterval(update, 3000);
    return () => clearInterval(interval);
  }, [isOffline]);

  if (!isStandalone || !isOffline || dismissed) return null;

  return (
    <div className="offline-banner">
      <div className="offline-banner-content">
        <WifiOff size={14} />
        <span>
          Kein Internet – Änderungen werden lokal gespeichert
          {queueCount > 0 && ` (${queueCount} wartend)`}
        </span>
      </div>
      <button
        type="button"
        className="offline-banner-close"
        aria-label="Hinweis schließen"
        onClick={() => setDismissed(true)}
      >
        <X size={14} />
      </button>
    </div>
  );
}
