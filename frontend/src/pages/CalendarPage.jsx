import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Calendar from '../components/Calendar';
import AIInput from '../components/AIInput';
import { useTaskStore } from '../store/taskStore';
import TaskCard from '../components/TaskCard';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { CalendarDays } from 'lucide-react';

export default function CalendarPage() {
  const { tasks, fetchTasks } = useTaskStore();
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    fetchTasks();
  }, []);

  const selectedTasks = selectedDate
    ? tasks.filter((t) => t.date === format(selectedDate, 'yyyy-MM-dd'))
    : [];

  return (
    <div>
      <motion.div
        className="page-header"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h2>Kalender</h2>
        <p>Überblick über alle deine Aufgaben</p>
      </motion.div>

      <AIInput />

      <Calendar onDayClick={setSelectedDate} />

      {/* Selected Day Tasks */}
      <AnimatePresence>
        {selectedDate && (
          <motion.div
            style={{ marginTop: 24 }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
          >
            <div className="task-section-header" style={{ marginBottom: 12 }}>
              <span className="task-section-title">
                Aufgaben am {format(selectedDate, 'd. MMMM yyyy', { locale: de })}
              </span>
              <span className="task-section-count">{selectedTasks.length}</span>
            </div>

            {selectedTasks.length > 0 ? (
              <div className="task-list">
                {selectedTasks.map((task, i) => (
                  <TaskCard key={task.id} task={task} index={i} />
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '40px 24px' }}>
                <div className="empty-state-icon">
                  <CalendarDays size={32} />
                </div>
                <h3>Keine Aufgaben</h3>
                <p>An diesem Tag sind keine Aufgaben geplant.</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
