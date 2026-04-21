import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FixedSizeList as VirtualList } from 'react-window';
import { useTaskStore } from '../store/taskStore';
import AIInput from '../components/AIInput';
import ManualTaskForm from '../components/ManualTaskForm';
import TaskCard from '../components/TaskCard';
import { CheckCircle2, Circle, Clock, ChevronDown, CalendarDays, AlertTriangle, Target } from 'lucide-react';
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
  const todayStart = startOfDay(now);

  const overdue = [];
  const today = [];
  const tomorrow = [];
  const thisWeek = [];
  const later = [];
  const noDate = [];

  for (const task of tasks) {
    if (task.completed) continue;

    if (!task.date) {
      noDate.push(task);
      continue;
    }

    const d = parseISO(task.date);

    if (isPast(d) && !isToday(d)) {
      overdue.push(task);
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
  ].filter((g) => g.tasks.length > 0);
}

function parseTaskDate(task) {
  if (!task?.date) return null;
  const d = parseISO(String(task.date));
  return Number.isNaN(d.getTime()) ? null : d;
}

function getPlannedHoursToday(tasks) {
  const toMins = (time) => {
    if (!time) return null;
    const [h, m] = String(time).split(':').map((v) => parseInt(v, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return (h * 60) + m;
  };

  let total = 0;
  tasks.forEach((t) => {
    const start = toMins(t.time);
    if (start === null) return;
    const endRaw = toMins(t.time_end);
    const end = endRaw && endRaw > start ? endRaw : start + 60;
    total += Math.max(30, end - start);
  });
  return total / 60;
}

function buildSmartInsights({ overdueCount, todayCount, urgentTodayCount, freeHours, upcomingEventsCount }) {
  const freeHoursLabel = `${Math.max(0, freeHours).toFixed(1).replace('.', ',')}`;
  const capacity = Math.max(1, Math.min(7, Math.round(Math.max(0, freeHours) / 1.5)));

  const primaryText = overdueCount > 0
    ? `${overdueCount} Aufgaben sind überfällig, beginne dort und entlaste den Tag.`
    : urgentTodayCount > 0
      ? `${urgentTodayCount} Aufgaben sind heute wichtig, starte mit der kritischsten zuerst.`
      : `Heute zählen ${todayCount} Aufgaben, fokussiere nur die wichtigsten zuerst.`;

  const secondaryText = upcomingEventsCount > 0
    ? `Heute sind ${freeHoursLabel} freie Stunden, ${upcomingEventsCount} Termine stehen bald an.`
    : `Heute sind ${freeHoursLabel} freie Stunden, plane ${capacity} klare Aufgaben.`;

  return [
    {
      key: 'priority',
      icon: overdueCount > 0 ? AlertTriangle : Target,
      color: overdueCount > 0 ? '#FF3B30' : '#007AFF',
      text: primaryText,
    },
    {
      key: 'capacity',
      icon: CalendarDays,
      color: '#5856D6',
      text: secondaryText,
    },
  ];
}

const VIRTUAL_THRESHOLD = 24;
const VIRTUAL_ITEM_SIZE = 112;
const VIRTUAL_MAX_HEIGHT = 560;
const DASHBOARD_FETCH_LIMIT = '400';

function TaskRow({ index, style, data }) {
  const task = data.tasks[index];
  return (
    <div style={style}>
      <div style={{ paddingBottom: 10 }}>
        <TaskCard task={task} index={index} disableLayout />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { tasks, fetchTasks, filter, setFilter } = useTaskStore();
  const { limit, atLimit } = usePlan();
  const [showCompleted, setShowCompleted] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState({});
  const [showTaskLimitModal, setShowTaskLimitModal] = useState(false);

  useEffect(() => {
    // Load all tasks (open AND closed), let frontend filter do the rest
    fetchTasks({ dashboard: 'true', limit: DASHBOARD_FETCH_LIMIT }, { force: true });

    // Auto-refresh every 60 s so newly shared/group tasks appear without manual reload
    const interval = setInterval(() => {
      if (!document.hidden) {
        fetchTasks({ dashboard: 'true', limit: DASHBOARD_FETCH_LIMIT });
      }
    }, 60000);
    return () => clearInterval(interval);
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
      return d && isToday(d);
    }),
    [deduplicated]
  );

  const overdueCount = useMemo(
    () => deduplicated.filter((t) => {
      const d = parseTaskDate(t);
      return d && isPast(d) && !isToday(d);
    }).length,
    [deduplicated]
  );

  const urgentTodayCount = useMemo(
    () => todayTasks.filter((t) => t.priority === 'urgent' || t.priority === 'high').length,
    [todayTasks]
  );

  const upcomingEventsCount = useMemo(
    () => deduplicated.filter((t) => {
      const d = parseTaskDate(t);
      if (!d) return false;
      return (t.type === 'event') && (isToday(d) || isTomorrow(d));
    }).length,
    [deduplicated]
  );

  const plannedHoursToday = useMemo(() => getPlannedHoursToday(todayTasks), [todayTasks]);
  const freeHours = useMemo(() => Math.max(0, 8 - plannedHoursToday), [plannedHoursToday]);

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
  }), [overdueCount, todayTasks.length, urgentTodayCount, freeHours, upcomingEventsCount]);

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'Guten Morgen' : greetingHour < 18 ? 'Guten Tag' : 'Guten Abend';

  const toggleSection = (key) => {
    setCollapsedSections((s) => ({ ...s, [key]: !s[key] }));
  };

  const priorities = [
    { value: null,     label: 'Alle',     color: null },
    { value: 'urgent', label: 'Dringend', color: '#FF3B30' },
    { value: 'high',   label: 'Hoch',     color: '#FF9500' },
    { value: 'medium', label: 'Mittel',   color: '#007AFF' },
    { value: 'low',    label: 'Niedrig',  color: '#34C759' },
  ];

  return (
    <div>
      {/* Header */}
      <motion.div
        className="page-header"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h2>{greeting} 👋</h2>
        <p>Was steht heute an?</p>
      </motion.div>

      {/* Task-Limit Warning / Upgrade Modal */}
      {showTaskLimitModal && (
        <UpgradeModal feature="tasks" onClose={() => setShowTaskLimitModal(false)} />
      )}

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
        <ManualTaskForm
          onTaskCreated={() => {
            fetchTasks({ dashboard: 'true', limit: DASHBOARD_FETCH_LIMIT }, { force: true });
          }}
        />
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
              <article key={item.key} className="smart-insight-item">
                <div className="smart-insight-icon" style={{ background: `${item.color}18`, color: item.color }}>
                  <Icon size={14} />
                </div>
                <p>{item.text}</p>
              </article>
            );
          })}
        </div>
      </section>

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
                    {group.tasks.length > VIRTUAL_THRESHOLD ? (
                      <VirtualList
                        height={Math.min(VIRTUAL_MAX_HEIGHT, group.tasks.length * VIRTUAL_ITEM_SIZE)}
                        itemCount={group.tasks.length}
                        itemSize={VIRTUAL_ITEM_SIZE}
                        width="100%"
                        itemData={{ tasks: group.tasks }}
                      >
                        {TaskRow}
                      </VirtualList>
                    ) : (
                      group.tasks.map((task, i) => (
                        <TaskCard key={task.id} task={task} index={i} />
                      ))
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
                    <TaskCard key={task.id} task={task} index={i} />
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
