import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTaskStore } from '../store/taskStore';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  isSameMonth,
  isSameDay,
  isToday,
  parseISO,
} from 'date-fns';
import { de } from 'date-fns/locale';

export default function Calendar({ onDayClick }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState('month'); // 'month' | 'week'
  const [calendarTasks, setCalendarTasks] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const { tasks, fetchTasksRange } = useTaskStore();

  useEffect(() => {
    loadTasks();
  }, [currentDate, view, tasks.length]);

  const loadTasks = async () => {
    let start, end;
    if (view === 'month') {
      const monthStart = startOfMonth(currentDate);
      start = format(startOfWeek(monthStart, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      end = format(endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    } else {
      start = format(startOfWeek(currentDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      end = format(endOfWeek(currentDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    }
    const tasks = await fetchTasksRange(start, end);
    setCalendarTasks(tasks);
  };

  const getTasksForDate = (date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return calendarTasks.filter((t) => t.date === dateStr);
  };

  const navigate = (direction) => {
    if (view === 'month') {
      setCurrentDate(direction === 'next' ? addMonths(currentDate, 1) : subMonths(currentDate, 1));
    } else {
      setCurrentDate(direction === 'next' ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1));
    }
  };

  const handleDayClick = (date) => {
    setSelectedDate(date);
    onDayClick?.(date);
  };

  // Month view days
  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

    const days = [];
    let day = calStart;
    while (day <= calEnd) {
      days.push(day);
      day = addDays(day, 1);
    }

    const dayHeaders = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

    return (
      <>
        {dayHeaders.map((d) => (
          <div key={d} className="calendar-day-header">{d}</div>
        ))}
        {days.map((d) => {
          const dayTasks = getTasksForDate(d);
          const isCurrentMonth = isSameMonth(d, currentDate);
          const isSelected = selectedDate && isSameDay(d, selectedDate);

          return (
            <motion.div
              key={d.toISOString()}
              className={`calendar-day ${!isCurrentMonth ? 'other-month' : ''} ${isToday(d) ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
              onClick={() => handleDayClick(d)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <span className="calendar-day-number">{format(d, 'd')}</span>
              {dayTasks.length > 0 && (
                <div className="calendar-day-dots">
                  {dayTasks.slice(0, 3).map((t) => (
                    <div
                      key={t.id}
                      className="calendar-day-dot"
                      style={{ background: t.category_color || 'var(--primary)' }}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          );
        })}
      </>
    );
  };

  // Week view
  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push(addDays(weekStart, i));
    }

    return (
      <div className="calendar-week">
        {days.map((d) => {
          const dayTasks = getTasksForDate(d);
          return (
            <div
              key={d.toISOString()}
              className={`calendar-week-day ${isToday(d) ? 'today' : ''}`}
              onClick={() => handleDayClick(d)}
            >
              <div className="calendar-week-day-label">
                <span className="calendar-week-day-name">{format(d, 'EEE', { locale: de })}</span>
                <span className="calendar-week-day-num">{format(d, 'd')}</span>
              </div>
              <div className="calendar-week-tasks">
                {dayTasks.map((t) => (
                  <div
                    key={t.id}
                    className={`calendar-week-task ${t.completed ? 'completed' : ''}`}
                    style={{
                      background: t.category_color ? `${t.category_color}18` : 'var(--primary-bg)',
                      color: t.category_color || 'var(--primary)',
                    }}
                  >
                    {t.time && <span style={{ opacity: 0.7 }}>{t.time.slice(0, 5)}</span>}
                    {t.title}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const headerText = view === 'month'
    ? format(currentDate, 'MMMM yyyy', { locale: de })
    : `KW ${format(currentDate, 'w')} · ${format(startOfWeek(currentDate, { weekStartsOn: 1 }), 'd. MMM', { locale: de })} – ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), 'd. MMM yyyy', { locale: de })}`;

  return (
    <motion.div
      className="calendar-wrapper"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="calendar-header">
        <h3 style={{ textTransform: 'capitalize' }}>{headerText}</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="calendar-view-toggle">
            <button
              className={`calendar-view-btn ${view === 'month' ? 'active' : ''}`}
              onClick={() => setView('month')}
            >
              Monat
            </button>
            <button
              className={`calendar-view-btn ${view === 'week' ? 'active' : ''}`}
              onClick={() => setView('week')}
            >
              Woche
            </button>
          </div>
          <div className="calendar-nav">
            <button className="calendar-nav-btn" onClick={() => navigate('prev')}>
              <ChevronLeft size={20} />
            </button>
            <button
              className="calendar-nav-btn"
              onClick={() => setCurrentDate(new Date())}
              style={{ fontSize: 12, fontWeight: 700, width: 'auto', padding: '0 12px' }}
            >
              Heute
            </button>
            <button className="calendar-nav-btn" onClick={() => navigate('next')}>
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </div>

      {view === 'month' ? (
        <div className="calendar-grid">{renderMonthView()}</div>
      ) : (
        renderWeekView()
      )}
    </motion.div>
  );
}
