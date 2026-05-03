import { useState, useCallback } from 'react';

// Always open via state — no route navigation, so back button never reloads the page
export function useOpenTask() {
  const [detailTask, setDetailTask] = useState(null);

  const openTask = useCallback((task) => {
    setDetailTask(task);
  }, []);

  const closeTask = useCallback(() => setDetailTask(null), []);

  return { detailTask, openTask, closeTask };
}
