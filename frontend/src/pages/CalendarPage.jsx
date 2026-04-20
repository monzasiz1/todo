import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Calendar from '../components/Calendar';
import AIInput from '../components/AIInput';
import ManualTaskForm from '../components/ManualTaskForm';
import DayCreateModal from '../components/DayCreateModal';
import { useTaskStore } from '../store/taskStore';
import { format } from 'date-fns';

export default function CalendarPage() {
  const { tasks, fetchTasks } = useTaskStore();
  const [selectedDate, setSelectedDate] = useState(null);
  const [showDayModal, setShowDayModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleTaskCreated = () => {
    fetchTasks();
    setRefreshKey((k) => k + 1);
  };

  const handleDayClick = (date) => {
    setSelectedDate(date);
    setShowDayModal(true);
  };

  const selectedTasks = selectedDate
    ? tasks.filter((t) => {
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
        <h2>Kalender</h2>
        <p>Klicke auf einen Tag, um Aufgaben zu sehen oder zu erstellen</p>
      </motion.div>

      <div className="task-creation-stack">
        <AIInput onTaskCreated={handleTaskCreated} />
        <ManualTaskForm onTaskCreated={handleTaskCreated} defaultDate={selectedDate} />
      </div>

      <Calendar onDayClick={handleDayClick} />

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
