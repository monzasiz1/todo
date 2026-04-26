import { create } from 'zustand';
import { api } from '../utils/api';

const NOTIF_CACHE_KEY = 'taski_notifications_cache_v1';

function readNotifCache() {
  try {
    const raw = localStorage.getItem(NOTIF_CACHE_KEY);
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
    localStorage.setItem(NOTIF_CACHE_KEY, JSON.stringify({
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

const notifCached = readNotifCache();

const useNotificationStore = create((set, get) => ({
  ...(notifCached || {}),
  permission: typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  subscribed: notifCached?.subscribed ?? false,
  notifications: notifCached?.notifications ?? [],
  loading: false,
  lastSeenAt: getLastSeenAt(),
  prefs: notifCached?.prefs ?? { reminder: true, daily_tasks: true, engagement: true, team_task: true, group_message: true },

  // Mark all current notifications as seen
  markAsSeen: () => {
    const now = Date.now();
    set({ lastSeenAt: now });
    try { localStorage.setItem('notif_last_seen', String(now)); } catch {}
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

      // Auto-resubscribe: if browser already has permission + subscription exists in browser
      // but not in DB (e.g. after server DB reset or subscription row deleted)
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.ready;
          const existingSub = await reg.pushManager.getSubscription();

          if (existingSub && !data?.subscribed) {
            // Re-register with server
            const subJSON = existingSub.toJSON();
            if (subJSON?.endpoint && subJSON?.keys?.p256dh && subJSON?.keys?.auth) {
              await api.subscribePush({ endpoint: subJSON.endpoint, keys: subJSON.keys });
              set({ subscribed: true });
              console.log('[NotificationStore] Auto-resubscribed push to server');
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

  // Fetch notification log
  fetchLog: async () => {
    set({ loading: true });
    try {
      const data = await api.getNotificationLog({ limit: 50 });
      const newNotifications = data?.notifications || [];
      set({ notifications: newNotifications, loading: false });
      writeNotifCache({ ...notifCached, notifications: newNotifications });
    } catch (err) {
      console.warn('[NotificationStore] fetchLog failed:', err.message);
      set({ loading: false });
      // Keep existing notifications from cache
    }
  },

  // Update a single preference toggle
  updatePref: async (type, enabled) => {
    const newPrefs = { ...get().prefs, [type]: enabled };
    set({ prefs: newPrefs });
    try {
      await api.updateNotificationPrefs(newPrefs);
    } catch {
      // revert on error
      set({ prefs: { ...newPrefs, [type]: !enabled } });
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
