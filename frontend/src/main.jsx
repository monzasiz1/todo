import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import './styles/theme-dark.css';
import './styles/whiteboard.css';
import './styles/platform-android.css';
import { initTheme } from './utils/theme';
import { purgeAuthQueueEntries } from './utils/offlineQueue';
import { installChunkErrorRecovery } from './utils/recover';

// Auto-Wiederherstellung bei veralteten Chunks/Cache (weiße Seite nach Deploy).
installChunkErrorRecovery();

// Theme so früh wie möglich anwenden, um FOUC (Flash of Unstyled Theme) zu vermeiden.
initTheme();

// Plattform-Detection so frueh wie moeglich (vor dem ersten Render),
// damit Android-spezifische CSS-Overrides (kein backdrop-filter, solide
// Surfaces statt rgba+blur) sofort greifen und das UI nicht erst grau
// rendert und dann umspringt.
//
// Mehrere Detection-Methoden, weil:
//  - UA kann auf "Desktop-Modus" stehen (Chrome on Android Toggle)
//  - userAgentData ist robuster aber nicht ueberall verfuegbar
//  - manuelle ?platform=android URL-Param fuers Debugging
try {
  if (typeof navigator !== 'undefined') {
    const root = document.documentElement;
    const ua = navigator.userAgent || '';
    const params = new URLSearchParams(window.location.search);
    const forced = params.get('platform'); // 'android' | 'ios' | 'desktop'

    // iOS-Detection (UA + iPadOS-Quirk: iPad meldet sich als Mac mit Touch)
    const isIOSUA = /iphone|ipad|ipod/i.test(ua);
    const isIPadOS = /Macintosh/.test(ua)
      && typeof navigator.maxTouchPoints === 'number'
      && navigator.maxTouchPoints > 1;
    const isIOS = isIOSUA || isIPadOS;

    // Android-Detection: UA, userAgentData, oder "nicht iOS aber Touch
    // auf kleinem Screen" als Fallback fuer Edge-Cases.
    const isAndroidUA = /android/i.test(ua);
    const isAndroidUAData = navigator.userAgentData?.platform === 'Android';
    const isMobileTouch = !isIOS
      && typeof navigator.maxTouchPoints === 'number'
      && navigator.maxTouchPoints > 0
      && window.matchMedia('(max-width: 1024px)').matches;
    const isAndroid = isAndroidUA || isAndroidUAData || (isMobileTouch && !isIOS);

    if (forced === 'android') {
      root.classList.add('is-android');
    } else if (forced === 'ios') {
      root.classList.add('is-ios');
    } else {
      if (isIOS) root.classList.add('is-ios');
      if (isAndroid) root.classList.add('is-android');
    }
  }
} catch {}

// Markiere Body als Electron-Desktop-App, damit CSS den Platz fuer die
// Custom-Titlebar reservieren kann und Plattform-spezifische Anpassungen
// (z.B. native macOS-Traffic-Lights) greifen.
try {
  if (typeof window !== 'undefined' && window.electronApp) {
    document.body.classList.add('is-electron');
    const plat = window.electronApp.platform;
    if (plat === 'darwin') document.body.classList.add('is-mac');
    else if (plat === 'win32') document.body.classList.add('is-win');
    else document.body.classList.add('is-linux');
  }
} catch {}

// ── Silence known harmless rejections from browser internals & extensions ──
// These come from CacheStorage glitches (private mode, quota) or third-party
// extensions (MetaMask, reload helpers) and have no impact on the app.
const NOISE_PATTERNS = [
  /Failed to execute 'open' on 'CacheStorage'/i,
  /Failed to connect to MetaMask/i,
  /MetaMask extension not found/i,
  /Could not establish connection\. Receiving end does not exist/i,
  /Internal error/i,
];

window.addEventListener('unhandledrejection', (event) => {
  const msg = String(event?.reason?.message || event?.reason || '');
  if (NOISE_PATTERNS.some((re) => re.test(msg))) {
    event.preventDefault();
  }
});

window.addEventListener('error', (event) => {
  const msg = String(event?.message || event?.error?.message || '');
  if (NOISE_PATTERNS.some((re) => re.test(msg))) {
    event.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
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

