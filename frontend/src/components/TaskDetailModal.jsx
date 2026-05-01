import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTaskStore } from '../store/taskStore';
import { lockScroll, unlockScroll } from '../utils/scrollLock';
import { api } from '../utils/api';
import {
  X, ArrowLeft, Calendar, CalendarCheck, Clock, Tag, Flag, CheckCircle2, Circle,
  Trash2, AlertTriangle, Repeat, Bell, FileText, ListChecks,
  Users, UserCheck, Eye, Edit3, Share2, MoreVertical, MessageCircle, Send, Video,
  Link2, Plus, ArrowRight
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

// pageMode=true → renders as a scrollable page (mobile/tablet)
// pageMode=false (default) → renders as a modal popup (desktop)
export default function TaskDetailModal({ task, onClose, onUpdated, pageMode = false }) {
  const { toggleTask, deleteTask, fetchTasks, addToast } = useTaskStore();
  const [showEdit, setShowEdit] = useState(false);
  const [sharingToChat, setSharingToChat] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [taskLinks, setTaskLinks] = useState([]);
  const [groupTaskCandidates, setGroupTaskCandidates] = useState([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [linkQuery, setLinkQuery] = useState('');
  const [pendingLinkTarget, setPendingLinkTarget] = useState(null);
  const [linkSaving, setLinkSaving] = useState(false);
  const [removingLinkId, setRemovingLinkId] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const menuRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const swipeRef = useRef({ startY: 0, active: false });
  const pullRafRef = useRef(null);
  const pullNextRef = useRef(0);
  const pullOffsetRef = useRef(0);
  const [pullOffset, setPullOffset] = useState(0);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Swipe down to close on mobile
  const queuePullOffset = (next) => {
    pullNextRef.current = next;
    if (pullRafRef.current !== null) return;
    pullRafRef.current = window.requestAnimationFrame(() => {
      pullRafRef.current = null;
      setPullOffset((prev) => (prev === pullNextRef.current ? prev : pullNextRef.current));
    });
  };

  const handleTouchStart = (e) => {
    if (!isMobile) return;
    swipeRef.current = { startY: e.touches[0].clientY, active: true };
  };
  const handleTouchMove = (e) => {
    if (!isMobile || !swipeRef.current.active) return;
    const dy = e.touches[0].clientY - swipeRef.current.startY;

    // Only pull down when content is already at top.
    if (dy <= 0 || e.currentTarget.scrollTop > 0) {
      if (pullOffsetRef.current !== 0) {
        pullOffsetRef.current = 0;
        queuePullOffset(0);
      }
      return;
    }

    // Prevent iOS rubber-band/background scroll and move modal itself instead.
    if (e.cancelable) e.preventDefault();
    const maxPull = Math.max(420, (typeof window !== 'undefined' ? window.innerHeight : 800) - 28);
    const resisted = Math.min(dy * 0.95, maxPull);
    pullOffsetRef.current = resisted;
    queuePullOffset(resisted);
  };
  const handleTouchEnd = (e) => {
    if (!isMobile || !swipeRef.current.active) return;
    const dy = e.changedTouches[0].clientY - swipeRef.current.startY;
    swipeRef.current.active = false;
    const shouldClose = dy > 130 && e.currentTarget.scrollTop <= 0;
    pullOffsetRef.current = 0;
    queuePullOffset(0);
    // Down swipe: close and return to underlying previous view.
    if (shouldClose) { onClose(); return; }
  };

  useEffect(() => {
    return () => {
      if (pullRafRef.current !== null) {
        window.cancelAnimationFrame(pullRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isMobile || pageMode) return;
    const stopBackgroundTouchWhilePulling = (e) => {
      if (pullOffsetRef.current > 0 && e.cancelable) {
        e.preventDefault();
      }
    };
    document.addEventListener('touchmove', stopBackgroundTouchWhilePulling, { passive: false });
    return () => document.removeEventListener('touchmove', stopBackgroundTouchWhilePulling);
  }, [isMobile, pageMode]);

  useEffect(() => {
    // Lock background scroll while modal is open (desktop + mobile overlay mode)
    // pageMode stays unlocked because it is rendered as normal page content.
    if (pageMode) return;
    lockScroll();
    return () => unlockScroll();
  }, [pageMode]);

  const currentUser = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
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
  const hasGroupContext = !!task?.group_id;

  const refreshTaskLinks = async () => {
    if (!task?.group_id || !task?.id) {
      setTaskLinks([]);
      return;
    }
    setLoadingLinks(true);
    try {
      const [linksRes, groupRes] = await Promise.all([
        api.getGroupTaskLinks(task.group_id),
        api.getGroup(task.group_id),
      ]);
      const allLinks = Array.isArray(linksRes?.links) ? linksRes.links : [];
      const allTasks = Array.isArray(groupRes?.tasks) ? groupRes.tasks : [];
      const ownId = Number(task.id);
      const relevant = allLinks
        .filter((l) => Number(l.parent_task_id) === ownId || Number(l.child_task_id) === ownId)
        .map((l) => {
          const isParent = Number(l.parent_task_id) === ownId;
          const relatedId = isParent ? Number(l.child_task_id) : Number(l.parent_task_id);
          const relatedTask = allTasks.find((t) => Number(t.id) === relatedId) || null;
          return {
            ...l,
            relation: isParent ? 'contains' : 'belongs_to',
            related_task_id: relatedId,
            related_task: relatedTask,
          };
        });

      setTaskLinks(relevant);
      setGroupTaskCandidates(allTasks.filter((t) => Number(t.id) !== ownId));
    } catch {
      setTaskLinks([]);
      setGroupTaskCandidates([]);
    } finally {
      setLoadingLinks(false);
    }
  };

  useEffect(() => {
    if (!task?.id) { setComments([]); return; }
    api.getComments(task.id)
      .then((res) => { if (res.comments && Array.isArray(res.comments)) setComments(res.comments); })
      .catch(() => setComments([]));
  }, [task?.id]);

  useEffect(() => {
    refreshTaskLinks();
  }, [task?.id, task?.group_id]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      if (emojiPickerRef.current?.contains(e.target)) return;
      setShowMenu(false);
      setShowShareMenu(false);
      setShowEmojiPicker(false);
    };
    if (showMenu || showEmojiPicker) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [showMenu, showEmojiPicker]);

  if (!task) return null;

  const handleToggle = async () => {
    const updated = await toggleTask(task.id);
    if (updated && onUpdated) onUpdated(updated);
  };

  const handleDelete = () => { deleteTask(task.id); onClose(); };

  const handleAddComment = async () => {
    const text = commentText.trim();
    if (!text) return;
    const optimistic = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      emoji: '💬', text,
      author: currentUser?.name || 'Du',
      created_at: new Date().toISOString(),
      user_id: currentUser?.id || null,
    };
    setCommentText('');
    setComments((prev) => [...prev, optimistic]);
    try {
      const res = await api.addComment(task.id, '💬', text);
      if (res.comment) {
        setComments((prev) => prev.map((c) => (c.id === optimistic.id ? res.comment : c)));
        addToast('✅ Kommentar hinzugefügt');
      }
    } catch {
      setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
      addToast('❌ Kommentar konnte nicht gespeichert werden');
    }
  };

  const buildShareText = () => {
    const lines = [];
    lines.push(isEvent ? `Termin: ${task.title}` : `Aufgabe: ${task.title}`);
    if (task.date) {
      const dateLabel = formatDate(task.date);
      lines.push(`Datum: ${dateLabel}`);
    }
    if (task.time) {
      const timeStr = task.time.slice(0, 5) + (task.time_end ? ` – ${task.time_end.slice(0, 5)}` : '');
      lines.push(`Uhrzeit: ${timeStr}`);
    }
    if (task.category_name) lines.push(`Kategorie: ${task.category_name}`);
    if (task.priority) {
      const prioLabels = { low: 'Niedrig', medium: 'Mittel', high: 'Hoch', urgent: 'Dringend' };
      lines.push(`Priorität: ${prioLabels[task.priority] || task.priority}`);
    }
    if (task.description) lines.push(`\n${task.description}`);
    lines.push('\nBeeQu – smarter planen. https://beequ.app');
    return lines.join('\n');
  };

  const handleShare = async (target) => {
    setShowMenu(false);
    setShowShareMenu(false);
    const text = buildShareText();
    const link = `https://beequ.app/?task=${task.id}`;
    if (target === 'native' && navigator.share) {
      try { await navigator.share({ title: task.title, text, url: link }); } catch { /* abgebrochen */ }
      return;
    }
    if (target === 'whatsapp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(text + '\n' + link)}`, '_blank', 'noopener,noreferrer');
      return;
    }
    if (target === 'copy') {
      try {
        await navigator.clipboard.writeText(link);
        addToast('Link kopiert');
      } catch {
        addToast('Kopieren fehlgeschlagen');
      }
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

  const filteredLinkCandidates = useMemo(() => {
    const q = linkQuery.trim().toLowerCase();
    const usedIds = new Set(taskLinks.map((l) => Number(l.related_task_id)));
    return groupTaskCandidates
      .filter((t) => !usedIds.has(Number(t.id)))
      .filter((t) => !q || String(t.title || '').toLowerCase().includes(q))
      .slice(0, 40);
  }, [groupTaskCandidates, taskLinks, linkQuery]);

  const confirmCreateLink = async (direction) => {
    if (!pendingLinkTarget?.id || !task?.group_id) return;
    const parentTaskId = direction === 'to_current' ? Number(task.id) : Number(pendingLinkTarget.id);
    const childTaskId = direction === 'to_current' ? Number(pendingLinkTarget.id) : Number(task.id);
    setLinkSaving(true);
    try {
      await api.createGroupTaskLink(task.group_id, parentTaskId, childTaskId);
      addToast('🔗 Verknüpfung erstellt');
      setPendingLinkTarget(null);
      setShowLinkPicker(false);
      setLinkQuery('');
      await refreshTaskLinks();
      fetchTasks({ dashboard: 'true', limit: '300', horizon_days: '42', completed_lookback_days: '30' }, { force: true });
    } catch (err) {
      addToast(`❌ ${err?.message || 'Verknüpfung fehlgeschlagen'}`);
    } finally {
      setLinkSaving(false);
    }
  };

  const handleRemoveLink = async (linkId) => {
    if (!task?.group_id || !linkId) return;
    setRemovingLinkId(linkId);
    try {
      await api.deleteGroupTaskLink(task.group_id, linkId);
      setTaskLinks((prev) => prev.filter((l) => Number(l.id) !== Number(linkId)));
      addToast('Verknüpfung entfernt');
      fetchTasks({ dashboard: 'true', limit: '300', horizon_days: '42', completed_lookback_days: '30' }, { force: true });
    } catch (err) {
      addToast(`❌ ${err?.message || 'Löschen fehlgeschlagen'}`);
    } finally {
      setRemovingLinkId(null);
    }
  };

  const linkSection = hasGroupContext ? (
    <div className="task-detail-section task-detail-links">
      <div className="task-detail-description-header">
        <Link2 size={16} /><span>Verknüpfungen</span>
      </div>

      <div className={`task-detail-links-shell${isMobile ? ' mobile' : ' desktop'}`}>
        <div className="task-detail-links-topbar">
          <span className="task-detail-links-count">{taskLinks.length} verbunden</span>
          <button type="button" className="task-detail-links-add" onClick={() => setShowLinkPicker((v) => !v)}>
            <Plus size={14} /> Hinzufügen
          </button>
        </div>

        {showLinkPicker && (
          <div className="task-detail-links-picker">
            <input
              className="task-detail-links-search"
              placeholder="Eintrag suchen..."
              value={linkQuery}
              onChange={(e) => setLinkQuery(e.target.value)}
            />
            <div className="task-detail-links-candidates">
              {filteredLinkCandidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className="task-detail-links-candidate"
                  onClick={() => setPendingLinkTarget(candidate)}
                >
                  <span className={`task-detail-link-type ${candidate.type === 'event' ? 'event' : 'task'}`}>
                    {candidate.type === 'event' ? 'Termin' : 'Aufgabe'}
                  </span>
                  <span className="task-detail-links-candidate-title">{candidate.title}</span>
                </button>
              ))}
              {filteredLinkCandidates.length === 0 && (
                <p className="task-detail-links-empty">Keine verfügbaren Einträge gefunden.</p>
              )}
            </div>
          </div>
        )}

        {pendingLinkTarget && (
          <div className="task-detail-links-confirm">
            <p>
              Möchtest du <strong>{pendingLinkTarget.title}</strong> mit <strong>{task.title}</strong> verknüpfen?
            </p>
            <div className="task-detail-links-confirm-actions">
              <button type="button" onClick={() => confirmCreateLink('to_current')} disabled={linkSaving}>
                <ArrowRight size={14} /> Zu diesem Eintrag hinzufügen
              </button>
              <button type="button" onClick={() => confirmCreateLink('from_current')} disabled={linkSaving}>
                <ArrowRight size={14} /> Diesem Eintrag unterordnen
              </button>
              <button type="button" className="ghost" onClick={() => setPendingLinkTarget(null)} disabled={linkSaving}>
                Abbrechen
              </button>
            </div>
          </div>
        )}

        {loadingLinks ? (
          <div className="task-detail-links-loading">Lade Verknüpfungen...</div>
        ) : taskLinks.length === 0 ? (
          <div className="task-detail-links-empty-wrap">Noch keine Verknüpfungen.</div>
        ) : (
          <div className="task-detail-links-list">
            {taskLinks.map((link) => (
              <div key={link.id} className="task-detail-link-row">
                <div className="task-detail-link-main">
                  <span className={`task-detail-link-type ${link.related_task?.type === 'event' ? 'event' : 'task'}`}>
                    {link.related_task?.type === 'event' ? 'Termin' : 'Aufgabe'}
                  </span>
                  <span className="task-detail-link-title">{link.related_task?.title || link.child_title || link.parent_title}</span>
                  <span className="task-detail-link-direction">
                    {link.relation === 'contains' ? 'Hinzugefügt' : 'Gehört zu'}
                  </span>
                </div>
                <button
                  type="button"
                  className="task-detail-link-delete"
                  onClick={() => handleRemoveLink(link.id)}
                  disabled={removingLinkId === link.id}
                  title="Verknüpfung entfernen"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  ) : null;

  const content = (
    <motion.div
      className={`task-detail-modal${pageMode ? ' task-detail-page-mode' : ''}${isMobile ? ' is-mobile-fullscreen' : ''}${!isEvent ? ' is-task-detail' : ''}`}
      initial={isMobile ? { y: '100%' } : (pageMode ? { opacity: 0, x: 30 } : { opacity: 0, y: 24 })}
      animate={isMobile ? { y: pullOffset } : (pageMode ? { opacity: 1, x: 0 } : { opacity: 1, y: 0 })}
      exit={isMobile ? { y: '100%' } : (pageMode ? {} : { opacity: 0, y: 16 })}
      transition={{
        type: 'tween',
        duration: isMobile ? (pullOffset > 0 ? 0 : 0.16) : (pageMode ? 0.22 : 0.2),
        ease: 'easeOut'
      }}
      onClick={(!pageMode && !isMobile) ? (e) => e.stopPropagation() : undefined}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="task-detail-main">
        <div className="task-detail-header">
          {pageMode && (
            <button className="task-detail-back-btn" onClick={onClose}>
              <ArrowLeft size={18} />
            </button>
          )}
          <div className="task-detail-priority-bar" style={{ background: priority.color }} />
          {isMobile && <div className="modal-pull-handle" />}
          <div className="task-detail-header-actions" ref={menuRef}>
            <button className="task-detail-more-btn" onClick={() => setShowMenu((s) => !s)} title="Mehr" aria-label="Mehr">
              <MoreVertical size={18} />
            </button>
            {showMenu && (
              <div className="task-detail-more-menu">
                {canEdit && (
                  <button className="task-detail-more-item" onClick={() => { setShowMenu(false); setShowEdit(true); }}>
                    Bearbeiten
                  </button>
                )}
                <div className="task-detail-more-item-wrap">
                  <button
                    className="task-detail-more-item"
                    onClick={() => setShowShareMenu((s) => !s)}
                  >
                    <Share2 size={14} style={{ marginRight: 6 }} />
                    Teilen
                  </button>
                  {showShareMenu && (
                    <div className="task-detail-share-submenu">
                      {typeof navigator !== 'undefined' && navigator.share && (
                        <button className="task-detail-more-item" onClick={() => handleShare('native')}>
                          Systemdialog
                        </button>
                      )}
                      <button className="task-detail-more-item" onClick={() => handleShare('whatsapp')}>
                        WhatsApp
                      </button>
                      <button className="task-detail-more-item" onClick={() => handleShare('copy')}>
                        Link kopieren
                      </button>
                    </div>
                  )}
                </div>
                {task.is_owner !== false && (
                  <button className="task-detail-more-item danger" onClick={() => { setShowMenu(false); handleDelete(); }}>
                    Löschen
                  </button>
                )}
              </div>
            )}
            {!pageMode && (
              <button className="task-detail-close" onClick={onClose}><X size={20} /></button>
            )}
          </div>
        </div>

        <div className="task-detail-title-row">
          {isEvent ? (
            <div className="task-detail-event-icon"><CalendarCheck size={28} /></div>
          ) : (
            <motion.div className={`task-detail-checkbox ${task.completed ? 'checked' : ''}`} onClick={handleToggle} whileTap={{ scale: 0.85 }}>
              {task.completed ? <CheckCircle2 size={28} /> : <Circle size={28} />}
            </motion.div>
          )}
          <div>
            <h2 className={`task-detail-title ${task.completed && !isEvent ? 'completed' : ''}`}>{task.title}</h2>
            {!isEvent && <span className="task-detail-status task">Aufgabe</span>}
            {isEvent && <span className="task-detail-status event">Termin</span>}
            {isEvent && isEventEnded && <span className="task-detail-status ended">Beendet</span>}
            {!isEvent && task.completed && <span className="task-detail-status done">Erledigt</span>}
            {isOverdue && !isEvent && <span className="task-detail-status overdue">Überfällig</span>}
          </div>
        </div>

        {task.description && (
          <div className="task-detail-section">
            <div className="task-detail-description-header">
              {task.description.includes('•') ? <ListChecks size={16} /> : <FileText size={16} />}
              <span>{task.description.includes('•') ? 'Liste' : 'Details'}</span>
            </div>
            <div className="task-detail-description">
              {task.description.split('\n').map((line, i) => (
                <div key={i} className={line.startsWith('•') ? 'task-detail-list-item' : 'task-detail-desc-line'}>
                  {line.startsWith('•') ? (<><span className="task-detail-bullet">•</span>{line.substring(1).trim()}</>) : line}
                </div>
              ))}
            </div>
          </div>
        )}

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

        <TaskAttachments taskId={task.id} canEdit={canEdit} />

        {isMobile && linkSection}

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
      </div>

      <div className="task-detail-aside">
        {!isMobile && linkSection}
        {isShared && (
          <div className="task-detail-section task-detail-collab">
            <div className="task-detail-description-header">
              {task.visibility === 'shared' ? <Users size={16} /> : <UserCheck size={16} />}
              <span>{task.visibility === 'shared' ? 'Mit allen Freunden geteilt' : 'Mit ausgewählten Personen geteilt'}</span>
            </div>
            {Array.isArray(task.shared_with_users) && task.shared_with_users.length > 0 && (
              <div className="task-detail-shared-avatars">
                {task.shared_with_users.slice(0, 5).map((u, i) => (
                  <span key={i} className="task-detail-shared-avatar" style={{ zIndex: 10 - i, marginLeft: i > 0 ? -10 : 0 }} title={u.name}>
                    <AvatarBadge name={u.name} color={u.color || '#007AFF'} avatarUrl={u.avatar_url} size={30} />
                  </span>
                ))}
                {task.shared_with_users.length > 5 && (
                  <span className="task-detail-shared-overflow">+{task.shared_with_users.length - 5}</span>
                )}
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
      </div>
    </motion.div>
  );

  const editPortal = showEdit && createPortal(
    <TaskEditModal
      task={task}
      onClose={() => setShowEdit(false)}
      onSaved={(updatedTask) => {
        fetchTasks({ dashboard: 'true', limit: '300', horizon_days: '42', completed_lookback_days: '30' }, { force: true });
        onUpdated?.(updatedTask);
        onClose();
      }}
    />,
    document.body
  );

  if (pageMode) {
    return <>{content}{editPortal}</>;
  }

  // Mobile/tablet: render directly into body — no overlay wrapper
  // This ensures position:fixed works relative to viewport (not a stacking context)
  if (isMobile) {
    return (
      <>
        {createPortal(
          <AnimatePresence>{content}</AnimatePresence>,
          document.body
        )}
        {editPortal}
      </>
    );
  }

  // Desktop: classic centered overlay modal
  return (
    <>
      <AnimatePresence>
        <motion.div
          className="modal-overlay task-detail-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          {content}
        </motion.div>
      </AnimatePresence>
      {editPortal}
    </>
  );
}
