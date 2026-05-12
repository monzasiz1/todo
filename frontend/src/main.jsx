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

      // Send auth token to SW so it can make authenticated background requests
      const sendTokenToSW = () => {
        const token = localStorage.getItem('token');
        const sw = reg.active || reg.installing || reg.waiting;
        if (sw && token) {
          sw.postMessage({ type: 'SET_AUTH_TOKEN', token });
        } else if (token && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'SET_AUTH_TOKEN', token });
        }
      };

      // Send immediately + wait for SW activation
      sendTokenToSW();
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') sendTokenToSW();
          });
        }
      });

      // Background Sync registrieren wenn unterstützt
      if ('SyncManager' in window) {
        reg.sync.register('beequ-offline-sync').catch(() => {});
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

  // After login, send token to SW
  window.addEventListener('beequ:token-updated', () => {
    const token = localStorage.getItem('token');
    if (token && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SET_AUTH_TOKEN', token });
    }
  });

  // Fallback: window online Event (für Browser ohne Background Sync)
  window.addEventListener('online', () => {
    import('./store/taskStore').then(({ useTaskStore }) => {
      useTaskStore.getState().syncOfflineQueue();
    });
  });
}

