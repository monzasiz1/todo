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

// ── Desktop week-view grid constants (shared by renderer + drag handler) ──
const WK_START = 7;    // first visible hour
const WK_END   = 23;   // last visible hour
const WK_H     = 52;   // px per hour
const MOBILE_BREAKPOINT = 768;
const CALENDAR_DESKTOP_BREAKPOINT = 1180;
const CALENDAR_WEEK_DEFAULT_BREAKPOINT = 1024;

const minsToTime = (mins) => {
  const h = Math.floor(Math.max(0, mins) / 60);
  const m = Math.floor(Math.max(0, mins) % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
};

const timeToMins = (t) => {
  if (!t) return null;
  const [h, m] = String(t).split(':').map((v) => parseInt(v, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

const normalizeCategoryKey = (value) => {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
};

const getEventGlowClass = (task) => {
  if (task?.type !== 'event') return '';
  const key = normalizeCategoryKey(task?.category_name);
  if (key.includes('arbeit')) return 'cal-event-glow-work';
  if (key.includes('persoenlich')) return 'cal-event-glow-personal';
  if (key.includes('gut schlag') || key.includes('gut-schlag')) return 'cal-event-glow-gutschlag';
  return 'cal-event-glow-default';
};

const getTaskEndDate = (task) => {
  if (!task?.date) return null;
  const datePart = String(task.date).slice(0, 10);
  const rawEnd = String(task.time_end || task.time || '23:59').slice(0, 5);
  const parts = rawEnd.split(':');
  const hh = String(Math.min(23, Math.max(0, Number(parts[0]) || 23))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, Number(parts[1]) || 59))).padStart(2, '0');
  const dt = new Date(`${datePart}T${hh}:${mm}:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const isEventEnded = (task, nowTs = Date.now()) => {
  if (task?.type !== 'event') return false;
  const end = getTaskEndDate(task);
  return !!end && end.getTime() < nowTs;
};

// ── Throttle helper for smooth drag ──
const throttle = (fn, delay) => {
  let lastRun = 0;
  return (...args) => {
    const now = Date.now();
    if (now - lastRun >= delay) {
      fn(...args);
      lastRun = now;
    }
  };
};

export default function Calendar({ onDayClick, tasks: tasksProp, onVisibleRangeChange, onTaskUpdated }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [nowTs, setNowTs] = useState(Date.now());
  const [view, setView] = useState(window.innerWidth >= CALENDAR_WEEK_DEFAULT_BREAKPOINT ? 'week' : 'month');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [detailTask, setDetailTask] = useState(null);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showSidebarCategories, setShowSidebarCategories] = useState(true);
  const [pickerYear, setPickerYear] = useState(getYear(new Date()));
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= MOBILE_BREAKPOINT);
  const [isWideDesktopCalendar, setIsWideDesktopCalendar] = useState(window.innerWidth >= CALENDAR_DESKTOP_BREAKPOINT);
  // Drag / Resize state
  const [dragInfo, setDragInfo] = useState(null);
  const [resizeInfo, setResizeInfo] = useState(null); // { task, edge, previewTime }
  const [dropFeedback, setDropFeedback] = useState(null); // { id, msg }
  const dragTaskRef = useRef(null);
  const tasksRef = useRef([]);
  const wasDragging = useRef(false);
  const mobileDayRef = useRef(null);       // ref for mobile day-view time grid
  const mobileWeekColRefs = useRef({});   // ref map for mobile week columns
  const desktopWeekColsRef = useRef(null);
  const resizeInfoRef = useRef(null);

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
    tasksRef.current = tasks;
  }, [tasks]);

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
    const handler = () => {
      setIsDesktop(window.innerWidth >= MOBILE_BREAKPOINT);
      setIsWideDesktopCalendar(window.innerWidth >= CALENDAR_DESKTOP_BREAKPOINT);
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    let intervalId = null;
    let timeoutId = null;

    const syncNow = () => setNowTs(Date.now());
    const startMinuteAlignedTicker = () => {
      const msToNextMinute = 60000 - (Date.now() % 60000) + 30;
      timeoutId = setTimeout(() => {
        syncNow();
        intervalId = setInterval(syncNow, 60000);
      }, msToNextMinute);
    };

    const onVisibilityOrFocus = () => syncNow();

    startMinuteAlignedTicker();
    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
    };
  }, []);

  const isMobile = !isDesktop;

  useEffect(() => {
    if (isMobile) {
      setView('month');
      return;
    }
    if (view === 'day') {
      setView('month');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

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

  const triggerDropFeedback = (taskId, msg = 'Termin verschoben') => {
    setDropFeedback({ id: taskId, msg });
    setTimeout(() => setDropFeedback(null), 1400);
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

    // Record where inside the event card the pointer landed,
    // so the ghost stays visually attached to the right spot
    const cardRect = e.currentTarget.getBoundingClientRect();
    const clickOffsetY = e.clientY - cardRect.top;

    const onMove = (ev) => {
      moved = true;
      wasDragging.current = true;

      // Calculate preview time based on current cursor position
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const col = under?.closest('.desktop-week-day-col');
      let previewTime = null;
      if (col) {
        const colRect = col.getBoundingClientRect();
        const relY = Math.max(0, ev.clientY - colRect.top - clickOffsetY);
        const rawMins = (relY / WK_H) * 60;
        const snapped = Math.round(rawMins / 15) * 15;
        const startMins = Math.max(WK_START * 60, Math.min(WK_END * 60 - 30, WK_START * 60 + snapped));
        previewTime = minsToTime(startMins);
      }

      setDragInfo({ task, x: ev.clientX, y: ev.clientY, previewTime });
      if (!moved) document.body.classList.add('cal-is-dragging');

      document.querySelectorAll('.cal-drag-over').forEach(el => el.classList.remove('cal-drag-over'));
      if (col) col.classList.add('cal-drag-over');
    };

    const onUp = async (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.classList.remove('cal-is-dragging');
      document.querySelectorAll('.cal-drag-over').forEach(el => el.classList.remove('cal-drag-over'));
      const droppedTask = dragTaskRef.current;
      dragTaskRef.current = null;
      setDragInfo(null);
      if (!moved || !droppedTask) { wasDragging.current = false; return; }
      setTimeout(() => { wasDragging.current = false; }, 350);
      const liveTask = tasksRef.current.find((t) => String(t.id) === String(droppedTask.id)) || droppedTask;

      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      // Accept drops on time columns AND all-day cells
      const col = under?.closest('.desktop-week-day-col') || under?.closest('[data-caldate]');
      if (!col) return;

      const targetDateStr = col.dataset.caldate;
      if (!targetDateStr) return;
      const oldDateStr = liveTask.date?.substring(0, 10);

      const updates = {};

      // ── Date shift ─────────────────────────────────────────────
      if (targetDateStr !== oldDateStr) {
        updates.date = targetDateStr;
        if (liveTask.date_end && oldDateStr) {
          const delta = differenceInCalendarDays(parseISO(targetDateStr), parseISO(oldDateStr));
          const oldEnd = parseISO(liveTask.date_end.substring(0, 10));
          updates.date_end = format(addDays(oldEnd, delta), 'yyyy-MM-dd');
        }
      }

      // ── Time shift (only in the timed grid, not the all-day strip) ─
      const isTimeCol = col.classList.contains('desktop-week-day-col');
      if (isTimeCol && liveTask.time) {
        const colRect = col.getBoundingClientRect();
        const relY = Math.max(0, ev.clientY - colRect.top - clickOffsetY);
        const rawMins = (relY / WK_H) * 60;
        const snapped = Math.round(rawMins / 15) * 15;
        const newStartMins = Math.max(WK_START * 60, Math.min(WK_END * 60 - 30, WK_START * 60 + snapped));

        const oldStartMins = timeToMins(liveTask.time) ?? (WK_START * 60);
        if (newStartMins !== oldStartMins) {
          updates.time = minsToTime(newStartMins);
          if (liveTask.time_end) {
            const oldEndMins = timeToMins(liveTask.time_end) ?? (oldStartMins + 60);
            const duration = Math.max(30, oldEndMins - oldStartMins);
            updates.time_end = minsToTime(Math.min(WK_END * 60, newStartMins + duration));
          }
        }
      }

      if (Object.keys(updates).length === 0) return;

      const updated = await updateTask(liveTask.id, updates);
      if (updated && onTaskUpdated) {
        onTaskUpdated(updated);
      }
      if (updated) triggerDropFeedback(liveTask.id);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  // ── Mobile Day view — drag to move (Y = time, X = swipe = change day) ─────
  const handleMobileEventPointerDown = (e, task, gridEl, hourH, startH) => {
    e.stopPropagation();
    e.preventDefault();
    dragTaskRef.current = task;
    let moved = false;
    let swipeDay = 0; // -1 = prev, 0 = same, +1 = next
    const endH = 23;
    const cardRect = e.currentTarget.getBoundingClientRect();
    const clickOffsetY = e.clientY - cardRect.top;
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        moved = true;
        document.body.classList.add('cal-is-dragging');
      }
      if (!moved) return;
      wasDragging.current = true;

      // Horizontal swipe detection
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        swipeDay = dx > 0 ? -1 : 1;
        setDragInfo({ task, x: ev.clientX, y: ev.clientY, previewTime: swipeDay < 0 ? '← Vorheriger Tag' : 'Nächster Tag →' });
        return;
      }
      swipeDay = 0;
      if (!gridEl) return;
      const gr = gridEl.getBoundingClientRect();
      const relY = Math.max(0, ev.clientY - gr.top - clickOffsetY);
      const snapped = Math.round(((relY / hourH) * 60) / 15) * 15;
      const sMins = Math.max(startH * 60, Math.min(endH * 60 - 30, startH * 60 + snapped));
      setDragInfo({ task, x: ev.clientX, y: ev.clientY, previewTime: minsToTime(sMins) });
    };

    const onUp = async (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.classList.remove('cal-is-dragging');
      const dropped = dragTaskRef.current;
      dragTaskRef.current = null;
      setDragInfo(null);
      if (!moved || !dropped) { wasDragging.current = false; return; }
      setTimeout(() => { wasDragging.current = false; }, 350);
      const liveTask = tasksRef.current.find((t) => String(t.id) === String(dropped.id)) || dropped;

      // Horizontal swipe → move to prev/next day
      if (swipeDay !== 0) {
        const oldDate = liveTask.date?.substring(0, 10);
        if (!oldDate) return;
        const newDate = format(addDays(parseISO(oldDate), swipeDay), 'yyyy-MM-dd');
        const updates = { date: newDate };
        if (liveTask.date_end) {
          updates.date_end = format(addDays(parseISO(liveTask.date_end.substring(0, 10)), swipeDay), 'yyyy-MM-dd');
        }
        const updated = await updateTask(liveTask.id, updates);
        if (updated && onTaskUpdated) onTaskUpdated(updated);
        if (updated) triggerDropFeedback(liveTask.id, swipeDay < 0 ? 'Auf Vortag verschoben' : 'Auf nächsten Tag verschoben');
        const nd = parseISO(newDate);
        setSelectedDate(nd);
        setCurrentDate(nd);
        return;
      }

      if (!gridEl) return;
      const gr = gridEl.getBoundingClientRect();
      const relY = Math.max(0, ev.clientY - gr.top - clickOffsetY);
      const snapped = Math.round(((relY / hourH) * 60) / 15) * 15;
      const newStart = Math.max(startH * 60, Math.min(endH * 60 - 30, startH * 60 + snapped));
      const oldStart = timeToMins(liveTask.time) ?? (startH * 60);
      if (newStart === oldStart) return;
      const updates = { time: minsToTime(newStart) };
      if (liveTask.time_end) {
        const dur = Math.max(30, (timeToMins(liveTask.time_end) ?? (oldStart + 60)) - oldStart);
        updates.time_end = minsToTime(Math.min(endH * 60, newStart + dur));
      }
      const updated = await updateTask(liveTask.id, updates);
      if (updated && onTaskUpdated) onTaskUpdated(updated);
      if (updated) triggerDropFeedback(liveTask.id);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  // ── Mobile Week view — drag to move (Y = time, X = day column) ────
  const handleMobileWeekEventPointerDown = (e, task, colIdx, days) => {
    e.stopPropagation();
    e.preventDefault();
    dragTaskRef.current = task;
    let moved = false;
    const hourH = 40; const startH = 7; const endH = 23;
    const colEl = mobileWeekColRefs.current[colIdx];
    if (!colEl) return;
    const cardRect = e.currentTarget.getBoundingClientRect();
    const clickOffsetY = e.clientY - cardRect.top;

    const getTargetCol = (ev) => {
      let idx = colIdx;
      Object.entries(mobileWeekColRefs.current).forEach(([i, el]) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right) idx = parseInt(i);
      });
      return idx;
    };

    const onMove = (ev) => {
      moved = true;
      wasDragging.current = true;
      const targetIdx = getTargetCol(ev);
      const tEl = mobileWeekColRefs.current[targetIdx] || colEl;
      const gr = tEl.getBoundingClientRect();
      const relY = Math.max(0, ev.clientY - gr.top - clickOffsetY);
      const snapped = Math.round(((relY / hourH) * 60) / 15) * 15;
      const sMins = Math.max(startH * 60, Math.min(endH * 60 - 30, startH * 60 + snapped));
      setDragInfo({ task, x: ev.clientX, y: ev.clientY, previewTime: minsToTime(sMins) });
      if (!moved) document.body.classList.add('cal-is-dragging');
      document.querySelectorAll('.mobile-week-grid-col').forEach(el => el.classList.remove('cal-drag-over'));
      const hEl = mobileWeekColRefs.current[targetIdx];
      if (hEl) hEl.classList.add('cal-drag-over');
    };

    const onUp = async (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.classList.remove('cal-is-dragging');
      document.querySelectorAll('.mobile-week-grid-col').forEach(el => el.classList.remove('cal-drag-over'));
      const dropped = dragTaskRef.current;
      dragTaskRef.current = null;
      setDragInfo(null);
      if (!moved || !dropped) { wasDragging.current = false; return; }
      setTimeout(() => { wasDragging.current = false; }, 350);
      const liveTask = tasksRef.current.find((t) => String(t.id) === String(dropped.id)) || dropped;

      const targetIdx = getTargetCol(ev);
      const tEl = mobileWeekColRefs.current[targetIdx] || colEl;
      const gr = tEl.getBoundingClientRect();
      const relY = Math.max(0, ev.clientY - gr.top - clickOffsetY);
      const snapped = Math.round(((relY / hourH) * 60) / 15) * 15;
      const newStart = Math.max(startH * 60, Math.min(endH * 60 - 30, startH * 60 + snapped));
      const oldStart = timeToMins(liveTask.time) ?? (startH * 60);
      const updates = {};

      if (newStart !== oldStart) {
        updates.time = minsToTime(newStart);
        if (liveTask.time_end) {
          const dur = Math.max(30, (timeToMins(liveTask.time_end) ?? (oldStart + 60)) - oldStart);
          updates.time_end = minsToTime(Math.min(endH * 60, newStart + dur));
        }
      }
      if (targetIdx !== colIdx) {
        const newDate = format(days[targetIdx], 'yyyy-MM-dd');
        const oldDate = liveTask.date?.substring(0, 10);
        if (newDate !== oldDate) {
          updates.date = newDate;
          if (liveTask.date_end && oldDate) {
            const delta = differenceInCalendarDays(parseISO(newDate), parseISO(oldDate));
            updates.date_end = format(addDays(parseISO(liveTask.date_end.substring(0, 10)), delta), 'yyyy-MM-dd');
          }
        }
      }
      if (!Object.keys(updates).length) return;
      const updated = await updateTask(liveTask.id, updates);
      if (updated && onTaskUpdated) onTaskUpdated(updated);
      if (updated) triggerDropFeedback(liveTask.id);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  // ── Date extend handle — drag left/right edge to change date_start / date_end ──
  const handleDateExtendPointerDown = (e, task, edge) => {
    e.stopPropagation();
    e.preventDefault();
    wasDragging.current = true; // block click immediately
    const startX = e.clientX;
    const PX_PER_DAY = 65; // pixels to drag before day changes
    let lastDelta = 0;
    let previewDelta = 0;
    let previewLabel = edge === 'end' ? 'Enddatum' : 'Startdatum';

    const de = document.body.querySelectorAll ? null : null; // unused, just clarity

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      previewDelta = Math.round(dx / PX_PER_DAY) * (edge === 'end' ? 1 : -1);
      setDragInfo({ task, x: ev.clientX, y: ev.clientY, previewTime: `${edge === 'end' ? '⇥' : '⇤'} ${previewLabel}` });
      if (previewDelta === lastDelta) return;
      lastDelta = previewDelta;

      const baseDate = edge === 'end'
        ? (task.date_end || task.date)?.substring(0, 10)
        : task.date?.substring(0, 10);
      if (!baseDate) return;

      const previewDate = format(addDays(parseISO(baseDate), previewDelta), 'yyyy-MM-dd');
      previewLabel = format(parseISO(previewDate), 'EEE d. MMM', { locale: de });
      setResizeInfo({ task, edge: edge === 'end' ? 'date-end' : 'date-start', previewTime: previewLabel, previewDelta });
    };

    const onUp = async () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      setDragInfo(null);
      setResizeInfo(null);
      if (previewDelta === 0) { setTimeout(() => { wasDragging.current = false; }, 350); return; }
      setTimeout(() => { wasDragging.current = false; }, 350);
      wasDragging.current = true;

      if (edge === 'end') {
        const base = (task.date_end || task.date)?.substring(0, 10);
        if (!base) return;
        const newEnd = format(addDays(parseISO(base), previewDelta), 'yyyy-MM-dd');
        const startD = task.date?.substring(0, 10);
        if (startD && newEnd < startD) return; // can't end before start
        const updated = await updateTask(task.id, { date_end: newEnd });
        if (updated && onTaskUpdated) onTaskUpdated(updated);
        if (updated) triggerDropFeedback(task.id, 'Enddatum geändert');
      } else {
        const base = task.date?.substring(0, 10);
        if (!base) return;
        const newStart = format(addDays(parseISO(base), -previewDelta), 'yyyy-MM-dd');
        const endD = (task.date_end || task.date)?.substring(0, 10);
        if (endD && newStart > endD) return; // can't start after end
        const updated = await updateTask(task.id, { date: newStart });
        if (updated && onTaskUpdated) onTaskUpdated(updated);
        if (updated) triggerDropFeedback(task.id, 'Startdatum geändert');
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  // ── Resize handle — drag edge to change start/end time ────────────
  const handleResizePointerDown = (e, task, edge, gridEl, hourH, startH) => {
    e.stopPropagation();
    e.preventDefault();
    wasDragging.current = true;
    const endH = 23;
    resizeInfoRef.current = null;

    const onMove = throttle((ev) => {
      if (!gridEl) return;
      const gr = gridEl.getBoundingClientRect();
      const relY = Math.max(0, ev.clientY - gr.top);
      
      // Berechne die Minute exakt: relY ist Pixel ab startH
      // Minuten ab startH = (relY / hourH) * 60
      const minsFromStart = Math.round(((relY / hourH) * 60) / 15) * 15;
      const totalMins = Math.max(startH * 60, Math.min(endH * 60, startH * 60 + minsFromStart));
      
      const newTime = minsToTime(totalMins);
      resizeInfoRef.current = { task, edge, previewTime: newTime };
      setResizeInfo({ task, edge, previewTime: newTime });
    }, 40); // Throttle to 40ms for smooth performance

    const onUp = async () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const info = resizeInfoRef.current;
      resizeInfoRef.current = null;
      setResizeInfo(null);
      if (!info) { setTimeout(() => { wasDragging.current = false; }, 350); return; }
      
      const { task: t, edge: ed, previewTime } = info;
      const sMins = timeToMins(t.time) ?? ((startH ?? 7) * 60);
      const eMins = timeToMins(t.time_end) ?? (sMins + 60);
      const newMins = timeToMins(previewTime);
      
      if (newMins == null) { setTimeout(() => { wasDragging.current = false; }, 350); return; }
      
      const updates = {};
      if (ed === 'end' && newMins > sMins + 14) {
        updates.time_end = previewTime;
      } else if (ed === 'start' && newMins < eMins - 14) {
        updates.time = previewTime;
      }
      
      if (!Object.keys(updates).length) { setTimeout(() => { wasDragging.current = false; }, 350); return; }
      
      const updated = await updateTask(t.id, updates);
      if (updated && onTaskUpdated) onTaskUpdated(updated);
      if (updated) triggerDropFeedback(t.id, 'Zeit angepasst');
      setTimeout(() => { wasDragging.current = false; }, 350);
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
                    (() => {
                      const ended = isEventEnded(t, nowTs);
                      return (
                    <div
                      key={t.id}
                      className={`calendar-day-task ${t.completed ? 'completed' : ''} ${t.group_id ? 'group-task' : ''} ${ended ? 'ended-event' : ''} ${dragInfo?.task.id === t.id ? 'cal-dragging' : ''}`}
                      style={{
                        background: ended
                          ? 'rgba(142, 142, 147, 0.12)'
                          : t.group_id
                          ? `${t.group_color || '#5856D6'}15`
                          : t.category_color ? `${t.category_color}20` : 'var(--primary-bg)',
                        color: ended
                          ? '#59606B'
                          : t.group_id
                          ? (t.group_color || '#5856D6')
                          : t.category_color || 'var(--primary)',
                        borderLeft: `2px solid ${ended ? 'rgba(142, 142, 147, 0.55)' : (t.group_id ? (t.group_color || '#5856D6') : (t.category_color || 'var(--primary)'))}`,
                        cursor: isDesktop && !ended ? 'grab' : 'pointer',
                        userSelect: 'none',
                      }}
                      onPointerDown={isDesktop && !ended ? (e) => handlePointerDown(e, t) : undefined}
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
                      {ended && <span className="calendar-day-task-ended">Beendet</span>}
                    </div>
                      );
                    })()
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
    const weekStartStr = format(weekStart, 'yyyy-MM-dd');
    const weekEndStr = format(days[6], 'yyyy-MM-dd');

    const startHour = WK_START;
    const endHour = WK_END;
    const hourHeight = WK_H;
    const totalHeight = (endHour - startHour) * hourHeight;
    const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
    const now = new Date(nowTs);
    const todayIdx = days.findIndex((d) => isSameDay(d, now));
    const desktopNowTop =
      todayIdx >= 0
        ? (((now.getHours() * 60 + now.getMinutes()) - (startHour * 60)) / 60) * hourHeight
        : null;
    const timeToMinutes = timeToMins;
    const weekTimedTasks = filteredTasks.filter((t) => {
      if (!t.time || !t.date) return false;
      const taskStart = t.date.substring(0, 10);
      const taskEnd = (t.date_end || t.date).substring(0, 10);
      return taskStart <= weekEndStr && taskEnd >= weekStartStr;
    });

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
                    (() => {
                      const ended = isEventEnded(t, nowTs);
                      return (
                    <button
                      key={t.id}
                      className={`desktop-week-all-day-event${getEventGlowClass(t) ? ` ${getEventGlowClass(t)}` : ''}${ended ? ' ended-event' : ''}`}
                      style={{ background: ended ? 'rgba(142, 142, 147, 0.4)' : (t.group_color || t.category_color || '#4C7BD9') }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailTask(t);
                      }}
                    >
                      {t.title}{ended ? ' · beendet' : ''}
                    </button>
                      );
                    })()
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

            <div className="desktop-week-columns" ref={desktopWeekColsRef}>
              {days.map((d) => {
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
                  </div>
                );
              })}

              <div className="desktop-week-events-layer" style={{ height: `${totalHeight}px` }}>
                {desktopNowTop !== null && desktopNowTop >= 0 && desktopNowTop <= totalHeight && (
                  <div
                    className="desktop-week-now-line"
                    style={{
                      top: `${desktopNowTop}px`,
                      left: `calc((100% / 7) * ${todayIdx} + 4px)`,
                      width: 'calc((100% / 7) - 8px)',
                    }}
                  >
                    <span>{`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`}</span>
                  </div>
                )}
                {weekTimedTasks.map((t) => {
                  const ended = isEventEnded(t, nowTs);
                  const startMins = timeToMinutes(t.time) ?? (startHour * 60);
                  const rawEnd = timeToMinutes(t.time_end);
                  const endMins = rawEnd && rawEnd > startMins ? rawEnd : startMins + 60;
                  const clampedStart = Math.max(startHour * 60, startMins);
                  const clampedEnd = Math.min(endHour * 60, endMins);

                  // Live-resize preview (time)
                  let liveCStart = clampedStart;
                  let liveCEnd = clampedEnd;
                  const isResizingThis = resizeInfo?.task.id === t.id;
                  if (isResizingThis) {
                    const nm = timeToMins(resizeInfo.previewTime);
                    if (nm != null) {
                      if (resizeInfo.edge === 'end') liveCEnd = Math.max(clampedStart + 15, Math.min(endHour * 60, nm));
                      else if (resizeInfo.edge === 'start') liveCStart = Math.min(clampedEnd - 15, Math.max(startHour * 60, nm));
                    }
                  }

                  const taskStart = t.date?.substring(0, 10);
                  const taskEnd = (t.date_end || t.date)?.substring(0, 10);
                  if (!taskStart || !taskEnd) return null;

                  let liveSpanStart = taskStart < weekStartStr ? weekStartStr : taskStart;
                  let liveSpanEnd = taskEnd > weekEndStr ? weekEndStr : taskEnd;

                  // Live-resize preview (date span)
                  if (isResizingThis && (resizeInfo.edge === 'date-start' || resizeInfo.edge === 'date-end')) {
                    const delta = Number(resizeInfo.previewDelta || 0);
                    if (resizeInfo.edge === 'date-end' && delta !== 0) {
                      const fullEnd = format(addDays(parseISO(taskEnd), delta), 'yyyy-MM-dd');
                      liveSpanEnd = fullEnd > weekEndStr ? weekEndStr : fullEnd;
                    }
                    if (resizeInfo.edge === 'date-start' && delta !== 0) {
                      const fullStart = format(addDays(parseISO(taskStart), -delta), 'yyyy-MM-dd');
                      liveSpanStart = fullStart < weekStartStr ? weekStartStr : fullStart;
                    }
                    if (liveSpanStart > liveSpanEnd) return null;
                  }

                  const startIdx = differenceInCalendarDays(parseISO(liveSpanStart), parseISO(weekStartStr));
                  const endIdx = differenceInCalendarDays(parseISO(liveSpanEnd), parseISO(weekStartStr));
                  const spanDays = Math.max(1, endIdx - startIdx + 1);

                  const top = ((liveCStart - startHour * 60) / 60) * hourHeight;
                  const height = Math.max(24, ((liveCEnd - liveCStart) / 60) * hourHeight - 2);

                  return (
                    <div
                      key={t.id}
                      className={`desktop-week-event${getEventGlowClass(t) ? ` ${getEventGlowClass(t)}` : ''}${ended ? ' ended-event' : ''}${dragInfo?.task.id === t.id || isResizingThis ? ' cal-dragging' : ''}${dropFeedback?.id === t.id ? ' cal-snap' : ''}`}
                      style={{
                        left: `calc((100% / 7) * ${startIdx} + 4px)`,
                        width: `calc((100% / 7) * ${spanDays} - 8px)`,
                        top: `${top}px`,
                        height: `${height}px`,
                        background: ended ? 'rgba(142, 142, 147, 0.72)' : (t.group_color || t.category_color || '#4C7BD9'),
                        touchAction: 'none',
                      }}
                      onPointerDown={(e) => {
                        if (ended) return;
                        if (e.target.closest('.cal-resize-handle') || e.target.closest('.cal-date-extend-handle')) return;
                        handlePointerDown(e, t);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!wasDragging.current) setDetailTask(t);
                      }}
                    >
                      {!ended && (
                        <div
                          className="cal-resize-handle cal-resize-handle-top"
                          onPointerDown={(e) => handleResizePointerDown(e, t, 'start', desktopWeekColsRef.current, WK_H, WK_START)}
                        />
                      )}
                      {!ended && (
                        <div
                          className="cal-date-extend-handle cal-date-extend-left"
                          onPointerDown={(e) => handleDateExtendPointerDown(e, t, 'start')}
                        />
                      )}
                      <span className="desktop-week-event-title">{t.title}</span>
                      <span className="desktop-week-event-time">{t.time?.slice(0, 5)}{t.time_end ? ` - ${t.time_end.slice(0, 5)}` : ''}</span>
                      {ended && <span className="desktop-week-event-ended">Beendet</span>}
                      {!ended && (
                        <div
                          className="cal-date-extend-handle cal-date-extend-right"
                          onPointerDown={(e) => handleDateExtendPointerDown(e, t, 'end')}
                        />
                      )}
                      {!ended && (
                        <div
                          className="cal-resize-handle cal-resize-handle-bottom"
                          onPointerDown={(e) => handleResizePointerDown(e, t, 'end', desktopWeekColsRef.current, WK_H, WK_START)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Mobile Week compact time grid ────────────────────────────────
  const renderMobileWeekView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const mwStartH = 7; const mwEndH = 23; const mwHourH = 40;
    const mwTotalH = (mwEndH - mwStartH) * mwHourH;
    const mwHours = Array.from({ length: mwEndH - mwStartH }, (_, i) => mwStartH + i);

    return (
      <div className="mobile-week-grid-wrap">
        {/* day headers */}
        <div className="mobile-week-grid-header">
          <div className="mobile-week-grid-tlabel" />
          {days.map((d) => (
            <div
              key={`mwh-${d.toISOString()}`}
              className={`mobile-week-grid-day-head ${isToday(d) ? 'today' : ''} ${selectedDate && isSameDay(d, selectedDate) ? 'selected' : ''}`}
              onClick={() => handleDayClick(d)}
            >
              <span className="mobile-week-grid-day-name">{format(d, 'EEE', { locale: de })}</span>
              <span className="mobile-week-grid-day-num">{format(d, 'd')}</span>
            </div>
          ))}
        </div>

        {/* scrollable time grid */}
        <div className="mobile-week-grid-scroll">
          {/* hour labels */}
          <div className="mobile-week-grid-hours" style={{ height: `${mwTotalH}px` }}>
            {mwHours.map((h) => (
              <div key={`mwhl-${h}`} className="mobile-week-grid-hour-label" style={{ top: `${(h - mwStartH) * mwHourH}px` }}>
                {String(h).padStart(2, '0')}
              </div>
            ))}
          </div>

          {/* day columns */}
          <div className="mobile-week-grid-cols">
            {days.map((d, di) => {
              const dayTasks = getTasksForDate(d).filter((t) => t.time);
              return (
                <div
                  key={`mwcol-${d.toISOString()}`}
                  ref={(el) => { if (el) mobileWeekColRefs.current[di] = el; }}
                  className={`mobile-week-grid-col ${isToday(d) ? 'today' : ''}`}
                  data-caldate={format(d, 'yyyy-MM-dd')}
                  style={{ height: `${mwTotalH}px` }}
                  onClick={() => handleDayClick(d)}
                >
                  {mwHours.map((h) => (
                    <div key={`${di}-${h}`} className="mobile-week-grid-hour-line" style={{ top: `${(h - mwStartH) * mwHourH}px` }} />
                  ))}
                  {dayTasks.map((t) => {
                    const ended = isEventEnded(t, nowTs);
                    const sMins = timeToMins(t.time) ?? (mwStartH * 60);
                    const rawEnd = timeToMins(t.time_end);
                    const eMins = rawEnd && rawEnd > sMins ? rawEnd : sMins + 60;
                    const cStart = Math.max(mwStartH * 60, sMins);
                    const cEnd   = Math.min(mwEndH * 60, eMins);

                    // Live-resize preview
                    let liveCStart = cStart; let liveCEnd = cEnd;
                    const isResizingThis = resizeInfo?.task.id === t.id;
                    if (isResizingThis) {
                      const nm = timeToMins(resizeInfo.previewTime);
                      if (nm != null) {
                        if (resizeInfo.edge === 'end') liveCEnd = Math.max(cStart + 15, Math.min(mwEndH * 60, nm));
                        else liveCStart = Math.min(cEnd - 15, Math.max(mwStartH * 60, nm));
                      }
                    }

                    const top    = ((liveCStart - mwStartH * 60) / 60) * mwHourH;
                    const height = Math.max(16, ((liveCEnd - liveCStart) / 60) * mwHourH - 2);

                    return (
                      <div
                        key={t.id}
                        className={`mobile-week-event${getEventGlowClass(t) ? ` ${getEventGlowClass(t)}` : ''}${ended ? ' ended-event' : ''}${dragInfo?.task.id === t.id || isResizingThis ? ' cal-dragging' : ''}${dropFeedback?.id === t.id ? ' cal-snap' : ''}`}
                        style={{
                          top: `${top}px`, height: `${height}px`,
                          background: ended ? 'rgba(142, 142, 147, 0.72)' : (t.group_color || t.category_color || '#4C7BD9'),
                          touchAction: 'none',
                        }}
                        onPointerDown={(e) => {
                          if (ended) return;
                          if (e.target.closest('.cal-resize-handle')) return;
                          handleMobileWeekEventPointerDown(e, t, di, days);
                        }}
                        onClick={(e) => { e.stopPropagation(); if (!wasDragging.current) setDetailTask(t); }}
                      >
                        {!ended && (
                          <div
                            className="cal-resize-handle cal-resize-handle-top"
                            onPointerDown={(e) => handleResizePointerDown(e, t, 'start', mobileWeekColRefs.current[di], mwHourH, mwStartH)}
                          />
                        )}
                        <span className="mobile-week-event-title">{t.title}</span>
                        {height > 28 && <span className="mobile-week-event-time">{t.time?.slice(0, 5)}</span>}
                        {ended && height > 22 && <span className="mobile-week-event-ended">Beendet</span>}
                        {!ended && (
                          <div
                            className="cal-resize-handle cal-resize-handle-bottom"
                            onPointerDown={(e) => handleResizePointerDown(e, t, 'end', mobileWeekColRefs.current[di], mwHourH, mwStartH)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    if (isWideDesktopCalendar) return renderDesktopWeekView();
    return renderMobileWeekView();
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

    const now = new Date(nowTs);
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
        <div className="mobile-day-grid" ref={mobileDayRef} style={{ height: `${totalHeight}px` }} onClick={handleGridClick}>
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
            const ended = isEventEnded(t, nowTs);
            const start = toMinutes(t.time) ?? (startHour * 60);
            const endRaw = toMinutes(t.time_end);
            const end = endRaw && endRaw > start ? endRaw : start + 60;
            const clampedStart = Math.max(startHour * 60, start);
            const clampedEnd = Math.min(endHour * 60, end);

            // Live-resize preview
            let liveClampedStart = clampedStart;
            let liveClampedEnd = clampedEnd;
            const isResizingThis = resizeInfo?.task.id === t.id;
            if (isResizingThis) {
              const newMins = timeToMins(resizeInfo.previewTime);
              if (newMins != null) {
                if (resizeInfo.edge === 'end') liveClampedEnd = Math.max(clampedStart + 15, Math.min(endHour * 60, newMins));
                else liveClampedStart = Math.min(clampedEnd - 15, Math.max(startHour * 60, newMins));
              }
            }

            const top    = ((liveClampedStart - startHour * 60) / 60) * hourHeight;
            const height = Math.max(36, ((liveClampedEnd - liveClampedStart) / 60) * hourHeight - 4);

            return (
              <div
                key={t.id}
                className={`mobile-day-event${getEventGlowClass(t) ? ` ${getEventGlowClass(t)}` : ''}${ended ? ' ended-event' : ''}${dragInfo?.task.id === t.id || isResizingThis ? ' cal-dragging' : ''}${dropFeedback?.id === t.id ? ' cal-snap' : ''}`}
                style={{
                  top: `${top}px`,
                  height: `${height}px`,
                  background: ended ? 'rgba(142, 142, 147, 0.72)' : (t.group_color || t.category_color || '#4C7BD9'),
                  touchAction: 'none',
                  cursor: ended ? 'pointer' : 'grab',
                }}
                onPointerDown={(e) => {
                  if (ended) return;
                  if (e.target.closest('.cal-resize-handle')) return;
                  handleMobileEventPointerDown(e, t, mobileDayRef.current, hourHeight, startHour);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!wasDragging.current) setDetailTask(t);
                }}
              >
                {!ended && (
                  <div
                    className="cal-resize-handle cal-resize-handle-top"
                    onPointerDown={(e) => handleResizePointerDown(e, t, 'start', mobileDayRef.current, hourHeight, startHour)}
                  />
                )}
                <strong>{t.title}</strong>
                <span>{t.time?.slice(0, 5)}{t.time_end ? `-${t.time_end.slice(0, 5)}` : ''}</span>
                {ended && <span className="mobile-day-event-ended">Beendet</span>}
                {(t.date_end && t.date_end !== t.date) && (
                  <span style={{ fontSize: 10, opacity: 0.8 }}>
                    {format(parseISO(t.date?.substring(0,10)), 'd.M.')} – {format(parseISO(t.date_end.substring(0,10)), 'd.M.')}
                  </span>
                )}
                {!ended && (
                  <div
                    className="cal-resize-handle cal-resize-handle-bottom"
                    onPointerDown={(e) => handleResizePointerDown(e, t, 'end', mobileDayRef.current, hourHeight, startHour)}
                  />
                )}
              </div>
            );
          })}
        </div>

        {dayTasks.filter((t) => !t.time).length > 0 && (
          <div className="mobile-day-allday">
            {dayTasks.filter((t) => !t.time).map((t) => (
              <button
                key={`ad-${t.id}`}
                className={`mobile-day-allday-item ${isEventEnded(t, nowTs) ? 'ended-event' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDetailTask(t);
                }}
              >
                {t.title}{isEventEnded(t, nowTs) ? ' · beendet' : ''}
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

      {isMobile && (
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
          <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{dragInfo.task.title}</div>
          {dragInfo.previewTime && (
            <div style={{ fontSize: '0.68rem', opacity: 0.75, marginTop: 2 }}>{dragInfo.previewTime}</div>
          )}
        </div>,
        document.body
      )}

      {/* Resize time preview badge */}
      {resizeInfo && createPortal(
        <div className="cal-resize-preview">
          {resizeInfo.edge === 'date-end' ? '⇥' : resizeInfo.edge === 'date-start' ? '⇤' : resizeInfo.edge === 'start' ? '▲' : '▼'} {resizeInfo.previewTime}
        </div>,
        document.body
      )}

      {/* Drop feedback toast */}
      {dropFeedback && createPortal(
        <div key={dropFeedback.id + dropFeedback.msg} className="cal-drop-toast">
          ✓ {dropFeedback.msg}
        </div>,
        document.body
      )}
    </motion.div>
  );
}
