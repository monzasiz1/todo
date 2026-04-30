import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// >= 1025px = Desktop (modal popup), < 1025px = Mobile/Tablet (page route)
const isDesktop = () =>
  typeof window !== 'undefined' && window.matchMedia('(min-width: 1025px)').matches;

export function useOpenTask() {
  const navigate = useNavigate();
  const [detailTask, setDetailTask] = useState(null);

  const openTask = useCallback((task) => {
    if (isDesktop()) {
      setDetailTask(task);
    } else {
      navigate(`/app/tasks/${task.id}`);
    }
  }, [navigate]);

  const closeTask = useCallback(() => setDetailTask(null), []);

  return { detailTask, openTask, closeTask };
}
