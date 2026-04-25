import { useEffect, useRef } from 'react';
import { useTaskStore } from '../store/taskStore';
import { useNotificationStore } from '../store/notificationStore';
import { api } from '../utils/api';

/**
 * Client-side Reminder Checker – läuft alle 30 Sekunden,
 * prüft ob Tasks mit reminder_at fällig sind und zeigt:
 * 1. Browser-Notification (Notification API, kein Push nötig)
 * 2. In-App Toast
 * 3. Loggt in die NotificationBell-Liste
 */
export default function ReminderChecker() {
  const { addToast } = useTaskStore();
  const { fetchLog, addLocalNotification } = useNotificationStore();
  const firedRef = useRef(new Set()); // Track already-fired reminders

  const buildReminderKey = (task) => `${task.id}:${task.reminder_at || ''}`;

  // Request background reminder checks from Service Worker (if app is closed)
  useEffect(() => {
    if (!navigator.serviceWorker?.controller) return;
    const bgCheckInterval = setInterval(() => {
      navigator.serviceWorker.controller.postMessage({ type: 'CHECK_REMINDERS' });
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
      } catch {
        // ignore transient API errors; next interval retries
        return;
      }

      for (const task of dueTasks) {
        if (!task.reminder_at || task.completed) continue;
        const reminderKey = buildReminderKey(task);
        if (firedRef.current.has(reminderKey)) continue;

        const reminderTime = new Date(task.reminder_at).getTime();
        // Fire if reminder is due (within the last 12 hours)
        if (reminderTime <= now && reminderTime > now - 12 * 60 * 60 * 1000) {
          firedRef.current.add(reminderKey);

          const title = '⏰ Erinnerung';
          const body = `${task.title}${task.time ? ' um ' + task.time.slice(0, 5) : ''}`;

          // 1. In-App Toast
          addToast(body, 'info');

          // 2. Add to notification bell immediately
          addLocalNotification({
            type: 'reminder',
            title,
            body,
            task_id: task.id,
          });

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
                });
              }
            }
          }

          // 4. Refresh notification log from server
          fetchLog();
        }
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
    }, 60000);
    return () => clearInterval(cleanup);
  }, []);

  return null; // Invisible component
}
