import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Calendar from '../components/Calendar';
import DayCreateModal from '../components/DayCreateModal';
import { useTaskStore } from '../store/taskStore';
import { format } from 'date-fns';
import { getWorkspaceLabel, useWorkspaceStore } from '../store/workspaceStore';

export default function CalendarPage() {
  const { fetchTasksRange } = useTaskStore();
  const { activeWorkspace } = useWorkspaceStore();
  const [calendarTasks, setCalendarTasks] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showDayModal, setShowDayModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [visibleRange, setVisibleRange] = useState({ start: null, end: null, key: '' });

  const loadRange = async (start, end, force = false) => {
    if (!start || !end) return;
    const key = `${activeWorkspace.scope}:${activeWorkspace.id || 'private'}:${start}|${end}`;
    if (!force && visibleRange.key === key) return;
    const tasks = await fetchTasksRange(start, end);
    setCalendarTasks(tasks);
    setVisibleRange({ start, end, key });
  };

  useEffect(() => {
    if (visibleRange.start && visibleRange.end) {
      loadRange(visibleRange.start, visibleRange.end, true);
    }
  }, [activeWorkspace.scope, activeWorkspace.id]);

  const handleTaskCreated = () => {
    if (visibleRange.start && visibleRange.end) {
      loadRange(visibleRange.start, visibleRange.end, true);
    }
    setRefreshKey((k) => k + 1);
  };

  const handleVisibleRangeChange = (start, end) => {
    loadRange(start, end);
  };

  const handleTaskUpdated = (updatedTask) => {
    setCalendarTasks((prev) => prev.map((t) => (t.id === updatedTask.id ? { ...t, ...updatedTask } : t)));
  };

  const handleDayClick = (date) => {
    setSelectedDate(date);
    setShowDayModal(true);
  };

  const selectedTasks = selectedDate
    ? calendarTasks.filter((t) => {
        if (!t.date) return false;
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const taskStart = t.date.substring(0, 10);
        const taskEnd = t.date_end ? t.date_end.substring(0, 10) : taskStart;
        return dateStr >= taskStart && dateStr <= taskEnd;
      })
    : [];

  return (
    <div className="calendar-page-wrap">
      <motion.div
        className="page-header"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h2>{getWorkspaceLabel(activeWorkspace)}</h2>
        <p>Klicke auf einen Tag, um Eintraege im aktiven Workspace zu sehen oder zu erstellen</p>
      </motion.div>

      <Calendar
        onDayClick={handleDayClick}
        tasks={calendarTasks}
        onVisibleRangeChange={handleVisibleRangeChange}
        onTaskUpdated={handleTaskUpdated}
      />

      <AnimatePresence>
        {showDayModal && selectedDate && (
          <DayCreateModal
            date={selectedDate}
            tasks={selectedTasks}
            onClose={() => setShowDayModal(false)}
            onTaskCreated={handleTaskCreated}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
