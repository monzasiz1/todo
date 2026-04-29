import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTaskStore } from '../store/taskStore';
import { api } from '../utils/api';
import {
  X, Calendar, CalendarCheck, Clock, Tag, Flag, CheckCircle2, Circle,
  Trash2, AlertTriangle, Repeat, Bell, FileText, ListChecks,
  Users, UserCheck, Eye, Edit3, Share2, MoreVertical, MessageCircle, Send, Video
} from 'lucide-react';
import { format, parseISO, isToday, isTomorrow, isPast } from 'date-fns';
import { de } from 'date-fns/locale';
import TaskEditModal from './TaskEditModal';
import TaskAttachments from './TaskAttachments';
import AvatarBadge from './AvatarBadge';

const priorityConfig = {
  low: { label: 'Niedrig', color: 'var(--success)', icon: Flag },
  medium: { label: 'Mittel', color: 'var(--primary)', icon: Flag },
  high: { label: 'Hoch', color: 'var(--warning)', icon: Flag },
  urgent: { label: 'Dringend', color: 'var(--danger)', icon: AlertTriangle },
};

export default function TaskDetailModal({ task, onClose, onUpdated, portalTarget }) {
  const { toggleTask, deleteTask, fetchTasks, addToast } = useTaskStore();
  const [showEdit, setShowEdit] = useState(false);
  const [sharingToChat, setSharingToChat] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const menuRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  }, []);

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

  const isOverdue = task?.date && !task?.completed && isPast(parseISO(task.date)) && !isToday(parseISO(task.date));
  const priority = priorityConfig[task?.priority] || priorityConfig.medium;
  const PriorityIcon = priority.icon;
  const canEdit = task?.is_owner === false ? (task?.can_edit === true) : true;
  const isShared = task?.visibility && task.visibility !== 'private';
  const isEvent = task?.type === 'event';
  const eventEndAt = isEvent ? getEventEndDate(task) : null;
  const isEventEnded = isEvent && !!eventEndAt && eventEndAt.getTime() < Date.now();

  useEffect(() => {
    if (!task?.id) {
      setComments([]);
      return;
    }

    const loadComments = async () => {
      try {
        const response = await api.getComments(task.id);
        if (response.comments && Array.isArray(response.comments)) {
          setComments(response.comments);
        }
      } catch (err) {
        console.error('Failed to load comments:', err);
        // Fall back to empty list
        setComments([]);
      }
    };
    loadComments();
  }, [task?.id]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (emojiPickerRef.current && emojiPickerRef.current.contains(e.target)) return;
      setShowMenu(false);
      setShowEmojiPicker(false);
    };
    if (showMenu || showEmojiPicker) {
      document.addEventListener('mousedown', onClickOutside);
    }
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [showMenu, showEmojiPicker]);

  if (!task) return null;

  const handleToggle = async () => {
    const updated = await toggleTask(task.id);
    if (updated && onUpdated) onUpdated(updated);
  };

  const handleDelete = () => {
    deleteTask(task.id);
    onClose();
  };

  const handleAddComment = async () => {
    const text = commentText.trim();
    if (!text) return;

    // Optimistic UI update
    const optimisticEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      emoji: '💬',
      text,
      author: currentUser?.name || 'Du',
      created_at: new Date().toISOString(),
      user_id: currentUser?.id || null,
    };

    setCommentText('');
    setComments([...comments, optimisticEntry]);

    try {
      const response = await api.addComment(task.id, '💬', text);
      if (response.comment) {
        // Replace optimistic entry with server response
        setComments((prev) =>
          prev.map((c) => (c.id === optimisticEntry.id ? response.comment : c))
        );
        addToast('✅ Kommentar hinzugefügt');
      }
    } catch (err) {
      console.error('Failed to add comment:', err);
      // Remove optimistic entry on failure
      setComments((prev) => prev.filter((c) => c.id !== optimisticEntry.id));
      addToast('❌ Kommentar konnte nicht gespeichert werden');
    }
  };

  const handleShareToGroupChat = async () => {
    if (!task.group_id || sharingToChat) return;
    setSharingToChat(true);
    try {
      await api.shareTaskToGroupChat(task.group_id, task.id);
      addToast('📤 Termin wurde in den Gruppen-Chat geteilt');
    } catch (err) {
      addToast(`❌ ${err.message || 'Teilen fehlgeschlagen'}`, 'error');
    } finally {
      setSharingToChat(false);
    }
  };

  return (
    <>
      <motion.div
        className="modal-overlay task-detail-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className={`task-detail-modal${isMobile ? ' is-mobile-fullscreen' : ''}`}
          initial={isMobile ? { x: '100%' } : { opacity: 0, y: 24 }}
          animate={isMobile ? { x: 0 } : { opacity: 1, y: 0 }}
          exit={isMobile ? { x: '100%' } : { opacity: 0, y: 16 }}
          transition={isMobile
            ? { type: 'tween', duration: 0.24, ease: 'easeOut' }
            : { type: 'tween', duration: 0.2, ease: 'easeOut' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Linke Spalte (Desktop: details) ── */}
          <div className="task-detail-main">
          {/* Header */}
          <div className="task-detail-header">
            <div
              className="task-detail-priority-bar"
              style={{ background: priority.color }}
            />
            <div className="task-detail-header-actions" ref={menuRef}>
              <button
                className="task-detail-more-btn"
                onClick={() => setShowMenu((s) => !s)}
                title="Mehr"
                aria-label="Mehr"
              >
                <MoreVertical size={18} />
              </button>
              {showMenu && (
                <div className="task-detail-more-menu">
                  {canEdit && (
                    <button
                      className="task-detail-more-item"
                      onClick={() => {
                        setShowMenu(false);
                        setShowEdit(true);
                      }}
                    >
                      Bearbeiten
                    </button>
                  )}
                  {(task.is_owner !== false) && (
                    <button
                      className="task-detail-more-item danger"
                      onClick={() => {
                        setShowMenu(false);
                        handleDelete();
                      }}
                    >
                      Löschen
                    </button>
                  )}
                </div>
              )}
              <button className="task-detail-close" onClick={onClose}>
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Status + Title */}
          <div className="task-detail-title-row">
            {isEvent ? (
              <div className="task-detail-event-icon">
                <CalendarCheck size={28} />
              </div>
            ) : (
              <motion.div
                className={`task-detail-checkbox ${task.completed ? 'checked' : ''}`}
                onClick={handleToggle}
                whileTap={{ scale: 0.85 }}
              >
                {task.completed ? <CheckCircle2 size={28} /> : <Circle size={28} />}
              </motion.div>
            )}
            <div>
              <h2 className={`task-detail-title ${task.completed && !isEvent ? 'completed' : ''}`}>
                {task.title}
              </h2>
              {isEvent && (
                <span className="task-detail-status event">Termin</span>
              )}
              {isEvent && isEventEnded && (
                <span className="task-detail-status ended">Beendet</span>
              )}
              {!isEvent && task.completed && (
                <span className="task-detail-status done">Erledigt</span>
              )}
              {isOverdue && !isEvent && (
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

          {/* Teams Card */}
          {task.teams_join_url && (
            <div className="task-detail-section task-detail-teams-card">
              <div className="task-detail-teams-top">
                <div className="task-detail-teams-icon"><Video size={18} /></div>
                <div>
                  <div className="task-detail-teams-title">Teams-Meeting aktiv</div>
                  <div className="task-detail-teams-copy">Für diesen Termin wurde ein Microsoft-Teams-Meeting erstellt.</div>
                </div>
              </div>
              <a href={task.teams_join_url} target="_blank" rel="noopener noreferrer" className="task-detail-teams-join">
                <Video size={16} /> Via Teams beitreten
              </a>
            </div>
          )}

          {/* Details Grid */}
          <div className="task-detail-grid">
            {task.date && (
              <div className="task-detail-item">
                <div className="task-detail-item-icon" style={isOverdue ? { color: 'var(--danger)' } : {}}><Calendar size={18} /></div>
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
                <div className="task-detail-item-icon"><Clock size={18} /></div>
                <div>
                  <div className="task-detail-item-label">Uhrzeit</div>
                  <div className="task-detail-item-value">{formatTime(task.time)}{task.time_end ? ` – ${formatTime(task.time_end)}` : ''}</div>
                </div>
              </div>
            )}
            <div className="task-detail-item">
              <div className="task-detail-item-icon" style={{ color: priority.color }}><PriorityIcon size={18} /></div>
              <div>
                <div className="task-detail-item-label">Priorität</div>
                <div className="task-detail-item-value" style={{ color: priority.color }}>{priority.label}</div>
              </div>
            </div>
            {task.category_name && (
              <div className="task-detail-item">
                <div className="task-detail-item-icon" style={{ color: task.category_color || 'var(--primary)' }}><Tag size={18} /></div>
                <div>
                  <div className="task-detail-item-label">Kategorie</div>
                  <div className="task-detail-item-value">
                    <span className="task-detail-category-badge" style={{ background: task.category_color ? `${task.category_color}18` : 'var(--primary-bg)', color: task.category_color || 'var(--primary)' }}>
                      {task.category_name}
                    </span>
                  </div>
                </div>
              </div>
            )}
            {task.group_category_name && (
              <div className="task-detail-item">
                <div className="task-detail-item-icon" style={{ color: task.group_category_color || '#8E8E93' }}><Tag size={18} /></div>
                <div>
                  <div className="task-detail-item-label">Gruppenkategorie</div>
                  <div className="task-detail-item-value">
                    <span className="task-detail-category-badge" style={{ background: task.group_category_color ? `${task.group_category_color}18` : 'rgba(142,142,147,0.12)', color: task.group_category_color || '#636366', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: task.group_category_color || '#8E8E93', flexShrink: 0, display: 'inline-block' }} />
                      {task.group_category_name}
                    </span>
                  </div>
                </div>
              </div>
            )}
            {task.reminder_at && (
              <div className="task-detail-item">
                <div className="task-detail-item-icon" style={{ color: 'var(--warning)' }}><Bell size={18} /></div>
                <div>
                  <div className="task-detail-item-label">Erinnerung</div>
                  <div className="task-detail-item-value">{format(parseISO(task.reminder_at), 'd. MMM, HH:mm', { locale: de })} Uhr</div>
                </div>
              </div>
            )}
            {task.recurrence_rule && (
              <div className="task-detail-item">
                <div className="task-detail-item-icon" style={{ color: '#007AFF' }}><Repeat size={18} /></div>
                <div>
                  <div className="task-detail-item-label">Wiederholung</div>
                  <div className="task-detail-item-value" style={{ color: '#007AFF' }}>
                    {{ daily: 'Täglich', weekly: 'Wöchentlich', biweekly: 'Alle 2 Wochen', monthly: 'Monatlich', yearly: 'Jährlich', weekdays: 'Werktags (Mo–Fr)' }[task.recurrence_rule] || task.recurrence_rule}
                    {task.recurrence_end && ` bis ${format(parseISO(task.recurrence_end), 'd. MMM yyyy', { locale: de })}`}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Attachments */}
          <TaskAttachments taskId={task.id} canEdit={canEdit} />

          {/* Footer + Actions */}
          {task.created_at && (
            <div className="task-detail-footer-info">
              Erstellt am {format(parseISO(task.created_at), 'd. MMMM yyyy, HH:mm', { locale: de })} Uhr
            </div>
          )}
          <div className="task-detail-actions">
            {isEvent && task.group_id && (
              <motion.button className="task-detail-btn edit" onClick={handleShareToGroupChat} whileTap={{ scale: 0.97 }} disabled={sharingToChat || isEventEnded}>
                <Share2 size={18} /> {isEventEnded ? 'Termin beendet' : (sharingToChat ? 'Teile...' : 'In Chat teilen')}
              </motion.button>
            )}
            {canEdit && !isEvent && (
              <motion.button className={`task-detail-btn ${task.completed ? 'reopen' : 'complete'}`} onClick={handleToggle} whileTap={{ scale: 0.97 }}>
                {task.completed ? <><Circle size={18} /> Wieder öffnen</> : <><CheckCircle2 size={18} /> Als erledigt markieren</>}
              </motion.button>
            )}
          </div>
          </div>{/* end task-detail-main */}

          {/* ── Rechte Spalte: Collaboration + Kommentare ── */}
          <div className="task-detail-aside">
            {/* Collaboration */}
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
                        <AvatarBadge className="collab-avatar" name={u.name} color={u.color || '#007AFF'} avatarUrl={u.avatar_url} size={22} />
                        <span>{u.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!task.is_owner && task.creator_name && (
                  <div className="task-detail-collab-info">
                    <AvatarBadge className="collab-avatar" name={task.creator_name} color={task.creator_color || '#007AFF'} avatarUrl={task.creator_avatar_url} size={22} />
                    <span>Erstellt von <strong>{task.creator_name}</strong></span>
                  </div>
                )}
                {!canEdit && <div className="task-detail-collab-info readonly"><Eye size={14} /><span>Du hast nur Leserechte</span></div>}
                {task.last_editor_name && (
                  <div className="task-detail-collab-info">
                    <Edit3 size={14} /><span>Zuletzt bearbeitet von <strong>{task.last_editor_name}</strong></span>
                  </div>
                )}
              </div>
            )}

            {/* Group */}
            {task.group_name && (
              <div className="task-detail-section task-detail-collab">
                <div className="task-detail-description-header">
                  <AvatarBadge name={task.group_name} color={task.group_color || '#5856D6'} avatarUrl={task.group_image_url} size={16} />
                  <span>Gruppe</span>
                </div>
                <div className="task-detail-group-badge" style={{ background: task.group_color ? `${task.group_color}15` : 'rgba(88,86,214,0.1)', borderLeft: `3px solid ${task.group_color || '#5856D6'}` }}>
                  <AvatarBadge name={task.group_name} color={task.group_color || '#5856D6'} avatarUrl={task.group_image_url} size={32} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{task.group_name}</span>
                    {task.group_task_creator_name && (
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <AvatarBadge name={task.group_task_creator_name} color={task.group_task_creator_color || '#007AFF'} avatarUrl={task.group_task_creator_avatar_url} size={16} />
                        Erstellt von {task.group_task_creator_name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Comments */}
            <div className="task-detail-section task-detail-comments-section">
              <div className="task-detail-description-header">
                <MessageCircle size={16} /><span>Kommentare</span>
              </div>
              <div className="task-detail-comments-box">
                {comments.length === 0 ? (
                  <div className="task-detail-comments-empty">Noch keine Kommentare</div>
                ) : comments.map((c) => (
                  <div key={c.id} className="task-detail-comment-item">
                    <div className="task-detail-comment-top">
                      <span className="task-detail-comment-emoji">{c.emoji}</span>
                      <span className="task-detail-comment-author">{c.author}</span>
                      <span className="task-detail-comment-time">{format(parseISO(c.created_at), 'd. MMM, HH:mm', { locale: de })}</span>
                      {currentUser?.id === c.user_id && (
                        <button type="button" className="task-detail-comment-delete" onClick={async () => {
                          try {
                            await api.deleteComment(c.id);
                            setComments((prev) => prev.filter((item) => item.id !== c.id));
                            addToast('🗑️ Kommentar gelöscht');
                          } catch { addToast('❌ Kommentar konnte nicht gelöscht werden'); }
                        }} title="Löschen"><Trash2 size={14} /></button>
                      )}
                    </div>
                    <div className="task-detail-comment-text">{c.text}</div>
                  </div>
                ))}
              </div>
              <div className="task-detail-comment-input-wrap">
                <div className="task-detail-comment-row">
                  <button type="button" className="task-detail-emoji-picker-btn" onClick={() => setShowEmojiPicker(!showEmojiPicker)} title="Emoji einfügen">😊</button>
                  <input className="task-detail-comment-input" placeholder="Kommentar schreiben..." value={commentText} onChange={(e) => setCommentText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(); }} />
                  <button type="button" className="task-detail-comment-send" onClick={handleAddComment}><Send size={14} /></button>
                </div>
                {showEmojiPicker && (
                  <div ref={emojiPickerRef} className="task-detail-emoji-picker">
                    {['💬', '👍', '✅', '🔥', '🙏', '🎉', '📌', '🤝'].map((emoji) => (
                      <button key={emoji} type="button" className="task-detail-emoji-btn" onClick={() => { setCommentText(commentText + emoji); setShowEmojiPicker(false); }} title={emoji}>{emoji}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>{/* end task-detail-aside */}
        </motion.div>
      </motion.div>

      {/* Edit Modal */}
      {showEdit && createPortal(
        <TaskEditModal
          task={task}
          onClose={() => setShowEdit(false)}
          onSaved={(updatedTask) => {
            fetchTasks({
              dashboard: 'true',
              limit: '300',
              horizon_days: '42',
              completed_lookback_days: '30',
            }, { force: true });
            onUpdated?.(updatedTask);
            onClose();
          }}
        />,
        portalTarget || document.body
      )}
    </>
  );
}
