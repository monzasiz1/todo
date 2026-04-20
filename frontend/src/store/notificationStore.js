import { create } from 'zustand';
import { api } from '../utils/api';

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

const useNotificationStore = create((set, get) => ({
  permission: typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  subscribed: false,
  notifications: [],
  loading: false,
  lastSeenAt: getLastSeenAt(),
  prefs: { reminder: true, daily_tasks: true, engagement: true, team_task: true },

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

  // Check current subscription status + load preferences
  checkStatus: async () => {
    try {
      const data = await api.getNotificationStatus();
      set({
        subscribed: data?.subscribed || false,
        prefs: data?.prefs || { reminder: true, daily_tasks: true, engagement: true, team_task: true },
      });
    } catch {
      // ignore
    }
  },

  // Request permission + subscribe to push
  subscribe: async () => {
    if (typeof Notification === 'undefined') return false;

    // Request permission
    const perm = await Notification.requestPermission();
    set({ permission: perm });
    if (perm !== 'granted') return false;

    try {
      // Get SW registration
      const reg = await navigator.serviceWorker.ready;

      // Get VAPID public key
      const { publicKey } = await api.getVapidKey();
      if (!publicKey) return false;

      // Subscribe to push
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const subJSON = subscription.toJSON();

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
      const data = await api.getNotificationLog();
      set({ notifications: data?.notifications || [] });
    } catch {
      // ignore
    } finally {
      set({ loading: false });
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
}));

export { useNotificationStore };
