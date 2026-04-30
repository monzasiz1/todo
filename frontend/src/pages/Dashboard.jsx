import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FixedSizeList as VirtualList } from 'react-window';
import { useTaskStore } from '../store/taskStore';
import AIInput from '../components/AIInput';
import ManualTaskForm from '../components/ManualTaskForm';
import TaskCard from '../components/TaskCard';
import { CheckCircle2, Circle, Clock, ChevronDown, CalendarDays, AlertTriangle, Target, Plus, X, ChevronsDown, Flame, Zap, TrendingUp, CheckCheck, Coffee, Sunset, Moon } from 'lucide-react';
import { isToday, isTomorrow, isThisWeek, isPast, parseISO, format, startOfDay, compareAsc } from 'date-fns';
import { de } from 'date-fns/locale';
import { usePlan } from '../hooks/usePlan';
import UpgradeModal from '../components/UpgradeModal';

function getSeriesKey(task) {
  // Use user_id + normalized title + recurrence_rule as key.
  // This groups ALL instances of the same series regardless of whether they are
  // properly linked via recurrence_parent_id or are standalone roots (legacy data).
  if (!task.recurrence_rule) return null;
  const ownerId = task.user_id || 'u';
  const title = (task.title || '').toLowerCase().trim();
  return `${ownerId}::${title}::${task.recurrence_rule}`;
}

function deduplicateRecurring(tasks) {
  const today = startOfDay(new Date());

  // Step 1: Remove duplicate task rows caused by SQL JOIN on group_tasks/permissions
  const seenIds = new Set();
  const uniqueTasks = tasks.filter((t) => {
    if (seenIds.has(t.id)) return false;
    seenIds.add(t.id);
    return true;
  });

  // Step 2: Per recurring series keep only the next upcoming (or most recent past) instance
  const seriesMap = new Map(); // seriesKey → best task

  for (const task of uniqueTasks) {
    const seriesKey = getSeriesKey(task);
    if (!seriesKey) continue;

    const existing = seriesMap.get(seriesKey);
    if (!existing) {
      seriesMap.set(seriesKey, task);
      continue;
    }

    const tDateStr = task.date ? String(task.date).substring(0, 10) : null;
    const eDateStr = existing.date ? String(existing.date).substring(0, 10) : null;

    const tDate = tDateStr ? parseISO(tDateStr) : null;
    const eDate = eDateStr ? parseISO(eDateStr) : null;

    if (!tDate || isNaN(tDate.getTime())) continue;
    if (!eDate || isNaN(eDate.getTime())) { seriesMap.set(seriesKey, task); continue; }

    const tFuture = tDate >= today;
    const eFuture = eDate >= today;

    if (tFuture && !eFuture) {
      seriesMap.set(seriesKey, task);
    } else if (tFuture && eFuture) {
      if (tDate < eDate) seriesMap.set(seriesKey, task);
    } else if (!tFuture && !eFuture) {
      if (tDate > eDate) seriesMap.set(seriesKey, task);
    }
  }

  return uniqueTasks.filter((t) => {
    const seriesKey = getSeriesKey(t);
    if (!seriesKey) return true;
    return seriesMap.get(seriesKey)?.id === t.id;
  });
}

function groupTasksByDate(tasks) {
  const now = new Date();
  const nowTs = now.getTime();
  const todayStart = startOfDay(now);

  const overdue = [];
  const today = [];
  const tomorrow = [];
  const thisWeek = [];
  const later = [];
  const noDate = [];
  const pastEvents = [];

  for (const task of tasks) {
    if (task.completed) continue;

    if (!task.date) {
      noDate.push(task);
      continue;
    }

    const d = parseISO(task.date);

    if (isPast(d) && !isToday(d)) {
      // Beendete Termine archivieren – nicht als überfällig markieren
      if (isEventEnded(task, nowTs)) {
        pastEvents.push(task);
      } else {
        overdue.push(task);
      }
    } else if (isToday(d)) {
      today.push(task);
    } else if (isTomorrow(d)) {
      tomorrow.push(task);
    } else if (isThisWeek(d, { weekStartsOn: 1 })) {
      thisWeek.push(task);
    } else {
      later.push(task);
    }
  }

  // Sort each group by time, then priority
  const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
  const sortGroup = (arr) =>
    arr.sort((a, b) => {
      if (a.date !== b.date) return compareAsc(parseISO(a.date || '9999-01-01'), parseISO(b.date || '9999-01-01'));
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time) return -1;
      if (b.time) return 1;
      return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
    });

  return [
    { key: 'overdue', label: 'Überfällig', icon: AlertTriangle, color: '#FF3B30', tasks: sortGroup(overdue) },
    { key: 'today', label: 'Heute', icon: Clock, color: '#FF9500', tasks: sortGroup(today) },
    { key: 'tomorrow', label: 'Morgen', icon: CalendarDays, color: '#007AFF', tasks: sortGroup(tomorrow) },
    { key: 'week', label: 'Diese Woche', icon: CalendarDays, color: '#5856D6', tasks: sortGroup(thisWeek) },
    { key: 'later', label: 'Später', icon: CalendarDays, color: '#8E8E93', tasks: sortGroup(later) },
    { key: 'nodate', label: 'Ohne Datum', icon: Circle, color: '#8E8E93', tasks: sortGroup(noDate) },
    { key: 'past_events', label: 'Vergangene Termine', icon: CalendarDays, color: '#8E8E93', tasks: sortGroup(pastEvents) },
  ].filter((g) => g.tasks.length > 0);
}

function parseTaskDate(task) {
  if (!task?.date) return null;
  const d = parseISO(String(task.date));
  return Number.isNaN(d.getTime()) ? null : d;
}

function getEventEndDate(task) {
  if (!task) return null;
  const datePart = String(task.date_end || task.date || '').slice(0, 10);
  if (!datePart) return null;

  const rawEnd = String(task.time_end || task.time || '23:59');
  const m = rawEnd.match(/(\d{1,2}):(\d{2})/);
  const hh = String(Math.min(23, Math.max(0, Number(m?.[1]) || 23))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, Number(m?.[2]) || 59))).padStart(2, '0');
  const dt = new Date(`${datePart}T${hh}:${mm}:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function isEventEnded(task, nowTs = Date.now()) {
  if (task?.type !== 'event') return false;
  const end = getEventEndDate(task);
  return !!end && end.getTime() < nowTs;
}

function getPlannedHoursRemainingToday(tasks, nowDate = new Date()) {
  const toMins = (time) => {
    if (!time) return null;
    const [h, m] = String(time).split(':').map((v) => parseInt(v, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return (h * 60) + m;
  };

  const nowMins = nowDate.getHours() * 60 + nowDate.getMinutes();
  let total = 0;

  tasks.forEach((t) => {
    const start = toMins(t.time);
    if (start === null) return;
    const endRaw = toMins(t.time_end);
    const end = endRaw && endRaw > start ? endRaw : start + 60;

    const segStart = Math.max(start, nowMins);
    const segEnd = Math.min(24 * 60, end);
    if (segEnd <= segStart) return;

    total += (segEnd - segStart);
  });

  return total / 60;
}

function buildSmartInsights({
  overdueCount,
  todayCount,
  urgentTodayCount,
  freeHours,
  upcomingEventsCount,
  remainingHoursToday,
  weekCompletionRate,
  completedTodayCount,
  totalTodayCount,
}) {
  const hour = new Date().getHours();
  const isMorning = hour >= 5 && hour < 12;
  const isAfternoon = hour >= 12 && hour < 18;
  const isEvening = hour >= 18 || hour < 5;

  const freeHoursLabel = `${Math.max(0, freeHours).toFixed(1).replace('.', ',')}h`;
  const capacity = Math.max(1, Math.min(6, Math.round(Math.max(0, freeHours) / 1.5)));
  const todayProgress = totalTodayCount > 0 ? Math.round((completedTodayCount / totalTodayCount) * 100) : 0;

  const items = [];

  // 1. Tageszeit-Kontext (Motivation / Empfehlung)
  if (isMorning) {
    items.push({
      key: 'timeofday',
      icon: Coffee,
      color: '#FF9500',
      label: 'Morgen-Fokus',
      text: overdueCount > 0
        ? `Start mit den ${overdueCount} überfälligen Aufgaben – dann den Tag frei gestalten.`
        : urgentTodayCount > 0
          ? `${urgentTodayCount} dringende Aufgaben heute. Starte mit der wichtigsten, solange Energie hoch.`
          : totalTodayCount > 0
            ? `Guter Morgen! ${totalTodayCount} Aufgaben warten. Plane die 3 wichtigsten für heute.`
            : `Guter Morgen! Kein Druck heute – nutze die Zeit für Planung oder neue Ziele.`,
    });
  } else if (isAfternoon) {
    items.push({
      key: 'timeofday',
      icon: Zap,
      color: '#007AFF',
      label: 'Nachmittag',
      text: totalTodayCount > 0 && completedTodayCount === 0
        ? `Nachmittag läuft – ${totalTodayCount} Aufgaben noch offen. Konzentriere dich auf eine Aufgabe auf einmal.`
        : completedTodayCount > 0
          ? `Gut gemacht! ${completedTodayCount} erledigt. Noch ${totalTodayCount - completedTodayCount} übrig, du schaffst das.`
          : `Nachmittag – ${freeHoursLabel} frei. Perfekte Zeit für tiefes Arbeiten.`,
    });
  } else {
    items.push({
      key: 'timeofday',
      icon: Moon,
      color: '#5856D6',
      label: 'Abend',
      text: completedTodayCount > 0
        ? `${completedTodayCount} Aufgaben heute erledigt – starker Tag! Bereite morgen kurz vor.`
        : overdueCount > 0
          ? `${overdueCount} Aufgaben noch offen. Schließe das Wichtigste ab, der Rest wartet auf morgen.`
          : `Ruhiger Abend. Kein offener Druck – gut für Regeneration und Planung von morgen.`,
    });
  }

  // 2. Überfällig / Dringend – Alarm wenn nötig
  if (overdueCount > 0) {
    items.push({
      key: 'overdue',
      icon: AlertTriangle,
      color: '#FF3B30',
      label: 'Überfällig',
      text: overdueCount === 1
        ? `1 Aufgabe ist überfällig – erledige sie zuerst, bevor Neues dazukommt.`
        : `${overdueCount} Aufgaben sind überfällig. Priorisiere oder verschiebe sie bewusst.`,
      badge: overdueCount,
      badgeColor: '#FF3B30',
    });
  } else if (urgentTodayCount > 0) {
    items.push({
      key: 'urgent',
      icon: Flame,
      color: '#FF6B00',
      label: 'Dringend heute',
      text: `${urgentTodayCount} dringende Aufgabe${urgentTodayCount > 1 ? 'n' : ''} für heute. Konzentriere dich auf die eine wichtigste zuerst.`,
      badge: urgentTodayCount,
      badgeColor: '#FF6B00',
    });
  }

  // 3. Tagesfortschritt
  if (totalTodayCount > 0) {
    items.push({
      key: 'progress',
      icon: CheckCheck,
      color: '#34C759',
      label: 'Heute Fortschritt',
      text: todayProgress === 100
        ? `Alle Aufgaben für heute erledigt! Ausgezeichnete Leistung.`
        : todayProgress >= 50
          ? `${completedTodayCount} von ${totalTodayCount} erledigt (${todayProgress}%). Gutes Tempo – weiter so!`
          : completedTodayCount > 0
            ? `${completedTodayCount} von ${totalTodayCount} erledigt. Fokussiere die nächste Aufgabe.`
            : `${totalTodayCount} Aufgaben heute geplant. Starte mit der ersten – Momentum entsteht durch Action.`,
      progress: todayProgress,
    });
  }

  // 4. Wochenperformance / Kapazität
  if (weekCompletionRate >= 80) {
    items.push({
      key: 'week',
      icon: TrendingUp,
      color: '#30D158',
      label: 'Woche',
      text: `${weekCompletionRate}% der Wochenaufgaben erledigt – du bist im Flow!`,
    });
  } else if (upcomingEventsCount > 0) {
    items.push({
      key: 'capacity',
      icon: CalendarDays,
      color: '#5856D6',
      label: 'Termine',
      text: remainingHoursToday <= 1
        ? `Heute kaum Zeit verbleibend – nur das Wichtigste.`
        : `${freeHoursLabel} frei, ${upcomingEventsCount} Termin${upcomingEventsCount > 1 ? 'e' : ''} bald. Plane Puffer davor und danach.`,
    });
  } else if (freeHours > 0) {
    items.push({
      key: 'capacity',
      icon: CalendarDays,
      color: '#5856D6',
      label: 'Kapazität',
      text: freeHours >= 4
        ? `${freeHoursLabel} freie Zeit – genug für ${capacity} fokussierte Aufgaben.`
        : `${freeHoursLabel} verbleibend – realistisch 1–2 Aufgaben einplanen.`,
    });
  }

  return items;
}

const VIRTUAL_THRESHOLD = 24;
const VIRTUAL_ITEM_SIZE = 112;
const VIRTUAL_MAX_HEIGHT = 560;
const DASHBOARD_FETCH_LIMIT = '160';
const DASHBOARD_HORIZON_DAYS = '28';
const DASHBOARD_COMPLETED_LOOKBACK_DAYS = '30';
const INITIAL_GROUP_VISIBLE = 18;
const GROUP_VISIBLE_STEP = 18;

function initialVisibleCountMap(groups) {
  const map = {};
  groups.forEach((group) => {
    map[group.key] = INITIAL_GROUP_VISIBLE;
  });
  return map;
}

function TaskRow({ index, style, data }) {
  const task = data.tasks[index];
  return (
    <div style={style}>
      <div style={{ paddingBottom: 10 }}>
        <TaskCard task={task} index={index} disableLayout showDashboardDateTile />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { tasks, fetchTasks, filter, setFilter } = useTaskStore();
  const { limit, atLimit } = usePlan();
  const [showCompleted, setShowCompleted] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 1024;
    return { today: isMobile, week: true, later: true, past_events: true };
  });
  const [groupVisibleCounts, setGroupVisibleCounts] = useState({});
  const [showTaskLimitModal, setShowTaskLimitModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [nowTs, setNowTs] = useState(Date.now());
  const [aiCollapsed, setAiCollapsed] = useState(false);
  const [focusCollapsed, setFocusCollapsed] = useState(false);
  const [topCollapsed, setTopCollapsed] = useState(() => {
    try { return localStorage.getItem('dash_top_collapsed') === 'true'; } catch { return false; }
  });

  const toggleTop = () => setTopCollapsed(v => {
    const next = !v;
    try { localStorage.setItem('dash_top_collapsed', next); } catch {}
    return next;
  });

  useEffect(() => {
    // Load all tasks (open AND closed), let frontend filter do the rest
    fetchTasks({
      dashboard: 'true',
      limit: DASHBOARD_FETCH_LIMIT,
      horizon_days: DASHBOARD_HORIZON_DAYS,
      completed_lookback_days: DASHBOARD_COMPLETED_LOOKBACK_DAYS,
    }, { force: true });

    // Auto-refresh every 60 s so newly shared/group tasks appear without manual reload
    const interval = setInterval(() => {
      if (!document.hidden) {
        fetchTasks({
          dashboard: 'true',
          limit: DASHBOARD_FETCH_LIMIT,
          horizon_days: DASHBOARD_HORIZON_DAYS,
          completed_lookback_days: DASHBOARD_COMPLETED_LOOKBACK_DAYS,
        });
      }
    }, 60000);

    const refreshOnFocus = () => {
      fetchTasks({
        dashboard: 'true',
        limit: DASHBOARD_FETCH_LIMIT,
        horizon_days: DASHBOARD_HORIZON_DAYS,
        completed_lookback_days: DASHBOARD_COMPLETED_LOOKBACK_DAYS,
      }, { force: true });
    };
    const refreshOnTaskChanged = () => {
      fetchTasks({
        dashboard: 'true',
        limit: DASHBOARD_FETCH_LIMIT,
        horizon_days: DASHBOARD_HORIZON_DAYS,
        completed_lookback_days: DASHBOARD_COMPLETED_LOOKBACK_DAYS,
      }, { force: true });
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);
    window.addEventListener('beequ:tasks-changed', refreshOnTaskChanged);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
      window.removeEventListener('beequ:tasks-changed', refreshOnTaskChanged);
    };
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

  const filtered = useMemo(() => {
    const search = (filter.search || '').toLowerCase();
    return tasks.filter((t) => {
      if (filter.category && t.category_id !== filter.category) return false;
      if (filter.priority && t.priority !== filter.priority) return false;
      if (filter.completed !== null && t.completed !== filter.completed) return false;
      if (search && !(t.title || '').toLowerCase().includes(search)) return false;
      return true;
    });
  }, [tasks, filter.category, filter.priority, filter.completed, filter.search]);

  const deduplicated = useMemo(
    () => deduplicateRecurring(filtered.filter((t) => !t.completed)),
    [filtered]
  );

  const groups = useMemo(() => groupTasksByDate(deduplicated), [deduplicated]);

  useEffect(() => {
    setGroupVisibleCounts((prev) => {
      const next = { ...initialVisibleCountMap(groups), ...prev };
      const validKeys = new Set(groups.map((g) => g.key));
      Object.keys(next).forEach((key) => {
        if (!validKeys.has(key)) delete next[key];
      });
      return next;
    });
  }, [groups]);

  const completedTasks = useMemo(
    () => filtered
      .filter((t) => t.completed)
      .sort((a, b) => compareAsc(parseISO(b.updated_at || b.created_at), parseISO(a.updated_at || a.created_at)))
      .slice(0, 20),
    [filtered]
  );

  const todayTasks = useMemo(
    () => deduplicated.filter((t) => {
      const d = parseTaskDate(t);
      if (!(d && isToday(d))) return false;
      if (t.type === 'event' && isEventEnded(t, nowTs)) return false;
      return true;
    }),
    [deduplicated, nowTs]
  );

  const overdueCount = useMemo(
    () => deduplicated.filter((t) => {
      const d = parseTaskDate(t);
      if (!d || !isPast(d) || isToday(d)) return false;
      // Beendete Termine sind nicht überfällig
      if (isEventEnded(t, nowTs)) return false;
      return true;
    }).length,
    [deduplicated, nowTs]
  );

  const urgentTodayCount = useMemo(
    () => todayTasks.filter((t) => t.priority === 'urgent' || t.priority === 'high').length,
    [todayTasks]
  );

  const upcomingEventsCount = useMemo(
    () => deduplicated.filter((t) => {
      const d = parseTaskDate(t);
      if (!d) return false;
      if (t.type !== 'event') return false;
      if (isEventEnded(t, nowTs)) return false;
      return isToday(d) || isTomorrow(d);
    }).length,
    [deduplicated, nowTs]
  );

  const remainingHoursToday = useMemo(() => {
    const now = new Date(nowTs);
    const minsLeft = Math.max(0, (24 * 60) - (now.getHours() * 60 + now.getMinutes()));
    return minsLeft / 60;
  }, [nowTs]);

  const plannedHoursRemainingToday = useMemo(
    () => getPlannedHoursRemainingToday(todayTasks, new Date(nowTs)),
    [todayTasks, nowTs]
  );

  const freeHours = useMemo(
    () => Math.max(0, remainingHoursToday - plannedHoursRemainingToday),
    [remainingHoursToday, plannedHoursRemainingToday]
  );

  const weekCompletionRate = useMemo(() => {
    const weekTasks = tasks.filter((t) => {
      const d = parseTaskDate(t);
      return d && isThisWeek(d, { weekStartsOn: 1 });
    });
    return weekTasks.length > 0
      ? Math.round((weekTasks.filter((t) => t.completed).length / weekTasks.length) * 100)
      : 0;
  }, [tasks]);

  const insights = useMemo(() => buildSmartInsights({
    overdueCount,
    todayCount: todayTasks.length,
    urgentTodayCount,
    freeHours,
    upcomingEventsCount,
    remainingHoursToday,
    weekCompletionRate,
    completedTodayCount: todayTasks.filter(t => t.completed).length,
    totalTodayCount: todayTasks.length,
  }), [overdueCount, todayTasks, urgentTodayCount, freeHours, upcomingEventsCount, remainingHoursToday, weekCompletionRate]);

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'Guten Morgen' : greetingHour < 18 ? 'Guten Tag' : 'Guten Abend';

  const toggleSection = (key) => {
    setCollapsedSections((s) => ({ ...s, [key]: !s[key] }));
  };

  const showMoreInSection = (key) => {
    setGroupVisibleCounts((s) => ({
      ...s,
      [key]: Math.max(INITIAL_GROUP_VISIBLE, (s[key] || INITIAL_GROUP_VISIBLE) + GROUP_VISIBLE_STEP),
    }));
  };

  const priorities = [
    { value: null,     label: 'Alle',     color: null },
    { value: 'urgent', label: 'Dringend', color: '#FF3B30' },
    { value: 'high',   label: 'Hoch',     color: '#FF9500' },
    { value: 'medium', label: 'Mittel',   color: '#007AFF' },
    { value: 'low',    label: 'Niedrig',  color: '#34C759' },
  ];

  return (
    <div className="dashboard-page">
      {/* Header */}
      <motion.div
        className="page-header"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="page-header-left">
          <h2>{greeting} 👋</h2>
          <p>Was steht heute an?</p>
        </div>
        <button className="dash-top-toggle" onClick={toggleTop} aria-label="Eingabe ein-/ausblenden">
          <ChevronDown size={18} className={`dash-top-toggle-chevron${topCollapsed ? ' rotated' : ''}`} />
        </button>
      </motion.div>

      {/* Task-Limit Warning / Upgrade Modal */}
      {showTaskLimitModal && (
        <UpgradeModal feature="tasks" onClose={() => setShowTaskLimitModal(false)} />
      )}

      {/* Task Creation + Focus – collapsible on mobile */}
      <AnimatePresence initial={false}>
        {!topCollapsed && (
          <motion.div
            key="top-panel"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
      {/* Task Creation */}
      <div className="task-creation-stack">
        {atLimit('tasks', tasks.filter(t => !t.completed).length) && (
          <div
            className="task-limit-banner"
            onClick={() => setShowTaskLimitModal(true)}
          >
            Du hast das Limit von <strong>{limit('tasks')}</strong> aktiven Aufgaben erreicht.
            <span className="task-limit-upgrade">Upgrade für unbegrenzte Aufgaben →</span>
          </div>
        )}
              <AIInput />
              <button
                className="manual-task-launcher dashboard-manual-launcher"
                onClick={() => setShowManualModal(true)}
              >
                <span className="manual-task-launcher-left">
                  <div className="manual-task-launcher-icon"><Plus size={16} /></div>
                  <div className="manual-task-launcher-copy">
                    <strong>Manuell erstellen</strong>
                    <span>Aufgabe oder Termin ohne KI anlegen</span>
                  </div>
                </span>
                <ChevronDown size={18} className="manual-task-launcher-chevron" />
              </button>
      </div>

      <section className="smart-insights" aria-label="Smart Insights">
        <div className="smart-insights-head">
          <div className="smart-insights-title">
            <Target size={14} />
            Fokus heute
          </div>
          <div className="smart-insights-meta-wrap">
            <span className="smart-insights-meta">Heute: {todayTasks.length}</span>
            <span className="smart-insights-meta">Überfällig: {overdueCount}</span>
            <span className="smart-insights-meta">Woche: {weekCompletionRate}%</span>
          </div>
        </div>
        <div className="smart-insights-list">
          {insights.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.key} className={`smart-insight-item${item.badge ? ' smart-insight-item--alert' : ''}`}>
                <div className="smart-insight-icon" style={{ background: `${item.color}18`, color: item.color }}>
                  <Icon size={14} />
                </div>
                <div className="smart-insight-body">
                  {item.label && <span className="smart-insight-label" style={{ color: item.color }}>{item.label}</span>}
                  <p>{item.text}</p>
                  {item.progress !== undefined && (
                    <div className="smart-insight-progress">
                      <div className="smart-insight-progress-bar" style={{ width: `${item.progress}%`, background: item.color }} />
                    </div>
                  )}
                </div>
                {item.badge && (
                  <span className="smart-insight-badge" style={{ background: `${item.badgeColor}18`, color: item.badgeColor }}>
                    {item.badge}
                  </span>
                )}
              </article>
            );
          })}
        </div>
      </section>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manuell-Erstellungs-Modal (Desktop) */}
      <AnimatePresence>
        {showManualModal && (
          <motion.div
            key="manual-modal"
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setShowManualModal(false)}
            style={{ zIndex: 1000 }}
          >
            <motion.div
              className="manual-task-modal-wrap"
              initial={{ opacity: 0, scale: 0.95, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 340 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="manual-task-modal-header">
                <h3>Aufgabe / Termin erstellen</h3>
                <button className="manual-task-modal-close" onClick={() => setShowManualModal(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="manual-task-modal-body">
                <ManualTaskForm
                  embedded
                  onTaskCreated={() => {
                    setShowManualModal(false);
                    fetchTasks({
                      dashboard: 'true',
                      limit: DASHBOARD_FETCH_LIMIT,
                      horizon_days: DASHBOARD_HORIZON_DAYS,
                      completed_lookback_days: DASHBOARD_COMPLETED_LOOKBACK_DAYS,
                    }, { force: true });
                  }}
                  onCancel={() => setShowManualModal(false)}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter Bar */}
      <div className="filter-bar">
        {priorities.map((p) => (
          <button
            key={p.value || 'all'}
            className={`filter-btn ${filter.priority === p.value ? 'active' : ''}`}
            style={p.color ? { '--dot-color': p.color } : {}}
            onClick={() => setFilter('priority', p.value)}
          >
            {p.color && <span className="filter-dot" />}
            {p.label}
          </button>
        ))}
        <input
          type="text"
          className="filter-search"
          placeholder="Suchen..."
          value={filter.search}
          onChange={(e) => setFilter('search', e.target.value)}
        />
      </div>

      {/* Date-Grouped Task Sections */}
      {groups.length > 0 ? (
        groups.map((group) => {
          const Icon = group.icon;
          const collapsed = collapsedSections[group.key];
          const visibleCount = groupVisibleCounts[group.key] || INITIAL_GROUP_VISIBLE;
          const visibleTasks = group.tasks.slice(0, visibleCount);
          const hasMore = visibleTasks.length < group.tasks.length;
          return (
            <div key={group.key} className="dash-section" data-section={group.key}>
              <button
                className="dash-section-header"
                onClick={() => toggleSection(group.key)}
              >
                <div className="dash-section-left">
                  <div className="dash-section-icon" style={{ background: `${group.color}15`, color: group.color }}>
                    <Icon size={16} />
                  </div>
                  <span className="dash-section-title">{group.label}</span>
                  <span className="dash-section-count">{group.tasks.length}</span>
                </div>
                <ChevronDown
                  size={16}
                  className={`dash-section-chevron ${collapsed ? '' : 'open'}`}
                />
              </button>
              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.div
                    className="dash-section-list"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {visibleTasks.length > VIRTUAL_THRESHOLD ? (
                      <VirtualList
                        height={Math.min(VIRTUAL_MAX_HEIGHT, visibleTasks.length * VIRTUAL_ITEM_SIZE)}
                        itemCount={visibleTasks.length}
                        itemSize={VIRTUAL_ITEM_SIZE}
                        width="100%"
                        itemData={{ tasks: visibleTasks }}
                      >
                        {TaskRow}
                      </VirtualList>
                    ) : (
                      visibleTasks.map((task, i) => (
                        <TaskCard key={task.id} task={task} index={i} showDashboardDateTile />
                      ))
                    )}
                    {hasMore && (
                      <button className="group-load-more-btn" onClick={() => showMoreInSection(group.key)}>
                        <ChevronsDown size={14} /> Mehr anzeigen ({group.tasks.length - visibleTasks.length})
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon">
            <CheckCircle2 size={36} />
          </div>
          <h3>Alles erledigt!</h3>
          <p>Nutze die KI-Eingabe oder manuelle Eingabe oben, um neue Aufgaben zu erstellen.</p>
        </div>
      )}

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <div className="dash-section dash-section-completed">
          <button
            className="dash-section-header"
            onClick={() => setShowCompleted(!showCompleted)}
          >
            <div className="dash-section-left">
              <div className="dash-section-icon" style={{ background: 'rgba(52,199,89,0.1)', color: '#34C759' }}>
                <CheckCircle2 size={16} />
              </div>
              <span className="dash-section-title">Erledigt</span>
              <span className="dash-section-count">{completedTasks.length}</span>
            </div>
            <ChevronDown
              size={16}
              className={`dash-section-chevron ${showCompleted ? 'open' : ''}`}
            />
          </button>
          <AnimatePresence initial={false}>
            {showCompleted && (
              <motion.div
                className="dash-section-list"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {completedTasks.length > VIRTUAL_THRESHOLD ? (
                  <VirtualList
                    height={Math.min(VIRTUAL_MAX_HEIGHT, completedTasks.length * VIRTUAL_ITEM_SIZE)}
                    itemCount={completedTasks.length}
                    itemSize={VIRTUAL_ITEM_SIZE}
                    width="100%"
                    itemData={{ tasks: completedTasks }}
                  >
                    {TaskRow}
                  </VirtualList>
                ) : (
                  completedTasks.map((task, i) => (
                    <TaskCard key={task.id} task={task} index={i} showDashboardDateTile />
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

