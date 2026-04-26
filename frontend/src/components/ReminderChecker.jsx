import { useEffect, useRef } from 'react';
import { useTaskStore } from '../store/taskStore';
import { useNotificationStore } from '../store/notificationStore';
import { api } from '../utils/api';

const REMINDER_GRACE_MS = 6 * 60 * 60 * 1000;
const REMINDER_SEEN_KEY = 'taski_reminder_seen_v1';

function readSeenReminderMap() {
  try {
    const raw = localStorage.getItem(REMINDER_SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSeenReminderMap(map) {
  try {
    localStorage.setItem(REMINDER_SEEN_KEY, JSON.stringify(map || {}));
  } catch {
    // ignore quota/security errors
  }
}

/**
 * Client-side Reminder Checker – läuft alle 30 Sekunden,
 * prüft ob Tasks mit reminder_at fällig sind und zeigt:
 * 1. Browser-Notification (Notification API, kein Push nötig)
 * 2. In-App Toast
 * 3. Synct NotificationBell mit Server-Log
 */
export default function ReminderChecker() {
  const { addToast } = useTaskStore();
  const { fetchLog, addLocalNotification } = useNotificationStore();
  const firedRef = useRef(new Set()); // Track already-fired reminders
  const seenMapRef = useRef(readSeenReminderMap());

  const buildReminderKey = (task) => `${task.id}:${task.reminder_at || ''}`;

  // Send auth token to SW on mount (ensures SW can make authenticated requests)
  useEffect(() => {
    const sendToken = () => {
      const token = localStorage.getItem('token');
      if (token && navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SET_AUTH_TOKEN', token });
      }
    };
    sendToken();

    // Also trigger background check via SW
    if (!navigator.serviceWorker?.controller) return;
    const bgCheckInterval = setInterval(() => {
      const token = localStorage.getItem('token');
      if (token && navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SET_AUTH_TOKEN', token });
        navigator.serviceWorker.controller.postMessage({ type: 'CHECK_REMINDERS' });
      }
    }, 5 * 60 * 1000); // Every 5 minutes
    return () => clearInterval(bgCheckInterval);
  }, []);

  useEffect(() => {
    const check = async () => {
      const now = Date.now();
      let dueTasks = [];

      try {
        const response = await api.getDueReminders?.();
        dueTasks = Array.isArray(response?.tasks) ? response.tasks : [];
        if (dueTasks.length > 0) {
          console.log(`[ReminderChecker] Found ${dueTasks.length} due reminders at ${new Date().toISOString()}`);
        }
      } catch (err) {
        console.error('[ReminderChecker] API error:', err.message);
        return;
      }

      let firedAny = false;
      for (const task of dueTasks) {
        if (!task.reminder_at || task.completed) continue;
        const reminderKey = buildReminderKey(task);
        if (firedRef.current.has(reminderKey) || seenMapRef.current[reminderKey]) continue;

        const reminderTime = new Date(task.reminder_at).getTime();
        // Fire only within a bounded grace window to avoid very old reminders reappearing.
        if (reminderTime <= now && reminderTime > now - REMINDER_GRACE_MS) {
          firedRef.current.add(reminderKey);
          seenMapRef.current[reminderKey] = Date.now();
          writeSeenReminderMap(seenMapRef.current);
          firedAny = true;

          const title = '⏰ Erinnerung';
          const body = `${task.title}${task.time ? ' um ' + task.time.slice(0, 5) : ''}`;

          // 1. In-App Toast
          addToast(body, 'info');

          // 2. Add to notification bell immediately (local, instant)
          addLocalNotification({
            type: 'reminder',
            title,
            body,
            task_id: task.id,
          });

          // 2b. Persist reminder delivery to server log for cross-session dedupe
          api.createNotificationLog?.({
            type: 'reminder_seen',
            task_id: task.id,
            title,
            body,
          }).catch(() => {});

          // 3. Browser Notification (works without Push subscription)
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              new Notification(title, {
                body,
                icon: '/icons/icon-192.png',
                tag: `reminder-${task.id}`,
                vibrate: [200, 100, 200],
              });
            } catch {
              // Mobile Safari may not support Notification constructor
              if (navigator.serviceWorker?.controller) {
                navigator.serviceWorker.ready.then(reg => {
                  reg.showNotification(title, {
                    body,
                    icon: '/icons/icon-192.png',
                    tag: `reminder-${task.id}`,
                    vibrate: [200, 100, 200],
                  });
                }).catch(() => {});
              }
            }
          }
        }
      }

      // After firing any reminders OR periodically: sync with server log
      if (firedAny) {
        // Wait a moment then fetch server log to confirm entry is there
        setTimeout(() => fetchLog(), 1500);
      }
    };

    // Run immediately and then every 30 seconds
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [addLocalNotification, addToast, fetchLog]);

  // Cleanup old fired IDs (prevent memory leak)
  useEffect(() => {
    const cleanup = setInterval(() => {
      for (const key of firedRef.current) {
        const reminderAt = key.split(':').slice(1).join(':');
        if (!reminderAt) continue;
        const ts = new Date(reminderAt).getTime();
        if (!Number.isFinite(ts) || ts < Date.now() - 24 * 60 * 60 * 1000) {
          firedRef.current.delete(key);
        }
      }

      const threshold = Date.now() - 24 * 60 * 60 * 1000;
      const nextSeen = {};
      for (const [key, seenAt] of Object.entries(seenMapRef.current || {})) {
        if (Number.isFinite(seenAt) && seenAt >= threshold) {
          nextSeen[key] = seenAt;
        }
      }
      seenMapRef.current = nextSeen;
      writeSeenReminderMap(nextSeen);
    }, 60000);
    return () => clearInterval(cleanup);
  }, []);

  return null; // Invisible component
}
