import { useEffect, useRef } from 'react';
import { useTaskStore } from '../store/taskStore';
import { useNotificationStore } from '../store/notificationStore';

/**
 * Client-side Reminder Checker – läuft alle 30 Sekunden,
 * prüft ob Tasks mit reminder_at fällig sind und zeigt:
 * 1. Browser-Notification (Notification API, kein Push nötig)
 * 2. In-App Toast
 * 3. Loggt in die NotificationBell-Liste
 */
export default function ReminderChecker() {
  const { tasks, addToast } = useTaskStore();
  const { fetchLog, addLocalNotification } = useNotificationStore();
  const firedRef = useRef(new Set()); // Track already-fired reminders

  useEffect(() => {
    const check = () => {
      const now = Date.now();

      for (const task of tasks) {
        if (!task.reminder_at || task.completed) continue;
        if (firedRef.current.has(task.id)) continue;

        const reminderTime = new Date(task.reminder_at).getTime();
        // Fire if reminder is due (within the last 5 minutes)
        if (reminderTime <= now && reminderTime > now - 5 * 60 * 1000) {
          firedRef.current.add(task.id);

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
  }, [tasks]);

  // Cleanup old fired IDs (prevent memory leak)
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      const taskIds = new Set(tasks.map(t => t.id));
      for (const id of firedRef.current) {
        if (!taskIds.has(id)) firedRef.current.delete(id);
      }
    }, 60000);
    return () => clearInterval(cleanup);
  }, [tasks]);

  return null; // Invisible component
}
