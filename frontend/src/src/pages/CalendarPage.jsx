import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, format as formatDate } from 'date-fns';
import Calendar from '../components/Calendar';
import { useTaskStore } from '../store/taskStore';
import { api } from '../utils/api';

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

function shiftRangeWindow(start, end, direction) {
  const startDate = new Date(`${String(start).slice(0, 10)}T00:00:00`);
  const endDate = new Date(`${String(end).slice(0, 10)}T00:00:00`);
  const daySpan = Math.max(1, Math.round((endDate - startDate) / 86400000) + 1);
  const shiftDays = direction === 'next' ? daySpan : -daySpan;
  return {
    start: formatDate(addDays(startDate, shiftDays), 'yyyy-MM-dd'),
    end: formatDate(addDays(endDate, shiftDays), 'yyyy-MM-dd'),
  };
}

export default function CalendarPage() {
  const navigate = useNavigate();
  const { fetchTasksRange, getCachedTasksRange, primeTasksRangeCache, tasks: cachedTasks } = useTaskStore();
  const [calendarTasks, setCalendarTasks] = useState(() => Array.isArray(cachedTasks) ? cachedTasks : []);
  const [refreshKey, setRefreshKey] = useState(0);
  const [visibleRange, setVisibleRange] = useState({ start: null, end: null, key: '' });
  const inflightRangeKeyRef = useRef('');
  const visibleRangeKeyRef = useRef('');
  const prefetchedRangeKeysRef = useRef(new Set());
  const [searchParams, setSearchParams] = useSearchParams();

  const loadRange = useCallback(async (start, end, force = false) => {
    if (!start || !end) return;
    const normStart = String(start).slice(0, 10);
    const normEnd = String(end).slice(0, 10);
    const key = `${normStart}|${normEnd}`;

    if (!force && inflightRangeKeyRef.current === key) return;

    inflightRangeKeyRef.current = key;
    visibleRangeKeyRef.current = key;
    setVisibleRange((prev) => (prev.key === key ? prev : { start: normStart, end: normEnd, key }));

    const cachedRangeTasks = getCachedTasksRange(normStart, normEnd, 45000);
    const localRangeTasks = cachedRangeTasks || filterTasksForRange(cachedTasks, normStart, normEnd);
    if (localRangeTasks.length > 0) {
      setCalendarTasks(localRangeTasks);
      primeTasksRangeCache(normStart, normEnd, localRangeTasks);
    }

    try {
      const tasks = await fetchTasksRange(normStart, normEnd, { force, maxAgeMs: 45000 });
      if (Array.isArray(tasks) && visibleRangeKeyRef.current === key) {
        setCalendarTasks(tasks);
      }
    } finally {
      if (inflightRangeKeyRef.current === key) {
        inflightRangeKeyRef.current = '';
      }
    }
  }, [cachedTasks, fetchTasksRange, getCachedTasksRange, primeTasksRangeCache]);

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
    if (!visibleRange.start || !visibleRange.end) return;
    const localRangeTasks = getCachedTasksRange(visibleRange.start, visibleRange.end, 45000)
      || filterTasksForRange(cachedTasks, visibleRange.start, visibleRange.end);
    if (localRangeTasks.length > 0) {
      setCalendarTasks(localRangeTasks);
    }
  }, [cachedTasks, getCachedTasksRange, visibleRange.start, visibleRange.end]);

  useEffect(() => {
    if (!visibleRange.start || !visibleRange.end) return;

    const neighborRanges = [
      shiftRangeWindow(visibleRange.start, visibleRange.end, 'prev'),
      shiftRangeWindow(visibleRange.start, visibleRange.end, 'next'),
    ];

    neighborRanges.forEach(({ start, end }) => {
      const key = `${start}|${end}`;
      if (prefetchedRangeKeysRef.current.has(key)) return;
      if (getCachedTasksRange(start, end, 45000)) {
        prefetchedRangeKeysRef.current.add(key);
        return;
      }

      prefetchedRangeKeysRef.current.add(key);
      fetchTasksRange(start, end, { force: false, maxAgeMs: 45000 })
        .catch(() => null);
    });
  }, [fetchTasksRange, getCachedTasksRange, visibleRange.end, visibleRange.start]);

  useEffect(() => {
    const onTasksChanged = () => {
      if (visibleRange.start && visibleRange.end) {
        loadRange(visibleRange.start, visibleRange.end, true);
      }
    };

    window.addEventListener('beequ:tasks-changed', onTasksChanged);
    return () => window.removeEventListener('beequ:tasks-changed', onTasksChanged);
  }, [visibleRange.start, visibleRange.end, loadRange]);

  const handleTaskUpdated = (updatedTask) => {
    setCalendarTasks((prev) => prev.map((t) => (t.id === updatedTask.id ? { ...t, ...updatedTask } : t)));
  };

  // Open task detail from URL param (e.g. from notification click)
  useEffect(() => {
    const taskParam = searchParams.get('task');
    if (!taskParam) return;
    setSearchParams({}, { replace: true });
    navigate(`/app/tasks/${taskParam}`, { replace: false });
  }, [searchParams, setSearchParams, navigate]);

  return (
    <div className="calendar-page-wrap">
      <div className="page-header">
        <h2>Kalender</h2>
        <p>Klicke auf einen Tag, um Aufgaben zu sehen oder zu erstellen</p>
      </div>

      <Calendar
        tasks={calendarTasks}
        onVisibleRangeChange={handleVisibleRangeChange}
        onTaskUpdated={handleTaskUpdated}
        onTaskCreated={handleTaskCreated}
      />
    </div>
  );
}

