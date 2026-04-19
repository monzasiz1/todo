import { motion, AnimatePresence } from 'framer-motion';
import { useTaskStore } from '../store/taskStore';
import {
  X, Calendar, Clock, Tag, Flag, CheckCircle2, Circle,
  Trash2, AlertTriangle, Repeat, Bell, FileText, ListChecks,
  Lock, Users, UserCheck, Eye, Edit3
} from 'lucide-react';
import { format, parseISO, isToday, isTomorrow, isPast } from 'date-fns';
import { de } from 'date-fns/locale';

const priorityConfig = {
  low: { label: 'Niedrig', color: 'var(--success)', icon: Flag },
  medium: { label: 'Mittel', color: 'var(--primary)', icon: Flag },
  high: { label: 'Hoch', color: 'var(--warning)', icon: Flag },
  urgent: { label: 'Dringend', color: 'var(--danger)', icon: AlertTriangle },
};

export default function TaskDetailModal({ task, onClose }) {
  const { toggleTask, deleteTask } = useTaskStore();

  if (!task) return null;

  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    const date = parseISO(dateStr);
    if (isToday(date)) return 'Heute';
    if (isTomorrow(date)) return 'Morgen';
    return format(date, 'EEEE, d. MMMM yyyy', { locale: de });
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':');
    return `${h}:${m} Uhr`;
  };

  const isOverdue = task.date && !task.completed && isPast(parseISO(task.date)) && !isToday(parseISO(task.date));
  const priority = priorityConfig[task.priority] || priorityConfig.medium;
  const PriorityIcon = priority.icon;
  const canEdit = task.is_owner === false ? (task.can_edit === true) : true;
  const isShared = task.visibility && task.visibility !== 'private';

  const handleToggle = () => {
    toggleTask(task.id);
  };

  const handleDelete = () => {
    deleteTask(task.id);
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        className="modal-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="task-detail-modal"
          initial={{ opacity: 0, y: 60, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.95 }}
          transition={{ type: 'spring', damping: 28, stiffness: 350 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="task-detail-header">
            <div
              className="task-detail-priority-bar"
              style={{ background: priority.color }}
            />
            <button className="task-detail-close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>

          {/* Status + Title */}
          <div className="task-detail-title-row">
            <motion.div
              className={`task-detail-checkbox ${task.completed ? 'checked' : ''}`}
              onClick={handleToggle}
              whileTap={{ scale: 0.85 }}
            >
              {task.completed ? <CheckCircle2 size={28} /> : <Circle size={28} />}
            </motion.div>
            <div>
              <h2 className={`task-detail-title ${task.completed ? 'completed' : ''}`}>
                {task.title}
              </h2>
              {task.completed && (
                <span className="task-detail-status done">Erledigt</span>
              )}
              {isOverdue && (
                <span className="task-detail-status overdue">Überfällig</span>
              )}
            </div>
          </div>

          {/* Description / Details */}
          {task.description && (
            <div className="task-detail-section">
              <div className="task-detail-description-header">
                {task.description.includes('•') ? <ListChecks size={16} /> : <FileText size={16} />}
                <span>{task.description.includes('•') ? 'Liste' : 'Details'}</span>
              </div>
              <div className="task-detail-description">
                {task.description.split('\n').map((line, i) => (
                  <div key={i} className={line.startsWith('•') ? 'task-detail-list-item' : 'task-detail-desc-line'}>
                    {line.startsWith('•') ? (
                      <><span className="task-detail-bullet">•</span>{line.substring(1).trim()}</>
                    ) : line}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Collaboration Info */}
          {isShared && (
            <div className="task-detail-section task-detail-collab">
              <div className="task-detail-description-header">
                {task.visibility === 'shared' ? <Users size={16} /> : <UserCheck size={16} />}
                <span>{task.visibility === 'shared' ? 'Mit allen Freunden geteilt' : 'Mit ausgewählten Personen geteilt'}</span>
              </div>
              {Array.isArray(task.shared_with_users) && task.shared_with_users.length > 0 && (
                <div className="task-detail-shared-users">
                  {task.shared_with_users.map((u, i) => (
                    <div key={i} className="task-detail-shared-user">
                      <span className="collab-avatar" style={{ background: u.color || '#007AFF' }}>
                        {u.name?.[0]?.toUpperCase()}
                      </span>
                      <span>{u.name}</span>
                    </div>
                  ))}
                </div>
              )}
              {!task.is_owner && task.creator_name && (
                <div className="task-detail-collab-info">
                  <span className="collab-avatar" style={{ background: task.creator_color || '#007AFF' }}>
                    {task.creator_name[0]?.toUpperCase()}
                  </span>
                  <span>Erstellt von <strong>{task.creator_name}</strong></span>
                </div>
              )}
              {!canEdit && (
                <div className="task-detail-collab-info readonly">
                  <Eye size={14} />
                  <span>Du hast nur Leserechte</span>
                </div>
              )}
              {task.last_editor_name && (
                <div className="task-detail-collab-info">
                  <Edit3 size={14} />
                  <span>Zuletzt bearbeitet von <strong>{task.last_editor_name}</strong></span>
                </div>
              )}
            </div>
          )}

          {/* Details Grid */}
          <div className="task-detail-grid">
            {task.date && (
              <div className="task-detail-item">
                <div className="task-detail-item-icon" style={isOverdue ? { color: 'var(--danger)' } : {}}>
                  <Calendar size={18} />
                </div>
                <div>
                  <div className="task-detail-item-label">{task.date_end && task.date_end !== task.date ? 'Zeitraum' : 'Datum'}</div>
                  <div className="task-detail-item-value" style={isOverdue ? { color: 'var(--danger)' } : {}}>
                    {formatDate(task.date)}{task.date_end && task.date_end !== task.date ? ` – ${formatDate(task.date_end)}` : ''}
                  </div>
                </div>
              </div>
            )}

            {task.time && (
              <div className="task-detail-item">
                <div className="task-detail-item-icon">
                  <Clock size={18} />
                </div>
                <div>
                  <div className="task-detail-item-label">Uhrzeit</div>
                  <div className="task-detail-item-value">
                    {formatTime(task.time)}{task.time_end ? ` – ${formatTime(task.time_end)}` : ''}
                  </div>
                </div>
              </div>
            )}

            <div className="task-detail-item">
              <div className="task-detail-item-icon" style={{ color: priority.color }}>
                <PriorityIcon size={18} />
              </div>
              <div>
                <div className="task-detail-item-label">Priorität</div>
                <div className="task-detail-item-value" style={{ color: priority.color }}>
                  {priority.label}
                </div>
              </div>
            </div>

            {task.category_name && (
              <div className="task-detail-item">
                <div className="task-detail-item-icon" style={{ color: task.category_color || 'var(--primary)' }}>
                  <Tag size={18} />
                </div>
                <div>
                  <div className="task-detail-item-label">Kategorie</div>
                  <div className="task-detail-item-value">
                    <span
                      className="task-detail-category-badge"
                      style={{
                        background: task.category_color ? `${task.category_color}18` : 'var(--primary-bg)',
                        color: task.category_color || 'var(--primary)',
                      }}
                    >
                      {task.category_name}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {task.reminder_at && (
              <div className="task-detail-item">
                <div className="task-detail-item-icon" style={{ color: 'var(--warning)' }}>
                  <Bell size={18} />
                </div>
                <div>
                  <div className="task-detail-item-label">Erinnerung</div>
                  <div className="task-detail-item-value">
                    {format(parseISO(task.reminder_at), 'd. MMM, HH:mm', { locale: de })} Uhr
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Created */}
          {task.created_at && (
            <div className="task-detail-footer-info">
              Erstellt am {format(parseISO(task.created_at), 'd. MMMM yyyy, HH:mm', { locale: de })} Uhr
            </div>
          )}

          {/* Actions */}
          <div className="task-detail-actions">
            {canEdit && (
              <motion.button
                className={`task-detail-btn ${task.completed ? 'reopen' : 'complete'}`}
                onClick={handleToggle}
                whileTap={{ scale: 0.97 }}
              >
                {task.completed ? (
                  <><Circle size={18} /> Wieder öffnen</>
                ) : (
                  <><CheckCircle2 size={18} /> Als erledigt markieren</>
                )}
              </motion.button>
            )}
            {(task.is_owner !== false) && (
              <motion.button
                className="task-detail-btn delete"
                onClick={handleDelete}
                whileTap={{ scale: 0.97 }}
              >
                <Trash2 size={18} /> Löschen
              </motion.button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
