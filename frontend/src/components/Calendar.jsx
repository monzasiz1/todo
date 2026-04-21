import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTaskStore } from '../store/taskStore';
import { ChevronLeft, ChevronRight, ChevronDown, Plus } from 'lucide-react';
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
  addDays as addDay,
  subDays,
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
  const [view, setView] = useState(window.innerWidth >= 768 ? 'week' : 'month');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [detailTask, setDetailTask] = useState(null);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showSidebarCategories, setShowSidebarCategories] = useState(true);
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

  const getTaskSource = (t) => {
    if (t.group_id || t.group_name) {
      return {
        key: `group:${t.group_id || t.group_name}`,
        name: t.group_name || 'Gruppe',
        color: t.group_color || '#5856D6',
      };
    }
    if (t.category_id || t.category_name) {
      return {
        key: `cat:${t.category_id || t.category_name}`,
        name: t.category_name || 'Kategorie',
        color: t.category_color || '#4C7BD9',
      };
    }
    return { key: 'default:persoenlich', name: 'Persoenlich', color: '#4C7BD9' };
  };

  const calendarSources = useMemo(() => {
    const map = new Map();
    tasks.forEach((t) => {
      const source = getTaskSource(t);
      if (!map.has(source.key)) {
        map.set(source.key, source);
      }
    });
    return Array.from(map.values());
  }, [tasks]);

  const [visibleSources, setVisibleSources] = useState({});

  useEffect(() => {
    setVisibleSources((prev) => {
      let changed = false;
      const next = { ...prev };
      calendarSources.forEach((s) => {
        if (typeof next[s.key] === 'undefined') {
          next[s.key] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [calendarSources]);

  const filteredTasks = useMemo(
    () => tasks.filter((t) => visibleSources[getTaskSource(t).key] !== false),
    [tasks, visibleSources]
  );

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
    if (!isDesktop) {
      setView('month');
      if (!selectedDate) setSelectedDate(new Date());
    }
  }, [isDesktop, selectedDate]);

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
    return filteredTasks.filter((t) => {
      if (!t.date) return false;
      const taskStart = t.date.substring(0, 10);
      const taskEnd = t.date_end ? t.date_end.substring(0, 10) : taskStart;
      return dateStr >= taskStart && dateStr <= taskEnd;
    });
  };

  const navigate = (direction) => {
    if (view === 'month') {
      const nextDate = direction === 'next' ? addMonths(currentDate, 1) : subMonths(currentDate, 1);
      setCurrentDate(nextDate);
      return;
    }

    if (view === 'day') {
      const base = selectedDate || currentDate;
      const nextDate = direction === 'next' ? addDay(base, 1) : subDays(base, 1);
      setSelectedDate(nextDate);
      setCurrentDate(nextDate);
      return;
    }

    const nextDate = direction === 'next' ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1);
    setCurrentDate(nextDate);
    setSelectedDate(nextDate);
  };

  const handleDayClick = (date) => {
    setSelectedDate(date);
    setCurrentDate(date);
    onDayClick?.(date);
  };

  const getTasksForSelectedDay = () => {
    if (!selectedDate) return [];
    return getTasksForDate(selectedDate).slice().sort((a, b) => {
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time) return -1;
      if (b.time) return 1;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
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

    const dayHeaders = isDesktop
      ? ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
      : ['M', 'D', 'M', 'D', 'F', 'S', 'S'];

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
  const renderDesktopWeekView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    const startHour = 7;
    const endHour = 23;
    const hourHeight = 52;
    const totalHeight = (endHour - startHour) * hourHeight;
    const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);

    const timeToMinutes = (timeStr) => {
      if (!timeStr) return null;
      const [h, m] = String(timeStr).split(':').map((v) => parseInt(v, 10));
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return h * 60 + m;
    };

    return (
      <div className="desktop-week-layout">
        <aside className="desktop-calendar-sidebar">
          <div className="desktop-calendar-sidebar-title">Kalender</div>
          <button className="desktop-sidebar-section-toggle" onClick={() => setShowSidebarCategories((v) => !v)}>
            <span>Kategorien</span>
            <ChevronDown size={15} className={`desktop-sidebar-chevron ${showSidebarCategories ? 'open' : ''}`} />
          </button>
          <AnimatePresence initial={false}>
            {showSidebarCategories && (
              <motion.div
                className="desktop-calendar-source-list"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {calendarSources.map((source) => (
                  <label key={source.key} className="desktop-calendar-source-item">
                    <input
                      type="checkbox"
                      checked={visibleSources[source.key] !== false}
                      onChange={(e) => setVisibleSources((s) => ({ ...s, [source.key]: e.target.checked }))}
                    />
                    <span className="desktop-calendar-source-dot" style={{ background: source.color }} />
                    <span className="desktop-calendar-source-name">{source.name}</span>
                  </label>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </aside>

        <div className="desktop-week-main">
          <div className="desktop-week-days-row">
            <div className="desktop-week-left-head" />
            {days.map((d) => (
              <button
                key={`head-${d.toISOString()}`}
                className={`desktop-week-day-head ${isToday(d) ? 'today' : ''}`}
                onClick={() => handleDayClick(d)}
              >
                <span>{format(d, 'EEE', { locale: de })}</span>
                <strong>{format(d, 'd.M')}</strong>
              </button>
            ))}
          </div>

          <div className="desktop-week-all-day-row">
            <div className="desktop-week-left-label">all-day</div>
            {days.map((d) => {
              const dayTasks = getTasksForDate(d).filter((t) => !t.time);
              return (
                <div key={`allday-${d.toISOString()}`} className="desktop-week-all-day-cell" data-caldate={format(d, 'yyyy-MM-dd')}>
                  {dayTasks.slice(0, 2).map((t) => (
                    <button
                      key={t.id}
                      className="desktop-week-all-day-event"
                      style={{ background: t.group_color || t.category_color || '#4C7BD9' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailTask(t);
                      }}
                    >
                      {t.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="desktop-week-time-wrap">
            <div className="desktop-week-hours-col" style={{ height: `${totalHeight}px` }}>
              {hours.map((h) => (
                <div key={h} className="desktop-week-hour-label" style={{ top: `${(h - startHour) * hourHeight - 7}px` }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            <div className="desktop-week-columns">
              {days.map((d) => {
                const dayTasks = getTasksForDate(d).filter((t) => t.time);
                return (
                  <div
                    key={`col-${d.toISOString()}`}
                    className={`desktop-week-day-col ${isToday(d) ? 'today' : ''}`}
                    data-caldate={format(d, 'yyyy-MM-dd')}
                    style={{ height: `${totalHeight}px` }}
                    onClick={() => handleDayClick(d)}
                  >
                    {hours.slice(0, -1).map((h) => (
                      <div key={`${d.toISOString()}-${h}`} className="desktop-week-hour-line" style={{ top: `${(h - startHour) * hourHeight}px` }} />
                    ))}

                    {dayTasks.map((t) => {
                      const startMins = timeToMinutes(t.time) ?? (startHour * 60);
                      const rawEnd = timeToMinutes(t.time_end);
                      const endMins = rawEnd && rawEnd > startMins ? rawEnd : startMins + 60;
                      const clampedStart = Math.max(startHour * 60, startMins);
                      const clampedEnd = Math.min(endHour * 60, endMins);
                      const top = ((clampedStart - startHour * 60) / 60) * hourHeight;
                      const height = Math.max(24, ((clampedEnd - clampedStart) / 60) * hourHeight - 2);

                      return (
                        <button
                          key={t.id}
                          className="desktop-week-event"
                          style={{
                            top: `${top}px`,
                            height: `${height}px`,
                            background: t.group_color || t.category_color || '#4C7BD9',
                          }}
                          onPointerDown={isDesktop ? (e) => handlePointerDown(e, t) : undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!wasDragging.current) setDetailTask(t);
                          }}
                        >
                          <span className="desktop-week-event-title">{t.title}</span>
                          <span className="desktop-week-event-time">{t.time?.slice(0, 5)}{t.time_end ? ` - ${t.time_end.slice(0, 5)}` : ''}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    if (isDesktop) {
      return renderDesktopWeekView();
    }

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

  const renderMobileDayView = () => {
    const dayTasks = getTasksForSelectedDay();
    const startHour = 7;
    const endHour = 23;
    const hourHeight = 56;
    const totalHeight = (endHour - startHour) * hourHeight;
    const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);

    const toMinutes = (time) => {
      if (!time) return null;
      const [h, m] = String(time).split(':').map((n) => parseInt(n, 10));
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return h * 60 + m;
    };

    const now = new Date();
    const selectedIsToday = selectedDate && isSameDay(selectedDate, now);
    const nowTop = selectedIsToday
      ? (((now.getHours() * 60 + now.getMinutes()) - (startHour * 60)) / 60) * hourHeight
      : null;

    const handleGridClick = (e) => {
      const gridRect = e.currentTarget.getBoundingClientRect();
      const y = Math.max(0, Math.min(gridRect.height, e.clientY - gridRect.top));
      const minsFromStart = (y / hourHeight) * 60;
      const snapped = Math.floor(minsFromStart / 15) * 15;

      const dayBase = selectedDate || currentDate;
      const pickedDate = new Date(dayBase);
      const totalMinutes = (startHour * 60) + snapped;
      pickedDate.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);

      handleDayClick(pickedDate);
    };

    return (
      <div className="mobile-day-view">
        <div className="mobile-day-grid" style={{ height: `${totalHeight}px` }} onClick={handleGridClick}>
          {hours.map((h) => (
            <div key={`h-${h}`} className="mobile-day-hour-row" style={{ top: `${(h - startHour) * hourHeight}px` }}>
              <span className="mobile-day-hour-label">{String(h).padStart(2, '0')}:00</span>
            </div>
          ))}

          {selectedIsToday && nowTop !== null && nowTop >= 0 && nowTop <= totalHeight && (
            <div className="mobile-day-now-line" style={{ top: `${nowTop}px` }}>
              <span>{`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`}</span>
            </div>
          )}

          {dayTasks.filter((t) => t.time).map((t) => {
            const start = toMinutes(t.time) ?? (startHour * 60);
            const endRaw = toMinutes(t.time_end);
            const end = endRaw && endRaw > start ? endRaw : start + 60;
            const clampedStart = Math.max(startHour * 60, start);
            const clampedEnd = Math.min(endHour * 60, end);
            const top = ((clampedStart - startHour * 60) / 60) * hourHeight;
            const height = Math.max(36, ((clampedEnd - clampedStart) / 60) * hourHeight - 4);
            return (
              <button
                key={t.id}
                className="mobile-day-event"
                style={{
                  top: `${top}px`,
                  height: `${height}px`,
                  background: t.group_color || t.category_color || '#4C7BD9',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setDetailTask(t);
                }}
              >
                <strong>{t.title}</strong>
                <span>{t.time?.slice(0, 5)}{t.time_end ? `-${t.time_end.slice(0, 5)}` : ''}</span>
              </button>
            );
          })}
        </div>

        {dayTasks.filter((t) => !t.time).length > 0 && (
          <div className="mobile-day-allday">
            {dayTasks.filter((t) => !t.time).map((t) => (
              <button
                key={`ad-${t.id}`}
                className="mobile-day-allday-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setDetailTask(t);
                }}
              >
                {t.title}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const headerText = view === 'month'
    ? (isDesktop
        ? format(currentDate, 'MMMM yyyy', { locale: de })
        : format(selectedDate || currentDate, 'EEEE, d. MMMM yyyy', { locale: de }))
    : view === 'day'
      ? format(selectedDate || currentDate, 'EEEE, d. MMMM yyyy', { locale: de })
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
              onClick={() => {
                const today = new Date();
                setCurrentDate(today);
                setSelectedDate(today);
              }}
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
                  const nextDate = setYear(setMonth(currentDate, i), pickerYear);
                  setCurrentDate(nextDate);
                  setSelectedDate(nextDate);
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
      ) : view === 'day' ? (
        renderMobileDayView()
      ) : (
        renderWeekView()
      )}

      {!isDesktop && (
        <div className="mobile-calendar-modebar">
          <div className="mobile-calendar-modebar-tabs">
            <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>DAY</button>
            <button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>WEEK</button>
            <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>MONTH</button>
          </div>
          <button className="mobile-calendar-add-btn" onClick={() => onDayClick?.(selectedDate || new Date())}>
            <Plus size={18} />
          </button>
        </div>
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
