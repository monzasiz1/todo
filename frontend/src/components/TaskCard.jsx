import { motion, AnimatePresence } from 'framer-motion';
import { memo, useEffect, useRef, useState } from 'react';
import { useTaskStore } from '../store/taskStore';
import { useOpenTask } from '../hooks/useOpenTask';
import TaskDetailModal from './TaskDetailModal';
import { Check, Trash2, Clock, Calendar, CalendarCheck, GripVertical, Lock, Users, UserCheck, Repeat, Paperclip, Video, Circle, ThumbsDown } from 'lucide-react';
import { format, parseISO, isToday, isTomorrow, isPast } from 'date-fns';
import { de } from 'date-fns/locale';
import SharedTaskBadge from './SharedTaskBadge';
import AvatarBadge from './AvatarBadge';

function TaskCard({ task, index, disableLayout = false, showDashboardDateTile = false, showSharedInfo = true }) {
  const { toggleTask, deleteTask } = useTaskStore();
  const { detailTask, openTask, closeTask } = useOpenTask();
  const [nowTs, setNowTs] = useState(Date.now());
  const shouldAnimate = index < 10 && !disableLayout;
  const touchDragRef = useRef({
    active: false,
    timer: null,
    startX: 0,
    startY: 0,
  });

  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    const date = parseISO(dateStr);
    const now = new Date();
    if (isToday(date)) return 'Heute';
    if (isTomorrow(date)) return 'Morgen';
    // Wenn Jahr unterschiedlich, Jahr anzeigen
    if (date.getFullYear() !== now.getFullYear()) {
      return format(date, 'd. MMM yyyy', { locale: de });
    }
    return format(date, 'd. MMM', { locale: de });
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':');
    return `${h}:${m} Uhr`;
  };

  const getDashboardDateParts = (dateStr) => {
    if (!dateStr) return null;
    const date = parseISO(String(dateStr));
    if (Number.isNaN(date.getTime())) return null;
    return {
      month: format(date, 'MMM', { locale: de }).replace('.', '').toUpperCase(),
      day: format(date, 'd', { locale: de }),
    };
  };

  const getEventEndDate = (t) => {
    if (!t?.date) return null;
    const datePart = String(t.date).slice(0, 10);
    const rawEnd = String(t.time_end || t.time || '23:59').slice(0, 5);
    const parts = rawEnd.split(':');
    const hh = String(Math.min(23, Math.max(0, Number(parts[0]) || 23))).padStart(2, '0');
    const mm = String(Math.min(59, Math.max(0, Number(parts[1]) || 59))).padStart(2, '0');
    const end = new Date(`${datePart}T${hh}:${mm}:00`);
    return Number.isNaN(end.getTime()) ? null : end;
  };

  const priorityColors = {
    low: 'var(--success)',
    medium: 'var(--primary)',
    high: 'var(--warning)',
    urgent: 'var(--danger)',
  };

  const isEvent = task.type === 'event';
  const eventEndAt = isEvent ? getEventEndDate(task) : null;
  const isEventEnded = isEvent && !!eventEndAt && eventEndAt.getTime() < nowTs;
  // Beendete Termine sind nicht überfällig – nur offene Aufgaben (keine Events) werden rot markiert
  const isOverdue = task.date && !task.completed && isPast(parseISO(task.date)) && !isToday(parseISO(task.date)) && !isEventEnded;
  const canEdit = task.is_owner === false ? (task.can_edit === true) : true;
  const canShareToChat = !!task.group_id && !(isEvent && isEventEnded);
  const shortTitle = String(task.title || 'Termin').slice(0, 32);
  const timeLabel = task.time ? `${String(task.time).slice(0, 5)} Uhr` : '';
  const hasGroupCategoryCombo = !!task.group_name && !!task.group_category_name;
  const dashboardDateParts = showDashboardDateTile ? getDashboardDateParts(task.date) : null;
  const useDashboardDateRail = Boolean(showDashboardDateTile && dashboardDateParts);

  useEffect(() => {
    return () => {
      if (touchDragRef.current.timer) clearTimeout(touchDragRef.current.timer);
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

  const dispatchShareEvent = (name, detail = {}) => {
    window.dispatchEvent(new CustomEvent(name, {
      detail: {
        taskId: task.id,
        groupId: task.group_id,
        title: shortTitle,
        time: timeLabel,
        ...detail,
      },
    }));
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

    // Compact drag preview instead of dragging the whole task card screenshot.
    const ghost = document.createElement('div');
    ghost.className = 'task-share-native-ghost';
    ghost.innerHTML = `<span class="dot"></span><span class="txt">${shortTitle}${timeLabel ? ` · ${timeLabel}` : ''}</span>`;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 16, 16);
    setTimeout(() => ghost.remove(), 0);

    dispatchShareEvent('task-share-drag-start', { source: 'mouse', x: e.clientX, y: e.clientY });
  };

  const handleDrag = (e) => {
    if (!canShareToChat) return;
    if (e.clientX === 0 && e.clientY === 0) return;
    const over = !!document.elementFromPoint(e.clientX, e.clientY)?.closest('.gchat-dropzone');
    dispatchShareEvent('task-share-drag-move', { source: 'mouse', x: e.clientX, y: e.clientY, over });
    dispatchShareEvent('task-share-drag-hover', { over });
  };

  const handleDragEnd = () => {
    if (!canShareToChat) return;
    dispatchShareEvent('task-share-drag-end', { source: 'mouse' });
  };

  const handleTouchStart = (e) => {
    if (!canShareToChat) return;
    const t = e.touches?.[0];
    if (t) {
      touchDragRef.current.startX = t.clientX;
      touchDragRef.current.startY = t.clientY;
    }
    if (touchDragRef.current.timer) clearTimeout(touchDragRef.current.timer);
    touchDragRef.current.timer = setTimeout(() => {
      startTouchDrag();
    }, 180);
  };

  const handleTouchMove = (e) => {
    if (touchDragRef.current.timer) {
      const t = e.touches?.[0];
      if (!t) return;
      const movedEnough =
        Math.abs(t.clientX - touchDragRef.current.startX) > 8 ||
        Math.abs(t.clientY - touchDragRef.current.startY) > 8;
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
    dispatchShareEvent('task-share-drag-move', { source: 'touch', x: t.clientX, y: t.clientY, over });
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
      className={`task-card ${isEvent ? 'event' : 'todo'} ${task.completed ? 'completed' : ''} ${canShareToChat ? 'can-share-chat' : ''} ${isEventEnded ? 'ended-event' : ''}`}
      draggable={canShareToChat}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
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
      onClick={() => openTask(task)}
      style={{
        cursor: 'pointer',
        '--task-priority-color': priorityColors[task.priority] || priorityColors.medium,
      }}
      title={isEventEnded ? 'Termin beendet' : (canShareToChat ? 'In den Gruppen-Chat ziehen' : undefined)}
    >
      {/* Priority Bar */}
      <div
        className={`task-card-priority ${task.priority}`}
        style={{ background: priorityColors[task.priority] }}
      />

      {/* Dashboard Date Tile — first flex item so it can be flush to card edge */}
      {dashboardDateParts && (
        <div className={`task-dashboard-date ${isEvent ? 'event' : 'todo'}${useDashboardDateRail ? ' has-marker' : ''}`} aria-hidden="true">
          {isEvent ? (
            <span className="task-dashboard-date-icon">
              <CalendarCheck size={12} />
            </span>
          ) : (
            <button
              type="button"
              className={`task-dashboard-date-toggle ${task.completed ? 'checked' : ''} ${!canEdit ? 'disabled' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (canEdit) toggleTask(task.id);
              }}
              aria-label={task.completed ? 'Aufgabe wieder öffnen' : 'Aufgabe erledigen'}
            >
              {task.completed ? <Check size={14} strokeWidth={3} /> : <Circle size={14} strokeWidth={2.5} />}
            </button>
          )}
          <span className="task-dashboard-date-month">{dashboardDateParts.month}</span>
          <span className="task-dashboard-date-day">{dashboardDateParts.day}</span>
        </div>
      )}

      {/* Drag Handle — absolute corner tab, only for sharable group items */}
      {canShareToChat && (
        <div
          className="task-drag-handle task-drag-handle--corner"
          onClick={(e) => e.stopPropagation()}
          title="Verschieben"
          aria-hidden="true"
        >
          <GripVertical size={14} />
        </div>
      )}

      {/* Checkbox / Event Icon — only when no date tile */}
      {!useDashboardDateRail && isEvent ? (
        <div className="task-event-icon" title="Termin">
          <CalendarCheck size={18} />
        </div>
      ) : (
        !useDashboardDateRail && !isEvent && showDashboardDateTile && (
          /* Datumlose Aufgabe im Dashboard: Badge-Pill mit Abhakenknopf, ohne Datum */
          <div className="task-dashboard-date todo no-date" aria-hidden="true">
            <button
              type="button"
              className={`task-dashboard-date-toggle ${task.completed ? 'checked' : ''} ${!canEdit ? 'disabled' : ''}`}
              onClick={(e) => { e.stopPropagation(); if (canEdit) toggleTask(task.id); }}
              aria-label={task.completed ? 'Aufgabe wieder öffnen' : 'Aufgabe erledigen'}
            >
              {task.completed ? <Check size={14} strokeWidth={3} /> : <Circle size={14} strokeWidth={2.5} />}
            </button>
          </div>
        )
      )}
      {/* Fallback-Checkbox außerhalb des Dashboards */}
      {!useDashboardDateRail && !isEvent && !showDashboardDateTile && (
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
          {!isEvent && <span className="task-type-badge task">Aufgabe</span>}
          {isEvent && <span className="task-type-badge event">Termin</span>}
          {task.teams_join_url && <span className="task-type-badge teams"><Video size={10} /> Teams</span>}
          {isEventEnded && <span className="task-type-badge ended">Beendet</span>}
        </div>
        {task.description && (
          <div className="task-description-preview">
            {task.description.length > 60 ? task.description.substring(0, 60) + '…' : task.description}
          </div>
        )}
        {showSharedInfo && <SharedTaskBadge task={task} />}
        {hasGroupCategoryCombo && (
          <span
            className="task-group-combo-badge"
            style={{
              background: `linear-gradient(to right, ${(task.group_color || '#5856D6')}28 0%, ${(task.group_category_color || '#8E8E93')}30 100%)`,
              borderColor: `${task.group_color || '#5856D6'}55`,
            }}
          >
            <AvatarBadge
              name={task.group_name}
              color={task.group_color || '#5856D6'}
              avatarUrl={task.group_image_url}
              size={10}
            />
            <span className="task-group-combo-name" style={{ color: task.group_color || '#5856D6' }}>{task.group_name}</span>
            <span className="task-group-combo-cat" style={{ color: task.group_category_color || '#636366' }}>
              <span
                className="task-group-category-dot"
                style={{ background: task.group_category_color || '#8E8E93' }}
              />
              {task.group_category_name}
            </span>
          </span>
        )}
        {task.group_name && !hasGroupCategoryCombo && (
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
        {task.group_category_name && !hasGroupCategoryCombo && (
          <span
            className="task-group-category-badge"
            style={{
              background: task.group_category_color ? `${task.group_category_color}22` : 'rgba(142,142,147,0.12)',
              color: task.group_category_color || '#636366',
              borderColor: task.group_category_color ? `${task.group_category_color}55` : 'rgba(142,142,147,0.3)',
            }}
          >
            <span
              className="task-group-category-dot"
              style={{ background: task.group_category_color || '#8E8E93' }}
            />
            {task.group_category_name}
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
            <span className="task-meta-item" style={isEventEnded ? { color: 'var(--text-tertiary)' } : {}}>
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
          {task.group_id && task.enable_group_rsvp === true && (
            <div className="task-meta-votes-row">
              <span className="task-vote-stat task-vote-stat--yes" title="Zusagen">
                <Check size={12} />
                {Number(task.vote_yes_count || 0)}
              </span>
              <span className="task-vote-stat task-vote-stat--no" title="Absagen">
                <ThumbsDown size={12} />
                {Number(task.vote_no_count || 0)}
              </span>
              <span className="task-vote-stat task-vote-stat--pending" title="Unbeantwortet">
                <Users size={12} />
                {Number(task.vote_unanswered_count || 0)}
              </span>
            </div>
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

    {detailTask && (
      <TaskDetailModal
        task={detailTask}
        onClose={closeTask}
        onUpdated={closeTask}
        hidePrivateShareInfo={!showSharedInfo}
      />
    )}
    </>
  );
}

export default memo(TaskCard);
