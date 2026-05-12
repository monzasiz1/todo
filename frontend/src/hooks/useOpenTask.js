import { useState, useCallback } from 'react';
import { api } from '../utils/api';

// Always open via state — no route navigation, so back button never reloads the page
export function useOpenTask() {
  const [detailTask, setDetailTask] = useState(null);

  const openTask = useCallback((task) => {
    setDetailTask(task);

    const rawId = task?.id;
    if (rawId === null || rawId === undefined) return;
    const taskId = String(rawId);
    // Virtual occurrences are generated client-side and cannot be resolved via /tasks/:id.
    if (taskId.startsWith('v_')) return;

    api.getTask(taskId)
      .then((fresh) => {
        if (!fresh || String(fresh.id) !== taskId) return;
        setDetailTask((prev) => {
          if (!prev || String(prev.id) !== taskId) return prev;
          return { ...prev, ...fresh };
        });
      })
      .catch(() => {
        // Keep optimistic snapshot if detail refresh fails.
      });
  }, []);

  const closeTask = useCallback(() => setDetailTask(null), []);

  return { detailTask, openTask, closeTask };
}
