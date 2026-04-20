import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTaskStore } from '../store/taskStore';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import TaskDetailModal from './TaskDetailModal';
import AvatarBadge from './AvatarBadge';
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
  setMonth,
  setYear,
  getMonth,
  getYear,
} from 'date-fns';
import { de } from 'date-fns/locale';

export default function Calendar({ onDayClick }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState('month'); // 'month' | 'week'
  const [selectedDate, setSelectedDate] = useState(null);
  const [detailTask, setDetailTask] = useState(null);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(getYear(new Date()));
  const monthPickerRef = useRef(null);
  const { tasks } = useTaskStore();

  // Close picker on outside click
  useEffect(() => {
    if (!showMonthPicker) return;
    const handleClick = (e) => {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target)) {
        setShowMonthPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMonthPicker]);

  const getTasksForDate = (date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return tasks.filter((t) => {
      if (!t.date) return false;
      const taskStart = t.date.substring(0, 10);
      const taskEnd = t.date_end ? t.date_end.substring(0, 10) : taskStart;
      return dateStr >= taskStart && dateStr <= taskEnd;
    });
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
              <div className="calendar-day-top">
                <span className="calendar-day-number">{format(d, 'd')}</span>
                {dayTasks.length > 0 && (
                  <button
                    className="calendar-day-add"
                    onClick={(e) => { e.stopPropagation(); handleDayClick(d); }}
                    aria-label="Neu erstellen"
                  >
                    <Plus size={12} />
                  </button>
                )}
              </div>
              {dayTasks.length > 0 && (
                <div className="calendar-day-tasks">
                  {dayTasks.slice(0, 2).map((t) => (
                    <div
                      key={t.id}
                      className={`calendar-day-task ${t.completed ? 'completed' : ''} ${t.group_id ? 'group-task' : ''}`}
                      style={{
                        background: t.group_id
                          ? `${t.group_color || '#5856D6'}15`
                          : t.category_color ? `${t.category_color}20` : 'var(--primary-bg)',
                        color: t.group_id
                          ? (t.group_color || '#5856D6')
                          : t.category_color || 'var(--primary)',
                        borderLeft: `2px solid ${t.group_id ? (t.group_color || '#5856D6') : (t.category_color || 'var(--primary)')}`,
                      }}
                      onClick={(e) => { e.stopPropagation(); setDetailTask(t); }}
                    >
                      {t.group_id && (
                        <AvatarBadge
                          name={t.group_name}
                          color={t.group_color || '#5856D6'}
                          avatarUrl={t.group_image_url}
                          size={10}
                        />
                      )}
                      {t.time && <span className="calendar-day-task-time">{t.time.slice(0, 5)}</span>}
                      <span className="calendar-day-task-title">{t.title}</span>
                    </div>
                  ))}
                  {dayTasks.length > 2 && (
                    <div className="calendar-day-more">+{dayTasks.length - 2} mehr</div>
                  )}
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
                    className={`calendar-week-task ${t.completed ? 'completed' : ''} ${t.group_id ? 'group-task' : ''}`}
                    style={{
                      background: t.group_id
                        ? `${t.group_color || '#5856D6'}15`
                        : t.category_color ? `${t.category_color}18` : 'var(--primary-bg)',
                      color: t.group_id
                        ? (t.group_color || '#5856D6')
                        : t.category_color || 'var(--primary)',
                      cursor: 'pointer',
                      borderLeft: t.group_id ? `3px solid ${t.group_color || '#5856D6'}` : undefined,
                    }}
                    onClick={(e) => { e.stopPropagation(); setDetailTask(t); }}
                  >
                    {t.group_id && (
                      <AvatarBadge
                        name={t.group_name}
                        color={t.group_color || '#5856D6'}
                        avatarUrl={t.group_image_url}
                        size={11}
                      />
                    )}
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
        <div className="cal-month-picker-wrap" ref={monthPickerRef}>
          <h3
            className="cal-header-title"
            style={{ textTransform: 'capitalize', cursor: 'pointer' }}
            onClick={() => { setPickerYear(getYear(currentDate)); setShowMonthPicker(!showMonthPicker); }}
          >
            {headerText}
            <ChevronRight size={16} className={`cal-header-chevron ${showMonthPicker ? 'open' : ''}`} />
          </h3>
          <AnimatePresence>
            {showMonthPicker && (
              <motion.div
                className="cal-month-picker"
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
              >
                <div className="cal-mp-year-row">
                  <button className="cal-mp-year-btn" onClick={() => setPickerYear(y => y - 1)}>
                    <ChevronLeft size={18} />
                  </button>
                  <span className="cal-mp-year">{pickerYear}</span>
                  <button className="cal-mp-year-btn" onClick={() => setPickerYear(y => y + 1)}>
                    <ChevronRight size={18} />
                  </button>
                </div>
                <div className="cal-mp-grid">
                  {Array.from({ length: 12 }, (_, i) => {
                    const isActive = getMonth(currentDate) === i && getYear(currentDate) === pickerYear;
                    const isCurrent = getMonth(new Date()) === i && getYear(new Date()) === pickerYear;
                    return (
                      <button
                        key={i}
                        className={`cal-mp-month ${isActive ? 'active' : ''} ${isCurrent ? 'current' : ''}`}
                        onClick={() => {
                          setCurrentDate(setYear(setMonth(currentDate, i), pickerYear));
                          setShowMonthPicker(false);
                        }}
                      >
                        {format(new Date(2024, i, 1), 'MMM', { locale: de })}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
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

      {detailTask && createPortal(
        <TaskDetailModal task={detailTask} onClose={() => setDetailTask(null)} />,
        document.body
      )}
    </motion.div>
  );
}
