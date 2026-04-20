import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTaskStore } from '../store/taskStore';
import { Check, Trash2, Clock, Calendar, CalendarCheck, GripVertical, Lock, Users, UserCheck, Repeat, Paperclip } from 'lucide-react';
import { format, parseISO, isToday, isTomorrow, isPast } from 'date-fns';
import { de } from 'date-fns/locale';
import TaskDetailModal from './TaskDetailModal';
import SharedTaskBadge from './SharedTaskBadge';
import AvatarBadge from './AvatarBadge';

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
  const canEdit = task.is_owner === false ? (task.can_edit === true) : true;
  const isEvent = task.type === 'event';

  return (
    <>
    <motion.div
      className={`task-card ${task.completed ? 'completed' : ''}`}
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100, height: 0, marginBottom: 0, padding: 0 }}
      transition={{ duration: 0.3, delay: index * 0.03 }}
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

      {/* Checkbox / Event Icon */}
      {isEvent ? (
        <div className="task-event-icon" title="Termin">
          <CalendarCheck size={18} />
        </div>
      ) : (
        <motion.div
          className={`task-checkbox ${task.completed ? 'checked' : ''} ${!canEdit ? 'disabled' : ''}`}
          onClick={(e) => { e.stopPropagation(); if (canEdit) toggleTask(task.id); }}
          whileTap={canEdit ? { scale: 0.85 } : {}}
        >
          {task.completed && <Check size={14} strokeWidth={3} />}
        </motion.div>
      )}

      {/* Content */}
      <div className="task-content">
        <div className="task-title-row">
          <div className="task-title">{task.title}</div>
          {isEvent && <span className="task-type-badge event">Termin</span>}
        </div>
        {task.description && (
          <div className="task-description-preview">
            {task.description.length > 60 ? task.description.substring(0, 60) + '…' : task.description}
          </div>
        )}
        <SharedTaskBadge task={task} />
        {task.group_name && (
          <span
            className="task-group-badge"
            style={{
              background: task.group_color ? `${task.group_color}18` : 'rgba(88,86,214,0.1)',
              color: task.group_color || '#5856D6',
            }}
          >
            <AvatarBadge
              name={task.group_name}
              color={task.group_color || '#5856D6'}
              avatarUrl={task.group_image_url}
              size={12}
            />
            {task.group_name}
          </span>
        )}
        {task.recurrence_rule && (
          <span
            className="task-group-badge"
            style={{
              background: 'rgba(0,122,255,0.1)',
              color: '#007AFF',
            }}
          >
            <Repeat size={12} />
            {{ daily: 'Täglich', weekly: 'Wöchentlich', biweekly: 'Alle 2 Wo.', monthly: 'Monatlich', yearly: 'Jährlich', weekdays: 'Werktags' }[task.recurrence_rule] || task.recurrence_rule}
          </span>
        )}
        <div className="task-meta">
          {task.date && (
            <span className="task-meta-item" style={isOverdue ? { color: 'var(--danger)' } : {}}>
              <Calendar size={14} />
              {formatDate(task.date)}{task.date_end && task.date_end !== task.date ? ` – ${formatDate(task.date_end)}` : ''}
            </span>
          )}
          {task.time && (
            <span className="task-meta-item">
              <Clock size={14} />
              {formatTime(task.time)}{task.time_end ? ` – ${formatTime(task.time_end)}` : ''}
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
          {task.attachment_count > 0 && (
            <span className="task-meta-item" style={{ color: 'var(--text-tertiary)' }}>
              <Paperclip size={12} />
              {task.attachment_count}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      {canEdit && (
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
      )}
    </motion.div>

    {/* Detail Modal — rendered via portal outside the card */}
    {showDetail && createPortal(
      <TaskDetailModal task={task} onClose={() => setShowDetail(false)} />,
      document.body
    )}
    </>
  );
}
