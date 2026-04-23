import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { purgeAuthQueueEntries } from './utils/offlineQueue';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Einmalige Bereinigung alter Auth-Queue-Einträge
purgeAuthQueueEntries().catch(() => {});

// Service Worker Registration + Offline-Sync
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('SW registered:', reg.scope);
      reg.update();

      // Background Sync registrieren wenn unterstützt
      if ('SyncManager' in window) {
        reg.sync.register('taski-offline-sync').catch(() => {});
      }
    }).catch((err) => {
      console.log('SW registration failed:', err);
    });

    // SW → App Nachricht: Queue abspielen
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'OFFLINE_SYNC_READY') {
        import('./store/taskStore').then(({ useTaskStore }) => {
          useTaskStore.getState().syncOfflineQueue();
        });
      }
    });
  });

  // Fallback: window online Event (für Browser ohne Background Sync)
  window.addEventListener('online', () => {
    import('./store/taskStore').then(({ useTaskStore }) => {
      useTaskStore.getState().syncOfflineQueue();
    });
  });
}
