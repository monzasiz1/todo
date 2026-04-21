import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTaskStore } from '../store/taskStore';
import AIInput from '../components/AIInput';
import ManualTaskForm from '../components/ManualTaskForm';
import TaskCard from '../components/TaskCard';
import { CheckCircle2, Circle, Clock, ChevronDown, CalendarDays, AlertTriangle, Sparkles, SlidersHorizontal } from 'lucide-react';
import { isToday, isTomorrow, isThisWeek, isPast, parseISO, format, startOfDay, compareAsc } from 'date-fns';
import { de } from 'date-fns/locale';

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

export default function Dashboard() {
  const { tasks, taskSummary, fetchTasks, fetchTasksSummary, fetchCategories, filter, setFilter, getFilteredTasks } = useTaskStore();
  const [showCompleted, setShowCompleted] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState({});

  useEffect(() => {
    fetchTasks({ lite: 'true', completed: 'false' }, { force: true });
    fetchTasksSummary();
    fetchCategories();

    // Auto-refresh every 60 s so newly shared/group tasks appear without manual reload
    const interval = setInterval(() => {
      if (!document.hidden) {
        fetchTasks({ lite: 'true', completed: filter.completed === true ? 'true' : 'false' }, { force: true });
        fetchTasksSummary();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [filter.completed]);

  const filtered = getFilteredTasks();
  const deduplicated = deduplicateRecurring(filtered.filter((t) => !t.completed));
  const groups = groupTasksByDate(deduplicated);
  const completedTasks = filtered.filter((t) => t.completed)
    .sort((a, b) => compareAsc(parseISO(b.updated_at || b.created_at), parseISO(a.updated_at || a.created_at)))
    .slice(0, 20);

  const openTasks = tasks.filter((t) => !t.completed);
  const importantToday = openTasks.filter((t) => t.date && isToday(parseISO(t.date)) && (t.priority === 'urgent' || t.priority === 'high')).length;
  const overdueCount = openTasks.filter((t) => t.date && isPast(parseISO(t.date)) && !isToday(parseISO(t.date))).length;
  const doableToday = openTasks.filter((t) => (!t.date || isToday(parseISO(t.date))) && t.priority !== 'urgent').length;

  const insights = [
    {
      key: 'important',
      icon: AlertTriangle,
      color: '#FF3B30',
      text: `Du hast heute ${importantToday} wichtige ${importantToday === 1 ? 'Aufgabe' : 'Aufgaben'}`,
    },
    {
      key: 'overdue',
      icon: Clock,
      color: '#FF9500',
      text: `${overdueCount} ${overdueCount === 1 ? 'Aufgabe ist' : 'Aufgaben sind'} überfällig`,
    },
    {
      key: 'doable',
      icon: CheckCircle2,
      color: '#34C759',
      text: `Heute machbar: ${doableToday} ${doableToday === 1 ? 'Task' : 'Tasks'}`,
    },
  ];

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

      {/* Task Creation */}
      <div className="task-creation-stack">
        <AIInput />
        <ManualTaskForm
          onTaskCreated={() => {
            fetchTasks({ lite: 'true', completed: filter.completed === true ? 'true' : 'false' }, { force: true });
            fetchTasksSummary();
          }}
        />
      </div>

      {/* Smart Insights */}
      <div className="smart-insights">
        <div className="smart-insights-head">
          <div className="smart-insights-title"><Sparkles size={16} /> Smart Insights</div>
          <div className="smart-insights-meta">{taskSummary?.open ?? openTasks.length} offen</div>
        </div>
        <div className="smart-insights-list">
          {insights.map((item, i) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={item.key}
                className="smart-insight-item"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: i * 0.05 }}
              >
                <span className="smart-insight-icon" style={{ color: item.color, background: `${item.color}15` }}>
                  <Icon size={14} />
                </span>
                <span>{item.text}</span>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Collapsible Categories/Filter */}
      <button className="dash-filters-toggle" onClick={() => setShowFilters((v) => !v)}>
        <span><SlidersHorizontal size={15} /> Kategorien & Filter</span>
        <ChevronDown size={16} className={`dash-section-chevron ${showFilters ? 'open' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {showFilters && (
          <motion.div
            className="filter-bar"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
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
          </motion.div>
        )}
      </AnimatePresence>

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
                    {group.tasks.map((task, i) => (
                      <TaskCard key={task.id} task={task} index={i} />
                    ))}
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
                {completedTasks.map((task, i) => (
                  <TaskCard key={task.id} task={task} index={i} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
