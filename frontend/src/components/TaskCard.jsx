import { motion, AnimatePresence } from 'framer-motion';
import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTaskStore } from '../store/taskStore';
import { Check, Trash2, Clock, Calendar, CalendarCheck, GripVertical, Lock, Users, UserCheck, Repeat, Paperclip } from 'lucide-react';
import { format, parseISO, isToday, isTomorrow, isPast } from 'date-fns';
import { de } from 'date-fns/locale';
import TaskDetailModal from './TaskDetailModal';
import SharedTaskBadge from './SharedTaskBadge';
import AvatarBadge from './AvatarBadge';

function TaskCard({ task, index, disableLayout = false }) {
  const { toggleTask, deleteTask } = useTaskStore();
  const [showDetail, setShowDetail] = useState(false);
  const shouldAnimate = index < 10 && !disableLayout;
  const touchDragRef = useRef({
    active: false,
    timer: null,
  });

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
  const canShareToChat = isEvent && !!task.group_id;

  useEffect(() => {
    return () => {
      if (touchDragRef.current.timer) clearTimeout(touchDragRef.current.timer);
    };
  }, []);

  const dispatchShareEvent = (name, detail = {}) => {
    window.dispatchEvent(new CustomEvent(name, { detail: { taskId: task.id, groupId: task.group_id, ...detail } }));
  };

  const startTouchDrag = () => {
    touchDragRef.current.active = true;
    dispatchShareEvent('task-share-drag-start', { source: 'touch' });
  };

  const endTouchDrag = (clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY);
    const droppedOnChat = !!el?.closest('.gchat-dropzone');
    dispatchShareEvent('task-share-touch-drop', { droppedOnChat });
    dispatchShareEvent('task-share-drag-end', { source: 'touch', droppedOnChat });
    touchDragRef.current.active = false;
  };

  const handleDragStart = (e) => {
    if (!canShareToChat) return;
    e.dataTransfer.setData('application/x-task-id', String(task.id));
    if (task.group_id) {
      e.dataTransfer.setData('application/x-task-group-id', String(task.group_id));
    }
    e.dataTransfer.effectAllowed = 'copy';
    dispatchShareEvent('task-share-drag-start', { source: 'mouse' });
  };

  const handleDragEnd = () => {
    if (!canShareToChat) return;
    dispatchShareEvent('task-share-drag-end', { source: 'mouse' });
  };

  const handleTouchStart = (e) => {
    if (!canShareToChat) return;
    if (touchDragRef.current.timer) clearTimeout(touchDragRef.current.timer);
    touchDragRef.current.timer = setTimeout(() => {
      startTouchDrag();
    }, 180);
  };

  const handleTouchMove = (e) => {
    if (touchDragRef.current.timer) {
      const t = e.touches?.[0];
      if (!t) return;
      const movedEnough = Math.abs(t.clientX) > 0 || Math.abs(t.clientY) > 0;
      if (movedEnough && !touchDragRef.current.active) {
        clearTimeout(touchDragRef.current.timer);
        touchDragRef.current.timer = null;
      }
    }

    if (!touchDragRef.current.active) return;
    const t = e.touches?.[0];
    if (!t) return;
    e.preventDefault();
    const over = !!document.elementFromPoint(t.clientX, t.clientY)?.closest('.gchat-dropzone');
    dispatchShareEvent('task-share-drag-hover', { over });
  };

  const handleTouchEnd = (e) => {
    if (touchDragRef.current.timer) {
      clearTimeout(touchDragRef.current.timer);
      touchDragRef.current.timer = null;
    }
    if (!touchDragRef.current.active) return;
    const t = e.changedTouches?.[0];
    if (!t) return;
    endTouchDrag(t.clientX, t.clientY);
  };

  return (
    <>
    <motion.div
      className={`task-card ${task.completed ? 'completed' : ''} ${canShareToChat ? 'can-share-chat' : ''}`}
      draggable={canShareToChat}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      layout={!disableLayout}
      initial={shouldAnimate ? { opacity: 0, y: 8 } : false}
      animate={shouldAnimate ? { opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100, height: 0, marginBottom: 0, padding: 0 }}
      transition={shouldAnimate ? { duration: 0.18, delay: index * 0.01 } : { duration: 0.01 }}
      onClick={() => setShowDetail(true)}
      style={{ cursor: 'pointer' }}
      title={canShareToChat ? 'In den Gruppen-Chat ziehen' : undefined}
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

export default memo(TaskCard);
