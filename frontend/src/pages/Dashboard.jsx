import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTaskStore } from '../store/taskStore';
import AIInput from '../components/AIInput';
import TaskList from '../components/TaskList';
import { CheckCircle2, Circle, Clock, Flame } from 'lucide-react';
import { isToday, parseISO } from 'date-fns';

export default function Dashboard() {
  const { tasks, fetchTasks, fetchCategories } = useTaskStore();

  useEffect(() => {
    fetchTasks();
    fetchCategories();
  }, []);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.completed).length;
  const todayTasks = tasks.filter((t) => t.date && isToday(parseISO(t.date)) && !t.completed).length;
  const urgentTasks = tasks.filter((t) => (t.priority === 'urgent' || t.priority === 'high') && !t.completed).length;

  const stats = [
    {
      icon: <Circle size={20} />,
      value: totalTasks - completedTasks,
      label: 'Offen',
      color: 'var(--primary)',
      bg: 'rgba(0, 122, 255, 0.1)',
    },
    {
      icon: <CheckCircle2 size={20} />,
      value: completedTasks,
      label: 'Erledigt',
      color: 'var(--success)',
      bg: 'rgba(52, 199, 89, 0.1)',
    },
    {
      icon: <Clock size={20} />,
      value: todayTasks,
      label: 'Heute',
      color: 'var(--warning)',
      bg: 'rgba(255, 149, 0, 0.1)',
    },
    {
      icon: <Flame size={20} />,
      value: urgentTasks,
      label: 'Dringend',
      color: 'var(--danger)',
      bg: 'rgba(255, 59, 48, 0.1)',
    },
  ];

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'Guten Morgen' : greetingHour < 18 ? 'Guten Tag' : 'Guten Abend';

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

      {/* AI Input */}
      <AIInput />

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
            <div
              className="stat-card-icon"
              style={{ background: stat.bg, color: stat.color }}
            >
              {stat.icon}
            </div>
            <div className="stat-card-value" style={{ color: stat.color }}>
              {stat.value}
            </div>
            <div className="stat-card-label">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Task List */}
      <TaskList />
    </div>
  );
}
