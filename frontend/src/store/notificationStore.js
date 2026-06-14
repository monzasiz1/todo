import { create } from 'zustand';
import { api } from '../utils/api';

const NOTIF_CACHE_KEY = 'beequ_notifications_cache_v1';

function getNotifCacheKey() {
  try {
    const token = localStorage.getItem('token') || 'anon';
    return `${NOTIF_CACHE_KEY}:${token.slice(0, 24)}`;
  } catch {
    return `${NOTIF_CACHE_KEY}:anon`;
  }
}

function readNotifCache() {
  try {
    const raw = localStorage.getItem(getNotifCacheKey());
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      subscribed: !!parsed.subscribed,
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      prefs: parsed.prefs || { reminder: true, daily_tasks: true, engagement: true, team_task: true, group_message: true },
    };
  } catch {
    return null;
  }
}

function writeNotifCache(state) {
  try {
    localStorage.setItem(getNotifCacheKey(), JSON.stringify({
      subscribed: !!state.subscribed,
      notifications: state.notifications || [],
      prefs: state.prefs || { reminder: true, daily_tasks: true, engagement: true, team_task: true, group_message: true },
    }));
  } catch {
    // ignore
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function getLastSeenAt() {
  try {
    const v = localStorage.getItem('notif_last_seen');
    return v ? parseInt(v, 10) : 0;
  } catch { return 0; }
}

// Pro-Gruppe "Chat zuletzt gelesen"-Zeitstempel (für den roten Badge am
// Chat-Icon). { [groupId]: epochMs }
const CHAT_READS_KEY = 'beequ_chat_reads_v1';
function getChatReads() {
  try {
    const raw = localStorage.getItem(CHAT_READS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

const NATIVE_PUSH_TOKEN_KEY = 'beequ_native_push_token_v1';
let nativePushHandlersInstalled = false;

function getNativePushToken() {
  try {
    return localStorage.getItem(NATIVE_PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function setNativePushToken(token) {
  try {
    if (typeof token === 'string') {
      localStorage.setItem(NATIVE_PUSH_TOKEN_KEY, token);
    }
  } catch {
    // ignore
  }
}

function clearNativePushToken() {
  try {
    localStorage.removeItem(NATIVE_PUSH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

function isNativeCapacitorApp() {
  if (typeof window === 'undefined' || !window.Capacitor) return false;
  const platform = typeof window.Capacitor.getPlatform === 'function'
    ? window.Capacitor.getPlatform()
    : null;
  return platform === 'android' || platform === 'ios' || window.Capacitor.isNativePlatform?.();
}

async function registerNativePush(set) {
  if (!isNativeCapacitorApp()) return false;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    set({ nativePushError: null });
    const permission = await PushNotifications.requestPermissions();
    if (permission?.receive !== 'granted') {
      set({ nativePushError: 'Berechtigung verweigert (receive=' + (permission?.receive || '?') + ')' });
      return false;
    }

    if (!nativePushHandlersInstalled) {
      nativePushHandlersInstalled = true;

      PushNotifications.addListener('registration', async (tokenInfo) => {
        const token = tokenInfo?.value || tokenInfo?.token || null;
        if (!token) return;

        setNativePushToken(token);
        set({ subscribed: true, nativePushToken: token, nativePushError: null });

        try {
          await api.subscribePush({ platform: window.Capacitor.getPlatform(), token, device_info: navigator.userAgent });
          console.log('[NotificationStore] Native push token registered with backend');
        } catch (err) {
          console.error('[NotificationStore] Native push registration failed:', err);
          try { set({ nativePushError: 'Backend: ' + (err?.message || String(err)) }); } catch { /* ignore */ }
        }
      });

      PushNotifications.addListener('registrationError', (error) => {
        console.error('[NotificationStore] Native push registration error:', error);
        try {
          set({ nativePushError: String((error && (error.error || error.message)) || JSON.stringify(error)) });
        } catch { /* ignore */ }
      });

      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('[NotificationStore] Native push received:', notification);
      });

      PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
        console.log('[NotificationStore] Native push action performed:', event);
      });
    }

    await PushNotifications.register();
    return true;
  } catch (err) {
    console.error('[NotificationStore] registerNativePush error:', err);
    try { set({ nativePushError: 'register(): ' + (err?.message || String(err)) }); } catch { /* ignore */ }
    return false;
  }
}

const notifCached = readNotifCache();

const useNotificationStore = create((set, get) => ({
  ...(notifCached || {}),
  permission: typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  nativePushToken: getNativePushToken(),
  nativePushError: null,
  subscribed: notifCached?.subscribed ?? false,
  notifications: notifCached?.notifications ?? [],
  loading: false,
  lastSeenAt: getLastSeenAt(),
  chatReads: getChatReads(),
  prefs: notifCached?.prefs ?? { reminder: true, daily_tasks: true, engagement: true, team_task: true, group_message: true },

  // Mark all current notifications as seen
  markAsSeen: () => {
    const now = Date.now();
    set({ lastSeenAt: now });
    try { localStorage.setItem('notif_last_seen', String(now)); } catch {}
  },

  // Chat einer Gruppe als gelesen markieren (beim Öffnen des Chats).
  markChatRead: (groupId) => {
    if (groupId == null) return;
    const next = { ...get().chatReads, [String(groupId)]: Date.now() };
    set({ chatReads: next });
    try { localStorage.setItem(CHAT_READS_KEY, JSON.stringify(next)); } catch {}
  },

  // Gibt es ungelesene Chat-Nachrichten? Basis: group_message-Benachrichtigungen
  // (haben group_id + sent_at), die neuer sind als der zuletzt-gelesen-Stempel
  // der jeweiligen Gruppe.
  hasUnreadChat: () => {
    const { notifications, chatReads } = get();
    return (notifications || []).some((n) => {
      if (n.type !== 'group_message') return false;
      const readAt = chatReads[String(n.group_id)] || 0;
      return new Date(n.sent_at).getTime() > readAt;
    });
  },

  // Get only unseen notifications
  getUnseenNotifications: () => {
    const { notifications, lastSeenAt } = get();
    return notifications.filter((n) => new Date(n.sent_at).getTime() > lastSeenAt);
  },

  // Add a local notification (shown immediately in bell)
  addLocalNotification: (notification) => {
    const entry = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: notification.type || 'reminder',
      title: notification.title,
      body: notification.body,
      task_id: notification.task_id || null,
      sent_at: new Date().toISOString(),
    };
    set((s) => ({
      notifications: [entry, ...s.notifications].slice(0, 50),
    }));
  },

  // Check current subscription status + load preferences + auto-resubscribe if needed
  checkStatus: async () => {
    try {
      const data = await api.getNotificationStatus();
      set({
        subscribed: data?.subscribed || false,
        prefs: data?.prefs || { reminder: true, daily_tasks: true, engagement: true, team_task: true, group_message: true },
      });

      if (isNativeCapacitorApp()) {
        if (getNativePushToken()) {
          set({ subscribed: true });
        }
        return;
      }

      // Rebind existing browser subscription to current account.
      // This prevents cross-account push delivery on shared devices.
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.ready;
          const existingSub = await reg.pushManager.getSubscription();

          if (existingSub) {
            // Re-register with server (idempotent): also re-owns endpoint for current user.
            const subJSON = existingSub.toJSON();
            if (subJSON?.endpoint && subJSON?.keys?.p256dh && subJSON?.keys?.auth) {
              await api.subscribePush({ endpoint: subJSON.endpoint, keys: subJSON.keys });
              if (!data?.subscribed) set({ subscribed: true });
              console.log('[NotificationStore] Push subscription rebound to current user');
            }
          }
        } catch {
          // Ignore - subscribe button in UI handles this
        }
      }
    } catch {
      // ignore
    }
  },

  // Request permission + subscribe to push
  subscribe: async () => {
    if (isNativeCapacitorApp()) {
      const result = await registerNativePush(set);
      return result;
    }

    if (typeof Notification === 'undefined') return false;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    if (!window.isSecureContext) return false;

    // Request permission only if needed
    const currentPerm = Notification.permission;
    const perm = currentPerm === 'granted' ? 'granted' : await Notification.requestPermission();
    set({ permission: perm });
    if (perm !== 'granted') return false;

    try {
      // Get SW registration
      const reg = await navigator.serviceWorker.ready;

      // Get VAPID public key
      const { publicKey } = await api.getVapidKey();
      if (!publicKey) return false;

      // Reuse existing subscription when present (common on mobile/PWA)
      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const subJSON = subscription.toJSON();
      if (!subJSON?.endpoint || !subJSON?.keys?.p256dh || !subJSON?.keys?.auth) {
        return false;
      }

      // Send to backend
      await api.subscribePush({
        endpoint: subJSON.endpoint,
        keys: subJSON.keys,
      });

      set({ subscribed: true });
      return true;
    } catch (err) {
      console.error('Push subscribe error:', err);
      return false;
    }
  },

  // Unsubscribe from push
  unsubscribe: async () => {
    try {
      if (isNativeCapacitorApp()) {
        const token = getNativePushToken();
        if (token) {
          await api.unsubscribePush({ platform: window.Capacitor.getPlatform(), token });
          clearNativePushToken();
        }
        set({ subscribed: false, nativePushToken: null });
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();

      if (subscription) {
        await api.unsubscribePush({ endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }

      set({ subscribed: false });
    } catch (err) {
      console.error('Push unsubscribe error:', err);
    }
  },

  // Fetch notification log.
  // `silent=true` unterdrueckt das `loading`-Flag — wichtig fuer Hintergrund-
  // Polling, damit der Bell-Button nicht alle 8-15s einen Loading-Render
  // ausloest und damit das offene Panel nicht im Skeleton flackert.
  fetchLog: async ({ silent = false } = {}) => {
    if (!silent) set({ loading: true });
    try {
      const data = await api.getNotificationLog({ limit: 50 });
      const newNotifications = data?.notifications || [];
      // Nur setzen, wenn sich etwas geaendert hat — vermeidet unnoetige Renders.
      const prev = get().notifications || [];
      const changed = prev.length !== newNotifications.length
        || prev.some((n, i) => n?.id !== newNotifications[i]?.id || n?.seen !== newNotifications[i]?.seen);
      if (changed) {
        set({ notifications: newNotifications, loading: false });
        writeNotifCache({ ...notifCached, notifications: newNotifications });
      } else if (!silent) {
        set({ loading: false });
      }
    } catch (err) {
      console.warn('[NotificationStore] fetchLog failed:', err.message);
      if (!silent) set({ loading: false });
      // Keep existing notifications from cache
    }
  },

  // Update a single preference toggle
  updatePref: async (type, enabled) => {
    const prevPrefs = { ...get().prefs };
    const newPrefs = { ...prevPrefs, [type]: enabled };
    set({ prefs: newPrefs });
    try {
      await api.updateNotificationPrefs(newPrefs);
    } catch {
      // Rollback auf den exakten vorherigen Stand — verliert keine
      // Aenderungen aus parallelen Updates (z. B. anderer Tab).
      set({ prefs: prevPrefs });
    }
  },

  // Update multiple preference keys with one request
  updatePrefsBatch: async (updates) => {
    const prevPrefs = { ...get().prefs };
    const newPrefs = { ...prevPrefs, ...(updates || {}) };
    set({ prefs: newPrefs });
    try {
      await api.updateNotificationPrefs(newPrefs);
    } catch {
      set({ prefs: prevPrefs });
    }
  },

  // Delete one notification entry from bell
  deleteNotification: async (id) => {
    if (!id) return false;
    const prev = get().notifications || [];
    set({ notifications: prev.filter((n) => String(n.id) !== String(id)) });

    // Local-only entries are already removed in-memory
    if (String(id).startsWith('local-')) return true;

    try {
      await api.deleteNotificationLogEntry(id);
      return true;
    } catch {
      set({ notifications: prev });
      return false;
    }
  },

  // Delete all notifications from bell (server + local)
  clearAllNotifications: async () => {
    const prev = get().notifications || [];
    set({ notifications: [] });
    try {
      await api.clearNotificationLog();
      return true;
    } catch {
      set({ notifications: prev });
      return false;
    }
  },
}));

export { useNotificationStore };

useNotificationStore.subscribe((state) => {
  writeNotifCache(state);
});

