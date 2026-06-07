import { create } from 'zustand';
import { api, clearApiCacheForCurrentUser } from '../utils/api';

const TASK_CACHE_KEY = 'beequ_tasks_cache_v1';
const GROUP_CACHE_KEY = 'beequ_groups_cache_v1';
const FRIENDS_CACHE_KEY = 'beequ_friends_cache_v1';
const NOTIF_CACHE_KEY = 'beequ_notifications_cache_v1';
const PROFILE_CACHE_KEY = 'beequ_profile_cache_v1';

async function detachCurrentPushSubscription(tokenOverride = null) {
  try {
    const token = tokenOverride || localStorage.getItem('token');
    if (!token) return;

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription?.endpoint) {
        await fetch('/api/notifications/subscribe', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => {});

        await subscription.unsubscribe().catch(() => {});
      }
    }

    if (typeof window !== 'undefined' && window.Capacitor) {
      const nativeToken = localStorage.getItem('beequ_native_push_token_v1');
      if (nativeToken) {
        await fetch('/api/notifications/subscribe', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ platform: window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'android', token: nativeToken }),
        }).catch(() => {});
        localStorage.removeItem('beequ_native_push_token_v1');
      }
    }
  } catch {
    // Best-effort cleanup only.
  }
}

function rebindPushForCurrentUser() {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    import('./notificationStore')
      .then(({ useNotificationStore }) => {
        useNotificationStore.getState().subscribe().catch(() => {});
      })
      .catch(() => {});
  } catch {
    // no-op
  }
}

function clearLocalAppCaches() {
  try {
    // Aktueller User-Token für spezifische Keys
    const token = localStorage.getItem('token');
    const userScope = token ? token.slice(0, 24) : null;
    
    // Alle Keys durchlaufen und user-spezifische löschen
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key) continue;
      
      // User-spezifische Cache-Keys löschen
      if (userScope && key.includes(`:${userScope}`)) {
        localStorage.removeItem(key);
      }
      
      // Legacy statische Keys auch löschen (falls noch vorhanden)
      if (key === TASK_CACHE_KEY || 
          key === GROUP_CACHE_KEY || 
          key === FRIENDS_CACHE_KEY || 
          key === NOTIF_CACHE_KEY || 
          key === PROFILE_CACHE_KEY ||
          key.startsWith('beequ_calendar_') ||
          key.startsWith('beequ_notes_cache_v1:') ||
          key.startsWith('beequ_tasks_cache_v1:') ||
          key.startsWith('beequ_groups_cache_v1:') ||
          key.startsWith('beequ_notifications_cache_v1:') ||
          key.startsWith('beequ_friends_cache_v1:')) {
        localStorage.removeItem(key);
      }
    }
    
    // SessionStorage ebenfalls bereinigen
    if (typeof sessionStorage !== 'undefined') {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (!key) continue;

        if ((userScope && key.includes(`:${userScope}`)) ||
            key.startsWith('beequ_tasks_range_cache_v1:')) {
          sessionStorage.removeItem(key);
        }
      }
    }

    // Native push token cleanup for Capacitor environments.
    try {
      localStorage.removeItem('beequ_native_push_token_v1');
    } catch {
      // ignore
    }
  } catch {
    // Fallback: Original Keys löschen
    localStorage.removeItem(TASK_CACHE_KEY);
    localStorage.removeItem(GROUP_CACHE_KEY);
    localStorage.removeItem(FRIENDS_CACHE_KEY);
    localStorage.removeItem(NOTIF_CACHE_KEY);
    localStorage.removeItem(PROFILE_CACHE_KEY);
  }
}

export const useAuthStore = create((set) => ({
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  token: localStorage.getItem('token') || null,
  loading: false,
  error: null,

  login: async (email, password, twofa_code) => {
    set({ loading: true, error: null });
    try {
      // Prevent old device subscription from remaining attached to another account.
      await detachCurrentPushSubscription();

      // WICHTIG: Beim Login alle alten Daten löschen
      clearApiCacheForCurrentUser();
      clearLocalAppCaches();
      
      const body = { email, password };
      // twofa_code explizit prüfen, auch "000000" muss gesendet werden
      if (typeof twofa_code !== 'undefined') body.twofa_code = twofa_code;
      const data = await api.login(email, password, twofa_code);
      if (data.requires2FA) {
        set({ loading: false });
        return { requires2FA: true };
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      set({ user: data.user, token: data.token, loading: false });
      window.dispatchEvent(new Event('beequ:token-updated'));
      rebindPushForCurrentUser();
      return true;
    } catch (err) {
      set({ error: err.message, loading: false });
      return false;
    }
  },
  refreshUser: async () => {
    try {
      const data = await api.getMe();
      if (data?.user) {
        localStorage.setItem('user', JSON.stringify(data.user));
        set({ user: data.user });
      }
    } catch {
      // Stille Aktualisierung — kein Logout bei Fehlern
    }
  },

  register: async (name, email, password) => {
    set({ loading: true, error: null });
    try {
      // Prevent old device subscription from remaining attached to another account.
      await detachCurrentPushSubscription();

      // WICHTIG: Beim Register alle alten Daten löschen
      clearApiCacheForCurrentUser();
      clearLocalAppCaches();
      
      const data = await api.register(name, email, password);
      if (data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        set({ user: data.user, token: data.token, loading: false });
        window.dispatchEvent(new Event('beequ:token-updated'));
        rebindPushForCurrentUser();
        return { success: true };
      } else {
        // Token und User explizit entfernen, falls noch vorhanden
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        set({ user: null, token: null, loading: false });
        return { success: false, message: data.message || 'Bitte gib den Verifizierungscode ein.' };
      }
    } catch (err) {
      set({ error: err.message, loading: false });
      return { success: false, error: err.message };
    }
  },

  verifyCode: async (email, code) => {
    set({ loading: true, error: null });
    try {
      // Prevent old device subscription from remaining attached to another account.
      await detachCurrentPushSubscription();

      // WICHTIG: Bei Code-Verifizierung alle alten Daten löschen
      clearApiCacheForCurrentUser();
      clearLocalAppCaches();
      
      const data = await api.verifyCode(email, code);
      if (data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        set({ user: data.user, token: data.token, loading: false });
        window.dispatchEvent(new Event('beequ:token-updated'));
        rebindPushForCurrentUser();
        return { success: true };
      }
      set({ loading: false });
      return { success: false, error: data.error || 'Verifizierung fehlgeschlagen' };
    } catch (err) {
      set({ loading: false, error: err.message });
      return { success: false, error: err.message };
    }
  },

  resendCode: async (email) => {
    set({ loading: true, error: null });
    try {
      const data = await api.resendCode(email);
      set({ loading: false });
      return { success: true, message: data.message || 'Neuer Code wurde gesendet.' };
    } catch (err) {
      set({ loading: false, error: err.message });
      return { success: false, error: err.message };
    }
  },

  checkAuth: async () => {
    try {
      const data = await api.getMe();
      set({ user: data.user, error: null });
    } catch (err) {
      // Nur bei echter 401 Session löschen. Bei Offline/Netzwerkfehler Session behalten.
      if (err?.status === 401 || err?.message === 'Nicht autorisiert') {
        clearApiCacheForCurrentUser();
        set({ user: null, token: null });
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        clearLocalAppCaches();
        return;
      }

      set({ error: 'Offline-Modus aktiv. Du bleibst eingeloggt.' });
    }
  },

  logout: () => {
    // Best-effort detach before token is removed.
    const tokenBeforeLogout = localStorage.getItem('token');
    detachCurrentPushSubscription(tokenBeforeLogout);

    clearApiCacheForCurrentUser();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    clearLocalAppCaches();
    set({ user: null, token: null });
    const isPwa = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    const isElectron = typeof window !== 'undefined' && !!window.electronApp;
    const isCapacitor = typeof window !== 'undefined'
      && !!window.Capacitor
      && (typeof window.Capacitor.isNativePlatform !== 'function'
        || window.Capacitor.isNativePlatform());
    window.location.href = (isPwa || isElectron || isCapacitor) ? '/app/login' : '/';
  },

  // setUser MERGEt in den bestehenden User statt ihn komplett zu ersetzen.
  // Grund: Profil-Updates (Name/Bio/Farbe/Avatar) liefern ein User-Objekt OHNE
  // das `plan`-Feld zurueck. Ein voller Replace wuerde `plan` loeschen -> die App
  // faellt auf 'free' zurueck bis zum naechsten Reload. Login/Register setzen den
  // User direkt ueber set({ user }), nicht ueber setUser, sind also nicht betroffen.
  setUser: (partial) => set((state) => {
    const merged = state.user ? { ...state.user, ...partial } : partial;
    try { localStorage.setItem('user', JSON.stringify(merged)); } catch { /* ignore */ }
    return { user: merged };
  }),

  clearError: () => set({ error: null }),
}));

