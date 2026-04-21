import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTaskStore } from '../store/taskStore';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
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
  differenceInCalendarDays,
} from 'date-fns';
import { de } from 'date-fns/locale';

export default function Calendar({ onDayClick, tasks: tasksProp, onVisibleRangeChange, onTaskUpdated }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState('month');
  const [selectedDate, setSelectedDate] = useState(null);
  const [detailTask, setDetailTask] = useState(null);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(getYear(new Date()));
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);
  // Drag state (Pointer Events based)
  const [dragInfo, setDragInfo] = useState(null); // { task, x, y } | null
  const dragTaskRef = useRef(null);
  const wasDragging = useRef(false);

  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const { tasks: storeTasks, updateTask } = useTaskStore();
  const tasks = Array.isArray(tasksProp) ? tasksProp : storeTasks;

  useEffect(() => {
    if (!onVisibleRangeChange) return;

    let start;
    let end;

    if (view === 'month') {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      start = startOfWeek(monthStart, { weekStartsOn: 1 });
      end = endOfWeek(monthEnd, { weekStartsOn: 1 });
    } else {
      start = startOfWeek(currentDate, { weekStartsOn: 1 });
      end = endOfWeek(currentDate, { weekStartsOn: 1 });
    }

    onVisibleRangeChange(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
  }, [currentDate, view, onVisibleRangeChange]);

  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    if (!showMonthPicker) return;
    const handler = (e) => {
      if (
        (triggerRef.current && triggerRef.current.contains(e.target)) ||
        (dropdownRef.current && dropdownRef.current.contains(e.target))
      ) return;
      setShowMonthPicker(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
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

  // ── Drag & Drop via Pointer Events ──────────────────────────────
  const handlePointerDown = (e, task) => {
    if (!isDesktop || e.button !== 0) return;
    e.preventDefault();
    dragTaskRef.current = task;
    let moved = false;

    const onMove = (ev) => {
      moved = true;
      wasDragging.current = true;
      setDragInfo({ task, x: ev.clientX, y: ev.clientY });
      // Highlight target cell via DOM (no React re-render needed for highlight)
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const cell = under?.closest('[data-caldate]');
      document.querySelectorAll('.cal-drag-over').forEach(el => el.classList.remove('cal-drag-over'));
      if (cell) cell.classList.add('cal-drag-over');
    };

    const onUp = async (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.querySelectorAll('.cal-drag-over').forEach(el => el.classList.remove('cal-drag-over'));
      const droppedTask = dragTaskRef.current;
      dragTaskRef.current = null;
      setDragInfo(null);
      if (!moved || !droppedTask) { wasDragging.current = false; return; }
      setTimeout(() => { wasDragging.current = false; }, 100);

      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const cell = under?.closest('[data-caldate]');
      if (!cell) return;

      const targetDateStr = cell.dataset.caldate;
      const oldDateStr = droppedTask.date?.substring(0, 10);
      if (targetDateStr === oldDateStr) return;

      let newDateEnd = droppedTask.date_end || null;
      if (droppedTask.date_end && oldDateStr) {
        const delta = differenceInCalendarDays(parseISO(targetDateStr), parseISO(oldDateStr));
        const oldEnd = parseISO(droppedTask.date_end.substring(0, 10));
        newDateEnd = format(addDays(oldEnd, delta), 'yyyy-MM-dd');
      }
      const updated = await updateTask(droppedTask.id, { date: targetDateStr, date_end: newDateEnd });
      if (updated && onTaskUpdated) {
        onTaskUpdated(updated);
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  // ── Month view ────────────────────────────────────────────────────
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
            <div
              key={d.toISOString()}
              data-caldate={format(d, 'yyyy-MM-dd')}
              className={`calendar-day ${!isCurrentMonth ? 'other-month' : ''} ${isToday(d) ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
              onClick={() => handleDayClick(d)}
            >
              <span className="calendar-day-number">{format(d, 'd')}</span>
              {dayTasks.length > 0 && (
                <div className="calendar-day-tasks">
                  {dayTasks.slice(0, isDesktop ? 4 : 2).map((t) => (
                    <div
                      key={t.id}
                      className={`calendar-day-task ${t.completed ? 'completed' : ''} ${t.group_id ? 'group-task' : ''} ${dragInfo?.task.id === t.id ? 'cal-dragging' : ''}`}
                      style={{
                        background: t.group_id
                          ? `${t.group_color || '#5856D6'}15`
                          : t.category_color ? `${t.category_color}20` : 'var(--primary-bg)',
                        color: t.group_id
                          ? (t.group_color || '#5856D6')
                          : t.category_color || 'var(--primary)',
                        borderLeft: `2px solid ${t.group_id ? (t.group_color || '#5856D6') : (t.category_color || 'var(--primary)')}`,
                        cursor: isDesktop ? 'grab' : 'pointer',
                        userSelect: 'none',
                      }}
                      onPointerDown={isDesktop ? (e) => handlePointerDown(e, t) : undefined}
                      onClick={(e) => { e.stopPropagation(); if (!wasDragging.current) setDetailTask(t); }}
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
                  {dayTasks.length > (isDesktop ? 4 : 2) && (
                    <div className="calendar-day-more">+{dayTasks.length - (isDesktop ? 4 : 2)} mehr</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  };

  // ── Week view ─────────────────────────────────────────────────────
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
              data-caldate={format(d, 'yyyy-MM-dd')}
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
                    className={`calendar-week-task ${t.completed ? 'completed' : ''} ${t.group_id ? 'group-task' : ''} ${dragInfo?.task.id === t.id ? 'cal-dragging' : ''}`}
                    style={{
                      background: t.group_id
                        ? `${t.group_color || '#5856D6'}15`
                        : t.category_color ? `${t.category_color}18` : 'var(--primary-bg)',
                      color: t.group_id
                        ? (t.group_color || '#5856D6')
                        : t.category_color || 'var(--primary)',
                      cursor: isDesktop ? 'grab' : 'pointer',
                      borderLeft: t.group_id ? `3px solid ${t.group_color || '#5856D6'}` : undefined,
                      userSelect: 'none',
                    }}
                    onPointerDown={isDesktop ? (e) => handlePointerDown(e, t) : undefined}
                    onClick={(e) => { e.stopPropagation(); if (!wasDragging.current) setDetailTask(t); }}
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
        <div className="cal-mp-wrap">
          <button
            ref={triggerRef}
            className="cal-mp-trigger"
            onClick={() => { setPickerYear(getYear(currentDate)); setShowMonthPicker(v => !v); }}
          >
            <span style={{ textTransform: 'capitalize' }}>{headerText}</span>
            <ChevronDown size={16} className={`cal-mp-chevron ${showMonthPicker ? 'open' : ''}`} />
          </button>
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

      <div
        ref={dropdownRef}
        className={`cal-mp-dropdown ${showMonthPicker ? 'open' : ''}`}
      >
        <div className="cal-mp-inner">
          <div className="cal-mp-year-nav">
            <button onClick={() => setPickerYear(y => y - 1)}><ChevronLeft size={16} /></button>
            <span>{pickerYear}</span>
            <button onClick={() => setPickerYear(y => y + 1)}><ChevronRight size={16} /></button>
          </div>
          <div className="cal-mp-months">
            {Array.from({ length: 12 }, (_, i) => (
              <button
                key={i}
                className={`cal-mp-m${getMonth(currentDate) === i && getYear(currentDate) === pickerYear ? ' active' : ''}${getMonth(new Date()) === i && getYear(new Date()) === pickerYear ? ' now' : ''}`}
                onClick={() => {
                  setCurrentDate(setYear(setMonth(currentDate, i), pickerYear));
                  setShowMonthPicker(false);
                }}
              >
                {format(new Date(2024, i, 1), 'MMM', { locale: de })}
              </button>
            ))}
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

      {dragInfo && createPortal(
        <div style={{
          position: 'fixed',
          left: dragInfo.x + 12,
          top: dragInfo.y - 14,
          pointerEvents: 'none',
          zIndex: 9999,
          opacity: 0.85,
          transform: 'rotate(2deg) scale(1.08)',
          maxWidth: 180,
          background: dragInfo.task.group_id
            ? `${dragInfo.task.group_color || '#5856D6'}20`
            : dragInfo.task.category_color ? `${dragInfo.task.category_color}25` : 'var(--primary-bg)',
          color: dragInfo.task.group_id
            ? (dragInfo.task.group_color || '#5856D6')
            : dragInfo.task.category_color || 'var(--primary)',
          borderLeft: `3px solid ${dragInfo.task.group_id ? (dragInfo.task.group_color || '#5856D6') : (dragInfo.task.category_color || 'var(--primary)')}`,
          borderRadius: 4,
          padding: '3px 8px',
          fontSize: '0.75rem',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
        }}>
          {dragInfo.task.title}
        </div>,
        document.body
      )}
    </motion.div>
  );
}
