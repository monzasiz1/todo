import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTaskStore } from '../store/taskStore';
import AIInput from '../components/AIInput';
import ManualTaskForm from '../components/ManualTaskForm';
import TaskCard from '../components/TaskCard';
import { CheckCircle2, Circle, Clock, Flame, ChevronDown, CalendarDays, AlertTriangle } from 'lucide-react';
import { isToday, isTomorrow, isThisWeek, isPast, parseISO, format, startOfDay, compareAsc } from 'date-fns';
import { de } from 'date-fns/locale';

function getSeriesKey(task) {
  // Parent-Task: hat recurrence_rule aber keine recurrence_parent_id → Key = eigene ID
  // Kind-Task: hat recurrence_parent_id → Key = Parent-ID
  // Beide ergeben denselben Key damit sie als eine Serie behandelt werden
  if (task.recurrence_parent_id) return String(task.recurrence_parent_id);
  if (task.recurrence_rule) return String(task.id);
  return null;
}

function deduplicateRecurring(tasks) {
  // Pro Wiederkehr-Serie nur die nächste anstehende Instanz im Dashboard zeigen
  const today = startOfDay(new Date());
  const seriesMap = new Map(); // seriesKey → beste Instanz

  for (const task of tasks) {
    const seriesKey = getSeriesKey(task);
    if (!seriesKey) continue; // standalone, kein Dedup nötig

    const existing = seriesMap.get(seriesKey);
    if (!existing) {
      seriesMap.set(seriesKey, task);
      continue;
    }

    // Vergleiche: Bevorzuge nächste zukünftige (oder heutige) Instanz
    const tDate = task.date ? parseISO(String(task.date).substring(0, 10)) : null;
    const eDate = existing.date ? parseISO(String(existing.date).substring(0, 10)) : null;

    if (!tDate) continue;
    if (!eDate) { seriesMap.set(seriesKey, task); continue; }

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

  return tasks.filter((t) => {
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
  const { tasks, fetchTasks, fetchCategories, filter, setFilter, clearFilters, getFilteredTasks } = useTaskStore();
  const [showCompleted, setShowCompleted] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState({});

  useEffect(() => {
    fetchTasks();
    fetchCategories();
  }, []);

  const filtered = getFilteredTasks();
  const deduplicated = deduplicateRecurring(filtered.filter((t) => !t.completed));
  const groups = groupTasksByDate(deduplicated);
  const completedTasks = filtered.filter((t) => t.completed)
    .sort((a, b) => compareAsc(parseISO(b.updated_at || b.created_at), parseISO(a.updated_at || a.created_at)))
    .slice(0, 20);

  const totalOpen = tasks.filter((t) => !t.completed).length;
  const completedCount = tasks.filter((t) => t.completed).length;
  const todayCount = tasks.filter((t) => t.date && isToday(parseISO(t.date)) && !t.completed).length;
  const urgentCount = tasks.filter((t) => (t.priority === 'urgent' || t.priority === 'high') && !t.completed).length;

  const stats = [
    { icon: <Circle size={20} />, value: totalOpen, label: 'Offen', color: 'var(--primary)', bg: 'rgba(0, 122, 255, 0.1)' },
    { icon: <CheckCircle2 size={20} />, value: completedCount, label: 'Erledigt', color: 'var(--success)', bg: 'rgba(52, 199, 89, 0.1)' },
    { icon: <Clock size={20} />, value: todayCount, label: 'Heute', color: 'var(--warning)', bg: 'rgba(255, 149, 0, 0.1)' },
    { icon: <Flame size={20} />, value: urgentCount, label: 'Dringend', color: 'var(--danger)', bg: 'rgba(255, 59, 48, 0.1)' },
  ];

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'Guten Morgen' : greetingHour < 18 ? 'Guten Tag' : 'Guten Abend';

  const toggleSection = (key) => {
    setCollapsedSections((s) => ({ ...s, [key]: !s[key] }));
  };

  const priorities = [
    { value: null, label: 'Alle' },
    { value: 'urgent', label: '🔴 Dringend' },
    { value: 'high', label: '🟠 Hoch' },
    { value: 'medium', label: '🔵 Mittel' },
    { value: 'low', label: '🟢 Niedrig' },
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
        <ManualTaskForm onTaskCreated={() => fetchTasks()} />
      </div>

      {/* Stats */}
      <div className="stats-row">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            className="stat-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 + i * 0.05 }}
          >
            <div className="stat-card-icon" style={{ background: stat.bg, color: stat.color }}>
              {stat.icon}
            </div>
            <div className="stat-card-value" style={{ color: stat.color }}>{stat.value}</div>
            <div className="stat-card-label">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        {priorities.map((p) => (
          <button
            key={p.value || 'all'}
            className={`filter-btn ${filter.priority === p.value ? 'active' : ''}`}
            onClick={() => setFilter('priority', p.value)}
          >
            {p.label}
          </button>
        ))}
        <input
          type="text"
          className="filter-search"
          placeholder="🔍 Suchen..."
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
            <div key={group.key} className="dash-section">
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
