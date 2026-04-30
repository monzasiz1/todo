import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import TaskDetailModal from './TaskDetailModal';
import { useOpenTask } from '../hooks/useOpenTask';
import { useTaskStore } from '../store/taskStore';
import { ChevronLeft, ChevronRight, ChevronDown, Maximize2, Minimize2, Video, Settings } from 'lucide-react';
import DayCreateModal from './DayCreateModal';
import AvatarBadge from './AvatarBadge';
import { FEDERAL_STATES, getGermanHolidaysInRange } from '../utils/holidays';
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

// â”€â”€ Desktop week-view grid constants (shared by renderer + drag handler) â”€â”€
const WK_START = 6;    // first visible hour
const WK_END   = 24;   // last visible hour (midnight)
const WK_H     = 64;   // px per hour
const MOBILE_BREAKPOINT = 768;
const CALENDAR_DESKTOP_BREAKPOINT = 1180;
const CALENDAR_WEEK_DEFAULT_BREAKPOINT = 1024;
const DEFAULT_HOLIDAY_COLOR = '#D92C2C';
const CALENDAR_HOLIDAY_STATE_KEY = 'beequ_calendar_holiday_state';
const CALENDAR_HOLIDAY_COLOR_KEY = 'beequ_calendar_holiday_color';

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

const isAllDayTask = (task) => {
  if (!task) return false;
  if (task.all_day === true) return true;
  return !String(task.time || '').trim();
};

const isHolidayEntry = (task) => task?.isHoliday === true;

const buildOverlapLaneMap = (tasks, getRange) => {
  const normalized = (Array.isArray(tasks) ? tasks : [])
    .map((task) => {
      const range = getRange?.(task);
      if (!range) return null;
      const start = Number(range.start);
      const end = Number(range.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      return {
        id: String(task.id),
        start,
        end: Math.max(start + 1, end),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.start - b.start) || (a.end - b.end));

  const laneMap = new Map();
  let active = [];
  let clusterIds = new Set();
  let clusterMaxLane = -1;

  const flushCluster = () => {
    if (clusterIds.size === 0) return;
    const laneCount = Math.max(1, clusterMaxLane + 1);
    clusterIds.forEach((id) => {
      const existing = laneMap.get(id) || { lane: 0, laneCount: 1 };
      laneMap.set(id, { ...existing, laneCount });
    });
    clusterIds = new Set();
    clusterMaxLane = -1;
  };

  normalized.forEach((entry) => {
    active = active.filter((activeEntry) => activeEntry.end > entry.start);
    if (active.length === 0) {
      flushCluster();
    }

    const usedLanes = new Set(active.map((activeEntry) => activeEntry.lane));
    let lane = 0;
    while (usedLanes.has(lane)) lane += 1;

    const current = { id: entry.id, lane, end: entry.end };
    active.push(current);
    laneMap.set(entry.id, { lane, laneCount: 1 });

    clusterIds.add(entry.id);
    active.forEach((activeEntry) => {
      clusterIds.add(activeEntry.id);
      if (activeEntry.lane > clusterMaxLane) clusterMaxLane = activeEntry.lane;
    });
  });

  flushCluster();
  return laneMap;
};

// â”€â”€ Performance helpers for smooth rendering â”€â”€
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

const debounce = (fn, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

// â”€â”€ Universal animation preferences for all devices â”€â”€
const getAnimationProps = (deviceType = 'desktop') => {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isSlowDevice = window.navigator.hardwareConcurrency <= 2; // Low-core devices
  const isMobile = deviceType === 'mobile';
  const isTablet = deviceType === 'tablet';
  const isLowPower = isMobile || isTablet || isSlowDevice || prefersReducedMotion;
  
  return {
    duration: isLowPower ? 0.15 : 0.25, // Faster for all devices
    enabled: !prefersReducedMotion,
    easingTouch: [0.25, 0.46, 0.45, 0.94], // Touch-optimized
    easingDesktop: [0.4, 0, 0.2, 1], // Desktop-optimized
    easingTablet: [0.33, 0.1, 0.15, 1] // Tablet-optimized
  };
};

// â”€â”€ Memoized calendar sources calculation â”€â”€
const calculateCalendarSources = (tasks) => {
  const map = new Map();
  tasks.forEach((t) => {
    const source = getTaskSource(t);
    if (!map.has(source.key)) {
      map.set(source.key, source);
    }
  });
  return Array.from(map.values());
};

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

export default function Calendar({ onDayClick, tasks: tasksProp, onVisibleRangeChange, onTaskUpdated, onTaskCreated }) {
  // â”€â”€ Optimized state management for tablets â”€â”€
  const [currentDate, setCurrentDate] = useState(new Date());
  const [nowTs, setNowTs] = useState(Date.now());
  const [view, setView] = useState(window.innerWidth >= CALENDAR_WEEK_DEFAULT_BREAKPOINT ? 'week' : 'month');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const { detailTask, openTask, closeTask } = useOpenTask();
  const [showDayModal, setShowDayModal] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showHolidaySettings, setShowHolidaySettings] = useState(false);
  const [showSidebarCategories, setShowSidebarCategories] = useState(true);
  const [isCalendarFullscreen, setIsCalendarFullscreen] = useState(false);
  const [pickerYear, setPickerYear] = useState(getYear(new Date()));
  const [holidayStateCode, setHolidayStateCode] = useState(() => {
    try {
      return localStorage.getItem(CALENDAR_HOLIDAY_STATE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [holidayColor, setHolidayColorState] = useState(() => {
    try {
      return localStorage.getItem(CALENDAR_HOLIDAY_COLOR_KEY) || DEFAULT_HOLIDAY_COLOR;
    } catch {
      return DEFAULT_HOLIDAY_COLOR;
    }
  });
  const setHolidayColor = useCallback((color) => {
    setHolidayColorState(color);
    try { localStorage.setItem(CALENDAR_HOLIDAY_COLOR_KEY, color); } catch { /* ignore */ }
  }, []);
  
  // â”€â”€ Debounced viewport state for tablet stability â”€â”€
  const [viewportState, setViewportState] = useState({
    isDesktop: window.innerWidth >= MOBILE_BREAKPOINT,
    isWideDesktopCalendar: window.innerWidth >= CALENDAR_DESKTOP_BREAKPOINT
  });
  // Drag / Resize state
  const [dragInfo, setDragInfo] = useState(null);
  const [resizeInfo, setResizeInfo] = useState(null); // { task, edge, previewTime }
  const [dropFeedback, setDropFeedback] = useState(null); // { id, msg }
  const dragTaskRef = useRef(null);
  const tasksRef = useRef([]);
  const wasDragging = useRef(false);
  const mobileDayRef = useRef(null);
  const mobileWeekColRefs = useRef({});
  const desktopWeekColsRef = useRef(null);
  const desktopWeekWrapRef = useRef(null);
  const calendarWrapperRef = useRef(null);
  const resizeInfoRef = useRef(null);
  const wkHRef = useRef(WK_H); // dynamic hour height, updated by ResizeObserver
  const [wkHState, setWkHState] = useState(WK_H);
  const swipeRef = useRef({ startX: 0, startY: 0 });

  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const { tasks: storeTasks, updateTask } = useTaskStore();
  const tasks = Array.isArray(tasksProp) ? tasksProp : storeTasks;

  // â”€â”€ Memoized calendar sources with performance optimization â”€â”€
  const calendarSources = useMemo(() => calculateCalendarSources(tasks), [tasks]);

  const [visibleSources, setVisibleSources] = useState({});

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    try {
      localStorage.setItem(CALENDAR_HOLIDAY_STATE_KEY, holidayStateCode);
    } catch {
      // Ignore storage write failures.
    }
  }, [holidayStateCode]);

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

  // -- Stale-tasks ref: keep last non-empty tasks so calendar never goes blank during navigation --
  const staleTasksRef = useRef([]);

  // -- Optimized filteredTasks for all devices --
  const filteredTasks = useMemo(() => {
    // Use stale tasks if current tasks is temporarily empty (e.g. during fetch after navigation)
    const source = tasks.length > 0 ? tasks : staleTasksRef.current;
    const result = source.filter((t) => {
      const s = getTaskSource(t);
      return visibleSources[s.key] !== false;
    });
    // Update stale cache whenever we have real data
    if (tasks.length > 0) staleTasksRef.current = tasks;
    return result;
  }, [tasks, visibleSources]);

  // â”€â”€ Memoized visible range calculation â”€â”€
  const visibleRange = useMemo(() => {
    if (view === 'month') {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      return {
        start: startOfWeek(monthStart, { weekStartsOn: 1 }),
        end: endOfWeek(monthEnd, { weekStartsOn: 1 })
      };
    }
    return {
      start: startOfWeek(currentDate, { weekStartsOn: 1 }),
      end: endOfWeek(currentDate, { weekStartsOn: 1 })
    };
  }, [currentDate, view]);

  const tasksByVisibleDate = useMemo(() => {
    const map = new Map();
    const rangeStartStr = format(visibleRange.start, 'yyyy-MM-dd');
    const rangeEndStr = format(visibleRange.end, 'yyyy-MM-dd');

    filteredTasks.forEach((t) => {
      if (!t?.date) return;
      const taskStart = String(t.date).slice(0, 10);
      const taskEnd = String(t.date_end || t.date).slice(0, 10);
      if (!taskStart || !taskEnd || taskStart > rangeEndStr || taskEnd < rangeStartStr) return;

      let cursor = taskStart < rangeStartStr ? rangeStartStr : taskStart;
      const limit = taskEnd > rangeEndStr ? rangeEndStr : taskEnd;
      while (cursor <= limit) {
        if (!map.has(cursor)) map.set(cursor, []);
        map.get(cursor).push(t);
        cursor = format(addDays(new Date(`${cursor}T00:00:00`), 1), 'yyyy-MM-dd');
      }
    });

    map.forEach((dayTasks, key) => {
      dayTasks.sort((a, b) => {
        const aAllDay = isAllDayTask(a) || !a.time;
        const bAllDay = isAllDayTask(b) || !b.time;
        if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
        if (a.time && b.time) return a.time.localeCompare(b.time);
        if (a.time) return -1;
        if (b.time) return 1;
        return (a.sort_order || 0) - (b.sort_order || 0);
      });
      map.set(key, dayTasks);
    });

    return map;
  }, [filteredTasks, visibleRange]);

  const holidaysByVisibleDate = useMemo(() => {
    const map = new Map();

    getGermanHolidaysInRange(visibleRange.start, visibleRange.end, holidayStateCode).forEach((holiday) => {
      const entry = {
        id: `holiday:${holiday.date}`,
        title: holiday.name,
        date: holiday.date,
        isHoliday: true,
        all_day: true,
        completed: false,
        category_color: holidayColor,
        category_name: 'Feiertag',
      };

      if (!map.has(holiday.date)) map.set(holiday.date, []);
      map.get(holiday.date).push(entry);
    });

    return map;
  }, [holidayStateCode, holidayColor, visibleRange.end, visibleRange.start]);

  const calendarEntriesByVisibleDate = useMemo(() => {
    const map = new Map(tasksByVisibleDate);

    holidaysByVisibleDate.forEach((holidayEntries, dayKey) => {
      const existingEntries = map.get(dayKey) || [];
      map.set(dayKey, [...holidayEntries, ...existingEntries]);
    });

    return map;
  }, [holidaysByVisibleDate, tasksByVisibleDate]);

  const monthViewData = useMemo(() => {
    if (view !== 'month') return null;

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

    const weekCount = Math.ceil(days.length / 7);
    const weekLayouts = Array.from({ length: weekCount }, (_, weekIndex) => {
      const weekDays = days.slice(weekIndex * 7, weekIndex * 7 + 7);
      const weekStartStr = format(weekDays[0], 'yyyy-MM-dd');
      const weekEndStr = format(weekDays[6], 'yyyy-MM-dd');

      const segments = filteredTasks
        .filter((t) => {
          if (!t?.date) return false;
          const startStr = String(t.date).slice(0, 10);
          const endStr = String(t.date_end || t.date).slice(0, 10);
          if (!startStr || !endStr || endStr <= startStr) return false;
          return startStr <= weekEndStr && endStr >= weekStartStr;
        })
        .map((t) => {
          const startStr = String(t.date).slice(0, 10);
          const endStr = String(t.date_end || t.date).slice(0, 10);
          const segStartStr = startStr > weekStartStr ? startStr : weekStartStr;
          const segEndStr = endStr < weekEndStr ? endStr : weekEndStr;
          const startIdx = Math.max(0, Math.min(6, differenceInCalendarDays(new Date(`${segStartStr}T00:00:00`), weekDays[0])));
          const endIdx = Math.max(startIdx, Math.min(6, differenceInCalendarDays(new Date(`${segEndStr}T00:00:00`), weekDays[0])));
          return { taskId: String(t.id), startIdx, endIdx, span: endIdx - startIdx + 1 };
        })
        .sort((a, b) => {
          if (a.startIdx !== b.startIdx) return a.startIdx - b.startIdx;
          return b.span - a.span;
        });

      const laneEnds = [];
      const segmentByTaskId = new Map();
      segments.forEach((seg) => {
        let lane = laneEnds.findIndex((endIdx) => endIdx < seg.startIdx);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(seg.endIdx);
        } else {
          laneEnds[lane] = seg.endIdx;
        }
        segmentByTaskId.set(seg.taskId, { ...seg, lane });
      });

      return {
        segmentByTaskId,
        maxLanes: laneEnds.length,
      };
    });

    const decoratedTasksByDay = new Map();
    days.forEach((d, dayGlobalIdx) => {
      const dayKey = format(d, 'yyyy-MM-dd');
      const weekIndex = Math.floor(dayGlobalIdx / 7);
      const weekLayout = weekLayouts[weekIndex];
      const decoratedDayTasks = (calendarEntriesByVisibleDate.get(dayKey) || [])
        .map((t, originalIdx) => ({
          t,
          originalIdx,
          seg: weekLayout.segmentByTaskId.get(String(t.id)) || null,
        }))
        .sort((a, b) => {
          if (a.seg && b.seg) return a.seg.lane - b.seg.lane;
          if (a.seg) return -1;
          if (b.seg) return 1;
          return a.originalIdx - b.originalIdx;
        });
      decoratedTasksByDay.set(dayKey, decoratedDayTasks);
    });

    return { days, weekLayouts, decoratedTasksByDay };
  }, [view, currentDate, filteredTasks, calendarEntriesByVisibleDate]);

  // -- Debounced visible range notification --
  // Debounce prevents rapid-fire fetches when tapping through days/weeks fast on tablet
  const debouncedRangeNotify = useCallback(
    debounce((start, end) => {
      onVisibleRangeChange?.(start, end);
    }, 200),
    [onVisibleRangeChange]
  );

  useEffect(() => {
    if (!onVisibleRangeChange) return;
    debouncedRangeNotify(
      format(visibleRange.start, 'yyyy-MM-dd'),
      format(visibleRange.end, 'yyyy-MM-dd')
    );
  }, [visibleRange, debouncedRangeNotify, onVisibleRangeChange]);

  // â”€â”€ Universal debounced resize handler for all devices â”€â”€
  const debouncedResizeHandler = useCallback(
    debounce(() => {
      setViewportState({
        isDesktop: window.innerWidth >= MOBILE_BREAKPOINT,
        isWideDesktopCalendar: window.innerWidth >= CALENDAR_DESKTOP_BREAKPOINT
      });
    }, 100), // Faster debounce (100ms) for all devices
    []
  );

  useEffect(() => {
    window.addEventListener('resize', debouncedResizeHandler);
    return () => window.removeEventListener('resize', debouncedResizeHandler);
  }, [debouncedResizeHandler]);

  useEffect(() => {
    const syncFullscreenState = () => {
      const active = document.fullscreenElement || document.webkitFullscreenElement;
      setIsCalendarFullscreen(active === calendarWrapperRef.current);
    };

    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);
    syncFullscreenState();

    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let intervalId = null;
    let timeoutId = null;

    const syncNow = () => { if (mounted) setNowTs(Date.now()); };
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
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
    };
  }, []);

  // â”€â”€ Universal ResizeObserver with optimized cleanup â”€â”€
  useEffect(() => {
    if (!viewportState.isWideDesktopCalendar) {
      // Reset to default when not wide desktop
      wkHRef.current = WK_H;
      setWkHState(WK_H);
      return;
    }

    const wrap = desktopWeekWrapRef.current;
    if (!wrap) return;

    const recalc = throttle(() => {
      const h = wrap.clientHeight;
      if (h > 0) {
        const newH = Math.max(28, Math.floor((h - 28) / (WK_END - WK_START)));
        if (Math.abs(wkHRef.current - newH) > 1) { // Only update if significant change
          wkHRef.current = newH;
          setWkHState(newH);
        }
      }
    }, 60); // Faster throttling (60ms) for all devices

    const observer = new ResizeObserver(recalc);
    observer.observe(wrap);
    recalc();

    return () => {
      observer.disconnect();
    };
  }, [viewportState.isWideDesktopCalendar]);

  const isMobile = !viewportState.isDesktop;

  // â”€â”€ Universal device type detection for optimized animations â”€â”€
  const deviceType = useMemo(() => {
    if (isMobile) return 'mobile';
    if (viewportState.isDesktop && !viewportState.isWideDesktopCalendar) return 'tablet';
    return 'desktop';
  }, [isMobile, viewportState]);
  
  // â”€â”€ Animation settings optimized for detected device type â”€â”€
  const animProps = useMemo(() => getAnimationProps(deviceType), [deviceType]);

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

  // â”€â”€ Universal month picker event handler with performance optimization â”€â”€
  const monthPickerHandler = useCallback((e) => {
    if (
      (triggerRef.current && triggerRef.current.contains(e.target)) ||
      (dropdownRef.current && dropdownRef.current.contains(e.target))
    ) return;
    setShowMonthPicker(false);
  }, []);

  useEffect(() => {
    if (!showMonthPicker) return;
    
    // Use passive listeners for better performance on all devices
    const options = { passive: true, capture: true };
    
    document.addEventListener('mousedown', monthPickerHandler, options);
    document.addEventListener('touchstart', monthPickerHandler, options);
    
    return () => {
      document.removeEventListener('mousedown', monthPickerHandler, options);
      document.removeEventListener('touchstart', monthPickerHandler, options);
    };
  }, [showMonthPicker, monthPickerHandler]);

  // â”€â”€ Optimized getTasksForDate with memoization â”€â”€
  const getTasksForDate = useCallback((date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return calendarEntriesByVisibleDate.get(dateStr) || [];
  }, [calendarEntriesByVisibleDate]);

  const openCalendarEntry = useCallback((task) => {
    if (isHolidayEntry(task)) return;
    openTask(task);
  }, [openTask]);

  const selectedHolidayStateLabel = useMemo(() => {
    return FEDERAL_STATES.find((state) => state.code === holidayStateCode)?.label || 'Nur bundesweit';
  }, [holidayStateCode]);

  const triggerDropFeedback = (taskId, msg = 'Termin verschoben') => {
    setDropFeedback({ id: taskId, msg });
    setTimeout(() => setDropFeedback(null), 1400);
  };

  // â"€â"€ Throttled navigate: prevents too-rapid state updates on tablet when tapping fast â"€â"€
  const navigateRef = useRef(null);
  if (!navigateRef.current) {
    navigateRef.current = throttle((direction, curView, curDate, curSelected) => {
      if (curView === 'month') {
        const nextDate = direction === 'next' ? addMonths(curDate, 1) : subMonths(curDate, 1);
        setCurrentDate(nextDate);
        return;
      }
      if (curView === 'day') {
        const base = curSelected || curDate;
        const nextDate = direction === 'next' ? addDay(base, 1) : subDays(base, 1);
        setSelectedDate(nextDate);
        setCurrentDate(nextDate);
        return;
      }
      const nextDate = direction === 'next' ? addWeeks(curDate, 1) : subWeeks(curDate, 1);
      setCurrentDate(nextDate);
      setSelectedDate(nextDate);
    }, 120);
  }
  const navigate = (direction) => navigateRef.current(direction, view, currentDate, selectedDate);

  const handleDayClick = (date) => {
    setSelectedDate(date);
    setCurrentDate(date);
    setShowDayModal(true);
    onDayClick?.(date);
  };

  // â”€â”€ Mobile Swipe-Navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleSwipeTouchStart = (e) => {
    if (!isMobile) return;
    swipeRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY };
  };

  const handleSwipeTouchEnd = (e) => {
    if (!isMobile) return;
    const dx = e.changedTouches[0].clientX - swipeRef.current.startX;
    const dy = e.changedTouches[0].clientY - swipeRef.current.startY;
    // Nur als horizontaler Swipe werten wenn dx dominant und groÃŸ genug
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.8) {
      navigate(dx < 0 ? 'next' : 'prev');
    }
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

  // â”€â”€ Drag & Drop via Pointer Events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handlePointerDown = (e, task) => {
    if (!viewportState.isDesktop || e.button !== 0) return;
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
        const rawMins = (relY / wkHRef.current) * 60;
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

      // â”€â”€ Date shift â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (targetDateStr !== oldDateStr) {
        updates.date = targetDateStr;
        if (liveTask.date_end && oldDateStr) {
          const delta = differenceInCalendarDays(parseISO(targetDateStr), parseISO(oldDateStr));
          const oldEnd = parseISO(liveTask.date_end.substring(0, 10));
          updates.date_end = format(addDays(oldEnd, delta), 'yyyy-MM-dd');
        }
      }

      // â”€â”€ Time shift (only in the timed grid, not the all-day strip) â”€
      const isTimeCol = col.classList.contains('desktop-week-day-col');
      if (isTimeCol && liveTask.time) {
        const colRect = col.getBoundingClientRect();
        const relY = Math.max(0, ev.clientY - colRect.top - clickOffsetY);
        const rawMins = (relY / wkHRef.current) * 60;
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

  // â”€â”€ Mobile Day view â€” drag to move (Y = time, X = swipe = change day) â”€â”€â”€â”€â”€
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
        setDragInfo({ task, x: ev.clientX, y: ev.clientY, previewTime: swipeDay < 0 ? 'â† Vorheriger Tag' : 'NÃ¤chster Tag â†’' });
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

      // Horizontal swipe â†’ move to prev/next day
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
        if (updated) triggerDropFeedback(liveTask.id, swipeDay < 0 ? 'Auf Vortag verschoben' : 'Auf nÃ¤chsten Tag verschoben');
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

  // â”€â”€ Universal drag & drop optimized for all devices â”€â”€
  const handleMobileWeekEventPointerDown = useCallback((e, task, colIdx, days) => {
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

    // Throttled move handler for better performance
    const onMove = throttle((ev) => {
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
    }, 16);

    const onUp = async (ev) => {
      document.removeEventListener('pointermove', onMove, { passive: false });
      document.removeEventListener('pointerup', onUp);
      
      document.body.classList.remove('cal-is-dragging');
      document.querySelectorAll('.mobile-week-grid-col').forEach(el => el.classList.remove('cal-drag-over'));
      
      const dropped = dragTaskRef.current;
      dragTaskRef.current = null;
      setDragInfo(null);
      
      if (!moved || !dropped) { 
        wasDragging.current = false; 
        return; 
      }
      
      // Debounced reset to prevent interference with other interactions
      setTimeout(() => { wasDragging.current = false; }, 200);
      
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


    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
  }, [updateTask, onTaskUpdated, triggerDropFeedback, mobileWeekColRefs, dragTaskRef, wasDragging, tasksRef, setDragInfo]);
  // â”€â”€ Date extend handle â€” drag left/right edge to change date_start / date_end â”€â”€
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
      setDragInfo({ task, x: ev.clientX, y: ev.clientY, previewTime: `${edge === 'end' ? 'â‡¥' : 'â‡¤'} ${previewLabel}` });
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
        if (updated) triggerDropFeedback(task.id, 'Enddatum geÃ¤ndert');
      } else {
        const base = task.date?.substring(0, 10);
        if (!base) return;
        const newStart = format(addDays(parseISO(base), -previewDelta), 'yyyy-MM-dd');
        const endD = (task.date_end || task.date)?.substring(0, 10);
        if (endD && newStart > endD) return; // can't start after end
        const updated = await updateTask(task.id, { date: newStart });
        if (updated && onTaskUpdated) onTaskUpdated(updated);
        if (updated) triggerDropFeedback(task.id, 'Startdatum geÃ¤ndert');
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  // â”€â”€ Resize handle â€” drag edge to change start/end time â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Month view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const renderMonthView = () => {
    if (!monthViewData) return null;
    const { days, weekLayouts, decoratedTasksByDay } = monthViewData;
    const dayHeaders = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

    return (
      <>
        {dayHeaders.map((d) => (
          <div key={d} className="calendar-day-header">{d}</div>
        ))}
        {days.map((d, dayGlobalIdx) => {
          const dayKey = format(d, 'yyyy-MM-dd');
          const weekIndex = Math.floor(dayGlobalIdx / 7);
          const dayIndexInWeek = dayGlobalIdx % 7;
          const weekLayout = weekLayouts[weekIndex];
          const decoratedDayTasks = decoratedTasksByDay.get(dayKey) || [];
          const isCurrentMonth = isSameMonth(d, currentDate);
          const isSelected = selectedDate && isSameDay(d, selectedDate);
          const isHoliday = holidaysByVisibleDate.has(dayKey);
          const maxVisiblePerCell = viewportState.isDesktop ? 4 : 2;

          return (
            <div
              key={d.toISOString()}
              data-caldate={format(d, 'yyyy-MM-dd')}
              className={`calendar-day ${!isCurrentMonth ? 'other-month' : ''} ${isToday(d) ? 'today' : ''} ${isSelected ? 'selected' : ''} ${isHoliday ? 'holiday' : ''}`}
              onClick={() => handleDayClick(d)}
            >
              <span
                className="calendar-day-number"
                style={isHoliday ? { color: holidayColor, background: `${holidayColor}14`, boxShadow: `inset 0 0 0 1px ${holidayColor}20` } : undefined}
              >{format(d, 'd')}</span>
              {decoratedDayTasks.length > 0 && (
                <div className="calendar-day-tasks">
                  {decoratedDayTasks.slice(0, maxVisiblePerCell).map(({ t, seg }, renderIdx) => {
                    const ended = isEventEnded(t, nowTs);
                    const isHolidayTask = isHolidayEntry(t);
                    const categoryAccent = t.category_color || t.group_category_color;
                    const accentColor = ended
                      ? 'rgba(142,142,147,0.6)'
                      : (categoryAccent || t.group_color || '#4C7BD9');
                    const isMultiDay = !!seg;
                    let multiClass = '';
                    if (seg) {
                      if (seg.startIdx === seg.endIdx) multiClass = 'multi-day-single';
                      else if (dayIndexInWeek === seg.startIdx) multiClass = 'multi-day-start';
                      else if (dayIndexInWeek === seg.endIdx) multiClass = 'multi-day-end';
                      else multiClass = 'multi-day-middle';
                    }
                    const isHiddenSegment = !!seg && dayIndexInWeek !== seg.startIdx;
                    const spanDaysInRow = seg && dayIndexInWeek === seg.startIdx ? seg.span : 1;
                    const spanWidth = spanDaysInRow > 1
                      ? `calc(${spanDaysInRow * 100}% + ${(spanDaysInRow - 1) * 8}px)`
                      : undefined;
                    const showBorderLeft = !isMobile && !['multi-day-middle', 'multi-day-end'].includes(multiClass);
                    const showTaskLabel = !seg || dayIndexInWeek === seg.startIdx;
                    const slotOrder = seg ? seg.lane : (weekLayout.maxLanes + renderIdx);
                    return (
                      <div
                        key={t.id}
                        className={`calendar-day-task ${multiClass} ${t.completed ? 'completed' : ''} ${t.group_id ? 'group-task' : ''} ${ended ? 'ended-event' : ''} ${isHolidayTask ? 'holiday-entry' : ''} ${dragInfo?.task.id === t.id ? 'cal-dragging' : ''}`}
                        style={isMobile ? {
                          visibility: isHiddenSegment ? 'hidden' : 'visible',
                          pointerEvents: isHiddenSegment ? 'none' : 'auto',
                          gridRow: slotOrder + 1,
                          width: spanWidth,
                          maxWidth: spanWidth ? 'none' : '100%',
                          background: isHolidayTask ? holidayColor : accentColor,
                          color: ended ? '#999' : '#fff',
                          borderLeft: 'none',
                          cursor: isHolidayTask ? 'default' : 'pointer',
                          userSelect: 'none',
                          zIndex: spanWidth ? 4 : undefined,
                        } : {
                          visibility: isHiddenSegment ? 'hidden' : 'visible',
                          pointerEvents: isHiddenSegment ? 'none' : 'auto',
                          gridRow: slotOrder + 1,
                          width: spanWidth,
                          maxWidth: spanWidth ? 'none' : '100%',
                          background: isHolidayTask ? 'rgba(217,44,44,0.12)' : ended ? 'rgba(142,142,147,0.12)' : categoryAccent ? `${categoryAccent}20` : t.group_id ? `${t.group_color || '#5856D6'}15` : 'var(--primary-bg)',
                          color: isHolidayTask ? holidayColor : ended ? '#59606B' : categoryAccent || (t.group_id ? (t.group_color || '#5856D6') : 'var(--primary)'),
                          borderLeft: showBorderLeft ? `2px solid ${isHolidayTask ? holidayColor : (ended ? 'rgba(142,142,147,0.55)' : accentColor)}` : 'none',
                          cursor: isHolidayTask ? 'default' : (viewportState.isDesktop && !ended ? 'grab' : 'pointer'),
                          userSelect: 'none',
                          zIndex: spanWidth ? 4 : undefined,
                        }}
                        onPointerDown={viewportState.isDesktop && !ended && !isHolidayTask ? (e) => handlePointerDown(e, t) : undefined}
                        onClick={(e) => { e.stopPropagation(); if (!wasDragging.current) openCalendarEntry(t); }}
                      >
                        {!isMobile && t.group_id && (
                          <AvatarBadge name={t.group_name} color={t.group_color || '#5856D6'} avatarUrl={t.group_image_url} size={10} />
                        )}
                        {showTaskLabel && t.teams_join_url && <Video size={10} className="calendar-day-task-teams-icon" />}
                        {showTaskLabel && t.time && <span className="calendar-day-task-time">{t.time.slice(0, 5)}</span>}
                        {showTaskLabel && <span className="calendar-day-task-title">{t.title}</span>}
                        {!isMobile && ended && <span className="calendar-day-task-ended">Beendet</span>}
                      </div>
                    );
                  })}
                  {decoratedDayTasks.length > maxVisiblePerCell && (
                    <div className="calendar-day-more" style={{ gridRow: maxVisiblePerCell + 1 }}>+{decoratedDayTasks.length - maxVisiblePerCell}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  };

  // â”€â”€ Week view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const renderDesktopWeekView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const weekStartStr = format(weekStart, 'yyyy-MM-dd');
    const weekEndStr = format(days[6], 'yyyy-MM-dd');

    const startHour = WK_START;
    const endHour = WK_END;
    const hourHeight = wkHState;
    const totalHeight = (endHour - startHour) * hourHeight + 28;
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
    const desktopOverlapByDate = new Map(
      days.map((d) => {
        const dayKey = format(d, 'yyyy-MM-dd');
        const sameDayTimed = weekTimedTasks.filter((t) => {
          const startKey = String(t.date || '').slice(0, 10);
          const endKey = String(t.date_end || t.date || '').slice(0, 10);
          return startKey === dayKey && endKey === dayKey;
        });

        const laneMap = buildOverlapLaneMap(sameDayTimed, (task) => {
          const start = timeToMinutes(task.time) ?? (startHour * 60);
          const rawEnd = timeToMinutes(task.time_end);
          const end = rawEnd && rawEnd > start ? rawEnd : start + 60;
          const clampedStart = Math.max(startHour * 60, start);
          const clampedEnd = Math.min(endHour * 60, end);
          return { start: clampedStart, end: clampedEnd };
        });

        return [dayKey, laneMap];
      })
    );

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
              const dayStr = format(d, 'yyyy-MM-dd');
              const weekDay = d.getDay(); // 0=Sun, 1=Mon..6=Sat
              const isWeekRowStart = weekDay === 1;
              const isWeekRowEnd = weekDay === 0;
              const dayTasks = getTasksForDate(d).filter((t) => !t.time);
              return (
                <div key={`allday-${d.toISOString()}`} className="desktop-week-all-day-cell" data-caldate={format(d, 'yyyy-MM-dd')}>
                  {dayTasks.slice(0, 3).map((t) => {
                    const ended     = isEventEnded(t, nowTs);
                    const doneOrOld = t.completed || ended;
                    const taskStartStr = String(t.date || '').slice(0, 10);
                    const taskEndStr = String(t.date_end || t.date || '').slice(0, 10);
                    const isMultiDay = taskStartStr && taskEndStr && taskEndStr > taskStartStr;
                    const isActualStart = dayStr === taskStartStr;
                    const isActualEnd = dayStr === taskEndStr;
                    let spanClass = '';
                    if (isMultiDay) {
                      const effectiveStart = isActualStart || isWeekRowStart;
                      const effectiveEnd = isActualEnd || isWeekRowEnd;
                      if (effectiveStart && effectiveEnd) spanClass = 'allday-span-single';
                      else if (effectiveStart) spanClass = 'allday-span-start';
                      else if (effectiveEnd) spanClass = 'allday-span-end';
                      else spanClass = 'allday-span-middle';
                    }
                    const showLabel = !isMultiDay || spanClass === 'allday-span-start' || spanClass === 'allday-span-single';
                    return (
                      <button
                        key={t.id}
                        className={`desktop-week-all-day-event ${spanClass}${getEventGlowClass(t) ? ` ${getEventGlowClass(t)}` : ''}${ended ? ' ended-event' : ''}${t.completed ? ' completed' : ''}`}
                        style={{ background: doneOrOld ? 'rgba(142,142,147,0.4)' : (t.category_color || t.group_category_color || t.group_color || '#4C7BD9') }}
                        onClick={(e) => { e.stopPropagation(); openCalendarEntry(t); }}
                      >
                        {showLabel && t.teams_join_url && <Video size={11} className="calendar-inline-teams-icon" />}
                        {showLabel && <span className={doneOrOld ? 'cal-allday-strike' : ''}>{t.title}</span>}
                        {showLabel && ended && !t.completed && <span style={{ opacity: 0.75, marginLeft: 3 }}>Â· beendet</span>}
                      </button>
                    );
                  })}
                  {dayTasks.length > 3 && (
                    <div className="desktop-week-allday-more">+{dayTasks.length - 3} weitere</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="desktop-week-time-wrap" ref={desktopWeekWrapRef}>
            <div className="desktop-week-hours-col" style={{ height: `${totalHeight}px` }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="desktop-week-hour-label"
                  style={{ top: `${(h - startHour) * hourHeight}px` }}
                >
                  {String(h === 24 ? 0 : h).padStart(2, '0')}:00
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
                    {hours.slice(0, -1).flatMap((h) => [
                      <div key={`${d.toISOString()}-${h}`} className="desktop-week-hour-line" style={{ top: `${(h - startHour) * hourHeight}px` }} />,
                      <div key={`${d.toISOString()}-${h}-30`} className="desktop-week-half-hour-line" style={{ top: `${(h - startHour) * hourHeight + hourHeight / 2}px` }} />,
                    ])}
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
                  const isSingleDay = liveSpanStart === liveSpanEnd;

                  const doneOrEnded = t.completed || ended;
                  const top = ((liveCStart - startHour * 60) / 60) * hourHeight;
                  const height = Math.max(24, ((liveCEnd - liveCStart) / 60) * hourHeight - 2);

                  const laneMeta = isSingleDay
                    ? desktopOverlapByDate.get(liveSpanStart)?.get(String(t.id))
                    : null;
                  const lane = laneMeta?.lane ?? 0;
                  const laneCount = Math.max(1, laneMeta?.laneCount || 1);
                  const dayPercent = 100 / 7;
                  const lanePercent = dayPercent / laneCount;
                  const singleDayLeft = `calc(${(startIdx * dayPercent) + (lane * lanePercent)}% + 4px)`;
                  const singleDayWidth = `calc(${lanePercent}% - 8px)`;
                  const minDisplayHeight = 28;
                  const eventBg = doneOrEnded
                    ? 'rgba(142, 142, 147, 0.72)'
                    : (t.group_category_color || t.category_color || t.group_color || '#4C7BD9');

                  return (
                    <div
                      key={t.id}
                      className={`desktop-week-event${getEventGlowClass(t) ? ` ${getEventGlowClass(t)}` : ''}${ended ? ' ended-event' : ''}${t.completed ? ' completed' : ''}${dragInfo?.task.id === t.id || isResizingThis ? ' cal-dragging' : ''}${dropFeedback?.id === t.id ? ' cal-snap' : ''}`}
                      style={{
                        left: isSingleDay ? singleDayLeft : `calc((100% / 7) * ${startIdx} + 4px)`,
                        width: isSingleDay ? singleDayWidth : `calc((100% / 7) * ${spanDays} - 8px)`,
                        top: `${top}px`,
                        height: `${Math.max(minDisplayHeight, height)}px`,
                        background: eventBg,
                        touchAction: 'none',
                      }}
                      onPointerDown={(e) => {
                        if (doneOrEnded || isHolidayEntry(t)) return;
                        if (e.target.closest('.cal-resize-handle') || e.target.closest('.cal-date-extend-handle')) return;
                        handlePointerDown(e, t);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!wasDragging.current) openCalendarEntry(t);
                      }}
                    >
                      {t.teams_join_url && <Video size={12} className="calendar-event-teams-icon" />}
                      {!ended && (
                        <div
                          className="cal-resize-handle cal-resize-handle-top"
                          onPointerDown={(e) => handleResizePointerDown(e, t, 'start', desktopWeekColsRef.current, wkHRef.current, WK_START)}
                        />
                      )}
                      {!ended && (
                        <div
                          className="cal-date-extend-handle cal-date-extend-left"
                          onPointerDown={(e) => handleDateExtendPointerDown(e, t, 'start')}
                        />
                      )}
                      <div className="cal-event-header-row">
                        {t.group_id && <AvatarBadge name={t.group_name} color={t.group_color || '#5856D6'} avatarUrl={t.group_image_url} size={11} />}
                        <span className="desktop-week-event-title">{t.title}</span>
                      </div>
                      <span className="desktop-week-event-time">
                        {t.time?.slice(0, 5)}{t.time_end ? ` - ${t.time_end.slice(0, 5)}` : ''}
                        {t.group_category_name && !doneOrEnded && <span className="cal-event-cat-inline"> Â· {t.group_category_name}</span>}
                      </span>
                      {t.completed && <span className="desktop-week-event-ended">Erledigt</span>}
                      {!t.completed && ended && <span className="desktop-week-event-ended">Beendet</span>}
                      {!ended && (
                        <div
                          className="cal-date-extend-handle cal-date-extend-right"
                          onPointerDown={(e) => handleDateExtendPointerDown(e, t, 'end')}
                        />
                      )}
                      {!ended && (
                        <div
                          className="cal-resize-handle cal-resize-handle-bottom"
                          onPointerDown={(e) => handleResizePointerDown(e, t, 'end', desktopWeekColsRef.current, wkHRef.current, WK_START)}
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

  // â”€â”€ Mobile Week compact time grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const renderMobileWeekView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const mwStartH = 6; const mwEndH = 24; const mwHourH = 44;
    const mwTotalH = (mwEndH - mwStartH) * mwHourH + 24;
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

        {/* â”€â”€ All-Day Strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {(() => {
          const hasAny = days.some((d) => getTasksForDate(d).some((t) => isAllDayTask(t)));
          if (!hasAny) return null;
          return (
            <div className="mobile-week-allday-strip">
              <div className="mobile-week-allday-corner">Ganztg.</div>
              {days.map((d) => {
                const dayStr = format(d, 'yyyy-MM-dd');
                const weekDay = d.getDay(); // 0=Sun, 1=Mon..6=Sat
                const isWeekRowStart = weekDay === 1;
                const isWeekRowEnd = weekDay === 0;
                const adTasks = getTasksForDate(d).filter((t) => isAllDayTask(t));
                return (
                  <div key={`mwad-${d.toISOString()}`} className="mobile-week-allday-col">
                    {adTasks.slice(0, 2).map((t) => {
                      const ended     = isEventEnded(t, nowTs);
                      const doneOrOld = t.completed || ended;
                      const taskStartStr = String(t.date || '').slice(0, 10);
                      const taskEndStr = String(t.date_end || t.date || '').slice(0, 10);
                      const isMultiDay = taskStartStr && taskEndStr && taskEndStr > taskStartStr;
                      const isActualStart = dayStr === taskStartStr;
                      const isActualEnd = dayStr === taskEndStr;
                      let spanClass = '';
                      if (isMultiDay) {
                        const effectiveStart = isActualStart || isWeekRowStart;
                        const effectiveEnd = isActualEnd || isWeekRowEnd;
                        if (effectiveStart && effectiveEnd) spanClass = 'mw-span-single';
                        else if (effectiveStart) spanClass = 'mw-span-start';
                        else if (effectiveEnd) spanClass = 'mw-span-end';
                        else spanClass = 'mw-span-middle';
                      }
                      const showLabel = !isMultiDay || spanClass === 'mw-span-start' || spanClass === 'mw-span-single';
                      return (
                        <div
                          key={`mwadt-${t.id}`}
                          className={`mobile-week-allday-pill ${spanClass}${doneOrOld ? ' done' : ''}`}
                          style={{ background: doneOrOld ? 'rgba(142,142,147,0.35)' : (t.category_color || t.group_category_color || t.group_color || '#4C7BD9') }}
                          onClick={(e) => { e.stopPropagation(); openCalendarEntry(t); }}
                        >
                          {showLabel && <span>{t.title}</span>}
                        </div>
                      );
                    })}
                    {adTasks.length > 2 && (
                      <div className="mobile-week-allday-more">+{adTasks.length - 2}</div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* scrollable time grid */}
        <div className="mobile-week-grid-scroll">
          {/* hour labels */}
          <div className="mobile-week-grid-hours" style={{ height: `${mwTotalH}px` }}>
            {mwHours.map((h) => (
              <div key={`mwhl-${h}`} className="mobile-week-grid-hour-label" style={{ top: `${(h - mwStartH) * mwHourH}px` }}>
                {String(h === 24 ? 0 : h).padStart(2, '0')}
              </div>
            ))}
          </div>

          {/* day columns */}
          <div className="mobile-week-grid-cols">
            {days.map((d, di) => {
              const dayTasks = getTasksForDate(d).filter((t) => t.time);
              const dayLaneMap = buildOverlapLaneMap(dayTasks, (task) => {
                const start = timeToMins(task.time) ?? (mwStartH * 60);
                const rawEnd = timeToMins(task.time_end);
                const end = rawEnd && rawEnd > start ? rawEnd : start + 60;
                const clampedStart = Math.max(mwStartH * 60, start);
                const clampedEnd = Math.min(mwEndH * 60, end);
                return { start: clampedStart, end: clampedEnd };
              });
              return (
                <div
                  key={`mwcol-${d.toISOString()}`}
                  ref={(el) => { if (el) mobileWeekColRefs.current[di] = el; }}
                  className={`mobile-week-grid-col ${isToday(d) ? 'today' : ''}`}
                  data-caldate={format(d, 'yyyy-MM-dd')}
                  style={{ height: `${mwTotalH}px` }}
                  onClick={() => handleDayClick(d)}
                >
                  {mwHours.flatMap((h) => [
                    <div key={`${di}-${h}`} className="mobile-week-grid-hour-line" style={{ top: `${(h - mwStartH) * mwHourH}px` }} />,
                    <div key={`${di}-${h}-30`} className="mobile-week-grid-half-hour-line" style={{ top: `${(h - mwStartH) * mwHourH + mwHourH / 2}px` }} />,
                  ])}
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

                    const doneOrEnded = t.completed || ended;
                    const top    = ((liveCStart - mwStartH * 60) / 60) * mwHourH;
                    const height = Math.max(16, ((liveCEnd - liveCStart) / 60) * mwHourH - 2);
                    const laneMeta = dayLaneMap.get(String(t.id));
                    const lane = laneMeta?.lane ?? 0;
                    const laneCount = Math.max(1, laneMeta?.laneCount || 1);
                    const lanePercent = 100 / laneCount;

                    return (
                      <div
                        key={t.id}
                        className={`mobile-week-event${getEventGlowClass(t) ? ` ${getEventGlowClass(t)}` : ''}${ended ? ' ended-event' : ''}${t.completed ? ' completed' : ''}${dragInfo?.task.id === t.id || isResizingThis ? ' cal-dragging' : ''}${dropFeedback?.id === t.id ? ' cal-snap' : ''}`}
                        style={{
                          top: `${top}px`, height: `${height}px`,
                          left: `calc(${lane * lanePercent}% + 1px)`,
                          width: `calc(${lanePercent}% - 2px)`,
                          right: 'auto',
                          background: doneOrEnded ? 'rgba(142, 142, 147, 0.72)' : (t.category_color || t.group_category_color || t.group_color || '#4C7BD9'),
                          touchAction: 'none',
                        }}
                        onPointerDown={(e) => {
                          if (doneOrEnded || isHolidayEntry(t)) return;
                          if (e.target.closest('.cal-resize-handle')) return;
                          handleMobileWeekEventPointerDown(e, t, di, days);
                        }}
                        onClick={(e) => { e.stopPropagation(); if (!wasDragging.current) openCalendarEntry(t); }}
                      >
                          {t.teams_join_url && <Video size={11} className="calendar-event-teams-icon mobile" />}
                        {!ended && (
                          <div
                            className="cal-resize-handle cal-resize-handle-top"
                            onPointerDown={(e) => handleResizePointerDown(e, t, 'start', mobileWeekColRefs.current[di], mwHourH, mwStartH)}
                          />
                        )}
                        <span className="mobile-week-event-title">{t.title}</span>
                        {height > 28 && <span className="mobile-week-event-time">{t.time?.slice(0, 5)}</span>}
                        {t.completed && height > 22 && <span className="mobile-week-event-ended">Erledigt</span>}
                        {!t.completed && ended && height > 22 && <span className="mobile-week-event-ended">Beendet</span>}
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
    if (viewportState.isWideDesktopCalendar) return renderDesktopWeekView();
    return renderMobileWeekView();
  };

  const renderMobileDayView = () => {
    const dayTasks = getTasksForSelectedDay();
    const startHour = 7;
    const endHour = 23;
    const hourHeight = 56;
    const totalHeight = (endHour - startHour) * hourHeight + 28;
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
      const minsFromStart = Math.min((endHour - startHour) * 60, (y / hourHeight) * 60);
      const snapped = Math.floor(minsFromStart / 15) * 15;

      const dayBase = selectedDate || currentDate;
      const pickedDate = new Date(dayBase);
      const totalMinutes = (startHour * 60) + snapped;
      pickedDate.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);

      handleDayClick(pickedDate);
    };

    const allDayTasks = dayTasks.filter((t) => isAllDayTask(t));
    const timedTasks  = dayTasks.filter((t) => !isAllDayTask(t));
    const timedLaneMap = buildOverlapLaneMap(timedTasks, (task) => {
      const start = toMinutes(task.time) ?? (startHour * 60);
      const rawEnd = toMinutes(task.time_end);
      const end = rawEnd && rawEnd > start ? rawEnd : start + 60;
      const clampedStart = Math.max(startHour * 60, start);
      const clampedEnd = Math.min(endHour * 60, end);
      return { start: clampedStart, end: clampedEnd };
    });

    return (
      <div className="mobile-day-view">

        {/* â”€â”€ All-Day Section â€” TOP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {allDayTasks.length > 0 && (
          <div className="mobile-day-allday-top">
            <span className="mobile-day-allday-label">GanztÃ¤gig</span>
            {allDayTasks.map((t) => {
              const ended    = isEventEnded(t, nowTs);
              const doneOrOld = t.completed || ended;
              const color    = doneOrOld
                ? 'rgba(142,142,147,0.35)'
                : (t.category_color || t.group_category_color || t.group_color || '#4C7BD9');
              return (
                <button
                  key={`adtop-${t.id}`}
                  className={`mobile-day-allday-chip${doneOrOld ? ' done' : ''}`}
                  style={{ background: color }}
                  onClick={(e) => { e.stopPropagation(); openCalendarEntry(t); }}
                >
                  {t.group_id && (
                    <AvatarBadge name={t.group_name} color={t.group_color || '#5856D6'} avatarUrl={t.group_image_url} size={12} />
                  )}
                  {t.teams_join_url && <Video size={11} />}
                  <span className={doneOrOld ? 'mobile-day-allday-chip-done' : ''}>{t.title}</span>
                  {ended && !t.completed && <span className="mobile-day-chip-badge">Beendet</span>}
                  {t.completed && <span className="mobile-day-chip-badge">Erledigt</span>}
                </button>
              );
            })}
          </div>
        )}

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

          {timedTasks.map((t) => {
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

            const doneOrEnded = t.completed || ended;
            const top    = ((liveClampedStart - startHour * 60) / 60) * hourHeight;
            const height = Math.max(36, ((liveClampedEnd - liveClampedStart) / 60) * hourHeight - 4);
            const laneMeta = timedLaneMap.get(String(t.id));
            const lane = laneMeta?.lane ?? 0;
            const laneCount = Math.max(1, laneMeta?.laneCount || 1);
            const availableLeft = 14;
            const availableWidth = 84;
            const laneWidth = availableWidth / laneCount;
            const laneLeft = availableLeft + (lane * laneWidth);
            const mobileEventBg = doneOrEnded
              ? 'rgba(142, 142, 147, 0.72)'
              : (t.group_category_color || t.category_color || t.group_color || '#4C7BD9');

            return (
              <div
                key={t.id}
                className={`mobile-day-event${getEventGlowClass(t) ? ` ${getEventGlowClass(t)}` : ''}${ended ? ' ended-event' : ''}${t.completed ? ' completed' : ''}${dragInfo?.task.id === t.id || isResizingThis ? ' cal-dragging' : ''}${dropFeedback?.id === t.id ? ' cal-snap' : ''}`}
                style={{
                  left: `${laneLeft}%`,
                  width: `${laneWidth}%`,
                  right: 'auto',
                  top: `${top}px`,
                  height: `${height}px`,
                  background: mobileEventBg,
                  touchAction: 'none',
                  cursor: isHolidayEntry(t) ? 'default' : (doneOrEnded ? 'pointer' : 'grab'),
                }}
                onPointerDown={(e) => {
                  if (doneOrEnded || isHolidayEntry(t)) return;
                  if (e.target.closest('.cal-resize-handle')) return;
                  handleMobileEventPointerDown(e, t, mobileDayRef.current, hourHeight, startHour);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!wasDragging.current) openCalendarEntry(t);
                }}
              >
                {t.teams_join_url && <Video size={11} className="calendar-event-teams-icon mobile" />}
                {!ended && (
                  <div
                    className="cal-resize-handle cal-resize-handle-top"
                    onPointerDown={(e) => handleResizePointerDown(e, t, 'start', mobileDayRef.current, hourHeight, startHour)}
                  />
                )}
                <div className="cal-event-header-row">
                  {t.group_id && <AvatarBadge name={t.group_name} color={t.group_color || '#5856D6'} avatarUrl={t.group_image_url} size={11} />}
                  <strong className="cal-event-title-text">{t.title}</strong>
                </div>
                <span className="cal-event-time-row">
                  {t.time?.slice(0, 5)}{t.time_end ? `-${t.time_end.slice(0, 5)}` : ''}
                  {t.group_category_name && !doneOrEnded && <span className="cal-event-cat-inline"> Â· {t.group_category_name}</span>}
                </span>
                {t.completed && <span className="mobile-day-event-ended">Erledigt</span>}
                {!t.completed && ended && <span className="mobile-day-event-ended">Beendet</span>}
                {(t.date_end && t.date_end !== t.date) && (
                  <span style={{ fontSize: 10, opacity: 0.8 }}>
                    {format(parseISO(t.date?.substring(0,10)), 'd.M.')} â€“ {format(parseISO(t.date_end.substring(0,10)), 'd.M.')}
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

      </div>
    );
  };

  const headerText = view === 'month'
    ? format(currentDate, 'MMMM yyyy', { locale: de })
    : view === 'day'
      ? format(selectedDate || currentDate, 'EEEE, d. MMMM yyyy', { locale: de })
      : `KW ${format(currentDate, 'w')} · ${format(startOfWeek(currentDate, { weekStartsOn: 1 }), 'd. MMM', { locale: de })} – ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), 'd. MMM yyyy', { locale: de })}`;

  // â”€â”€ Universal fullscreen toggle optimized for all devices â”€â”€
  const toggleCalendarFullscreen = useCallback(async () => {
    if (isMobile) return; // Fullscreen not useful on mobile
    
    const element = calendarWrapperRef.current;
    if (!element) return;

    const activeFullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    
    try {
      if (activeFullscreenElement === element) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
        return;
      }

      if (element.requestFullscreen) {
        await element.requestFullscreen();
      } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
      }
    } catch {
      // Ignore fullscreen rejections from browser policies.
    }
  }, [isMobile]);

  // â”€â”€ Get device-specific easing â”€â”€ 
  const getEasing = useCallback(() => {
    switch (deviceType) {
      case 'mobile': return animProps.easingTouch;
      case 'tablet': return animProps.easingTablet;
      default: return animProps.easingDesktop;
    }
  }, [deviceType, animProps]);

  return (
    <motion.div
      ref={calendarWrapperRef}
      className={`calendar-wrapper calendar-view-${view} ${isCalendarFullscreen ? 'calendar-is-fullscreen' : ''}`}
      initial={animProps.enabled ? { opacity: 0, y: 6 } : { opacity: 1, y: 0 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ 
        duration: animProps.duration, 
        ease: getEasing()
      }}
      onTouchStart={handleSwipeTouchStart}
      onTouchEnd={handleSwipeTouchEnd}
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
          <button
            className={`calendar-fs-btn cal-settings-trigger ${showHolidaySettings ? 'active' : ''}`}
            onClick={() => setShowHolidaySettings(v => !v)}
            title="Feiertage & Kalendereinstellungen"
          >
            <Settings size={17} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {!isMobile && (
            <button
              className={`calendar-fs-btn ${isCalendarFullscreen ? 'active' : ''}`}
              onClick={toggleCalendarFullscreen}
              title={isCalendarFullscreen ? 'Vollbild beenden' : 'Kalender im Vollbild'}
            >
              {isCalendarFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
          )}
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

      {showHolidaySettings && (
        <div className="cal-holiday-settings-panel">
          <div className="cal-settings-head">
            <strong>Kalendereinstellungen</strong>
            <span>Feiertage & Darstellung anpassen</span>
          </div>
          <label className="cal-settings-field">
            <span>Bundesland</span>
            <select
              value={holidayStateCode}
              onChange={(e) => setHolidayStateCode(e.target.value)}
              aria-label="Bundesland fuer Feiertage"
            >
              {FEDERAL_STATES.map((state) => (
                <option key={state.code || 'national'} value={state.code}>{state.label}</option>
              ))}
            </select>
          </label>
          <div className="cal-settings-field">
            <span>Farbe der Feiertage</span>
            <div className="cal-color-presets">
              {['#D92C2C','#E8720C','#8B5CF6','#059669','#2563EB','#DB2777'].map((c) => (
                <button
                  key={c}
                  className={`cal-color-preset ${holidayColor === c ? 'selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setHolidayColor(c)}
                  aria-label={`Farbe ${c}`}
                />
              ))}
              <label className="cal-color-custom" title="Eigene Farbe">
                <input
                  type="color"
                  value={holidayColor}
                  onChange={(e) => setHolidayColor(e.target.value)}
                  aria-label="Eigene Farbe"
                />
                <span style={{ background: holidayColor }} />
              </label>
            </div>
          </div>
          <p className="cal-settings-hint">
            Aktiv: {selectedHolidayStateLabel}. Bundesweite Feiertage bleiben immer sichtbar.
          </p>
        </div>
      )}

      {view === 'month' ? (
        <div className="calendar-grid">{renderMonthView()}</div>
      ) : view === 'day' ? (
        renderMobileDayView()
      ) : (
        renderWeekView()
      )}

      {isMobile && createPortal(
        <div className="mobile-calendar-modebar">
          <div className="mobile-calendar-modebar-tabs">
            <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>Tag</button>
            <button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>Woche</button>
            <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>Monat</button>
          </div>
        </div>,
        document.body
      )}

      {detailTask && createPortal(
        <TaskDetailModal
          task={detailTask}
          onClose={closeTask}
          onUpdated={(updated) => { closeTask(); if (onTaskUpdated) onTaskUpdated(updated); }}
        />,
        isCalendarFullscreen && calendarWrapperRef.current ? calendarWrapperRef.current : document.body
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
          background: (dragInfo.task.category_color || dragInfo.task.group_category_color)
            ? `${(dragInfo.task.category_color || dragInfo.task.group_category_color)}25`
            : dragInfo.task.group_id ? `${dragInfo.task.group_color || '#5856D6'}20` : 'var(--primary-bg)',
          color: (dragInfo.task.category_color || dragInfo.task.group_category_color)
            ? (dragInfo.task.category_color || dragInfo.task.group_category_color)
            : dragInfo.task.group_id ? (dragInfo.task.group_color || '#5856D6') : 'var(--primary)',
          borderLeft: `3px solid ${(dragInfo.task.category_color || dragInfo.task.group_category_color) || (dragInfo.task.group_id ? (dragInfo.task.group_color || '#5856D6') : 'var(--primary)')}`,

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
          {resizeInfo.edge === 'date-end' ? 'â‡¥' : resizeInfo.edge === 'date-start' ? 'â‡¤' : resizeInfo.edge === 'start' ? 'â–²' : 'â–¼'} {resizeInfo.previewTime}
        </div>,
        document.body
      )}

      {/* Drop feedback toast */}
      {dropFeedback && createPortal(
        <div key={dropFeedback.id + dropFeedback.msg} className="cal-drop-toast">
          âœ“ {dropFeedback.msg}
        </div>,
        document.body
      )}

      {/* DayCreateModal â€” portals into fullscreen container when fullscreen */}
      <AnimatePresence>
        {showDayModal && selectedDate && (() => {
          const modalTarget = isCalendarFullscreen && calendarWrapperRef.current ? calendarWrapperRef.current : document.body;
          // Keep modal task source aligned with month/day rendering (stale-aware)
          const dayTasks = getTasksForSelectedDay();
          return (
            <DayCreateModal
              date={selectedDate}
              tasks={dayTasks}
              portalTarget={modalTarget}
              onClose={() => setShowDayModal(false)}
              onTaskCreated={() => {
                onTaskCreated?.();
                onVisibleRangeChange?.(null, null);
              }}
            />
          );
        })()}
      </AnimatePresence>
    </motion.div>
  );
}
