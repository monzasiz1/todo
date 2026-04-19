import { motion } from 'framer-motion';
import { useState } from 'react';
import { useTaskStore } from '../store/taskStore';
import { Check, Trash2, Clock, Calendar, GripVertical } from 'lucide-react';
import { format, parseISO, isToday, isTomorrow, isPast } from 'date-fns';
import { de } from 'date-fns/locale';
import TaskDetailModal from './TaskDetailModal';

export default function TaskCard({ task, index }) {
  const { toggleTask, deleteTask } = useTaskStore();
  const [showDetail, setShowDetail] = useState(false);

  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    const date = parseISO(dateStr);
    if (isToday(date)) return 'Heute';
    if (isTomorrow(date)) return 'Morgen';
    return format(date, 'd. MMM', { locale: de });
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':');
    return `${h}:${m} Uhr`;
  };

  const priorityColors = {
    low: 'var(--success)',
    medium: 'var(--primary)',
    high: 'var(--warning)',
    urgent: 'var(--danger)',
  };

  const isOverdue = task.date && !task.completed && isPast(parseISO(task.date)) && !isToday(parseISO(task.date));

  return (
    <motion.div
      className={`task-card ${task.completed ? 'completed' : ''}`}
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100, height: 0, marginBottom: 0, padding: 0 }}
      transition={{ duration: 0.3, delay: index * 0.03 }}
      whileHover={{ scale: 1.005 }}
      onClick={() => setShowDetail(true)}
      style={{ cursor: 'pointer' }}
    >
      {/* Priority Bar */}
      <div
        className={`task-card-priority ${task.priority}`}
        style={{ background: priorityColors[task.priority] }}
      />

      {/* Drag Handle */}
      <div style={{ color: 'var(--text-tertiary)', cursor: 'grab', marginTop: 2, marginLeft: 4 }} onClick={(e) => e.stopPropagation()}>
        <GripVertical size={16} />
      </div>

      {/* Checkbox */}
      <motion.div
        className={`task-checkbox ${task.completed ? 'checked' : ''}`}
        onClick={(e) => { e.stopPropagation(); toggleTask(task.id); }}
        whileTap={{ scale: 0.85 }}
      >
        {task.completed && <Check size={14} strokeWidth={3} />}
      </motion.div>

      {/* Content */}
      <div className="task-content">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          {task.date && (
            <span className="task-meta-item" style={isOverdue ? { color: 'var(--danger)' } : {}}>
              <Calendar size={14} />
              {formatDate(task.date)}
            </span>
          )}
          {task.time && (
            <span className="task-meta-item">
              <Clock size={14} />
              {formatTime(task.time)}
            </span>
          )}
          {task.category_name && (
            <span
              className="task-category-badge"
              style={{
                background: task.category_color ? `${task.category_color}18` : 'var(--primary-bg)',
                color: task.category_color || 'var(--primary)',
              }}
            >
              {task.category_name}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="task-actions" onClick={(e) => e.stopPropagation()}>
        <motion.button
          className="task-action-btn delete"
          onClick={() => deleteTask(task.id)}
          whileTap={{ scale: 0.85 }}
          title="Löschen"
        >
          <Trash2 size={16} />
        </motion.button>
      </div>

      {/* Detail Modal */}
      {showDetail && (
        <TaskDetailModal task={task} onClose={() => setShowDetail(false)} />
      )}
    </motion.div>
  );
}
