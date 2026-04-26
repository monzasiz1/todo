import { useCallback, useEffect, useRef, useState } from 'react';
import Calendar from '../components/Calendar';
import { useTaskStore } from '../store/taskStore';

function filterTasksForRange(tasks, start, end) {
  if (!Array.isArray(tasks) || !start || !end) return [];
  const startDay = String(start).slice(0, 10);
  const endDay = String(end).slice(0, 10);

  return tasks.filter((t) => {
    if (!t?.date) return false;
    const taskStart = String(t.date).slice(0, 10);
    const taskEnd = String(t.date_end || t.date).slice(0, 10);
    return taskStart <= endDay && taskEnd >= startDay;
  });
}

export default function CalendarPage() {
  const { fetchTasksRange, tasks: cachedTasks } = useTaskStore();
  const [calendarTasks, setCalendarTasks] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [visibleRange, setVisibleRange] = useState({ start: null, end: null, key: '' });
  const inflightRangeKeyRef = useRef('');

  const loadRange = useCallback(async (start, end, force = false) => {
    if (!start || !end) return;
    const normStart = String(start).slice(0, 10);
    const normEnd = String(end).slice(0, 10);
    const key = `${normStart}|${normEnd}`;

    if (!force && (visibleRange.key === key || inflightRangeKeyRef.current === key)) return;

    inflightRangeKeyRef.current = key;
    setVisibleRange((prev) => (prev.key === key ? prev : { start: normStart, end: normEnd, key }));

    const localRangeTasks = filterTasksForRange(cachedTasks, normStart, normEnd);
    if (localRangeTasks.length > 0) {
      setCalendarTasks(localRangeTasks);
    }

    try {
      const tasks = await fetchTasksRange(normStart, normEnd);
      if (Array.isArray(tasks)) {
        setCalendarTasks(tasks);
      }
    } finally {
      if (inflightRangeKeyRef.current === key) {
        inflightRangeKeyRef.current = '';
      }
    }
  }, [cachedTasks, fetchTasksRange, visibleRange.key]);

  const handleTaskCreated = () => {
    if (visibleRange.start && visibleRange.end) {
      loadRange(visibleRange.start, visibleRange.end, true);
    }
    setRefreshKey((k) => k + 1);
  };

  const handleVisibleRangeChange = useCallback((start, end) => {
    loadRange(start, end);
  }, [loadRange]);

  useEffect(() => {
    const onTasksChanged = () => {
      if (visibleRange.start && visibleRange.end) {
        loadRange(visibleRange.start, visibleRange.end, true);
      }
    };

    window.addEventListener('taski:tasks-changed', onTasksChanged);
    return () => window.removeEventListener('taski:tasks-changed', onTasksChanged);
  }, [visibleRange.start, visibleRange.end, loadRange]);

  const handleTaskUpdated = (updatedTask) => {
    setCalendarTasks((prev) => prev.map((t) => (t.id === updatedTask.id ? { ...t, ...updatedTask } : t)));
  };

  return (
    <div className="calendar-page-wrap">
      <h2 style={{ padding: '16px 20px 0', fontWeight: 700, fontSize: '1.4rem' }}>Kalender</h2>
      <p style={{ padding: '2px 20px 12px', opacity: 0.6, fontSize: '0.85rem' }}>Klicke auf einen Tag, um Aufgaben zu sehen oder zu erstellen</p>

      <Calendar
        tasks={calendarTasks}
        onVisibleRangeChange={handleVisibleRangeChange}
        onTaskUpdated={handleTaskUpdated}
        onTaskCreated={handleTaskCreated}
      />
    </div>
  );
}
