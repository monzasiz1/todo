import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTaskStore } from '../store/taskStore';
import { lockScroll, unlockScroll } from '../utils/scrollLock';
import { api } from '../utils/api';
import {
  X, ArrowLeft, Calendar, CalendarCheck, Clock, Tag, Flag, CheckCircle2, Circle,
  Trash2, AlertTriangle, Repeat, Bell, FileText, ListChecks,
  Users, UserCheck, Eye, Edit3, Share2, MoreVertical, MessageCircle, Send, Video, ThumbsUp, ThumbsDown
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
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const [taskVotes, setTaskVotes] = useState({ yes_count: 0, no_count: 0, yes_users: [], no_users: [], unanswered_users: [], my_vote: null, member_count: null, unanswered_count: null });
  const [voting, setVoting] = useState(false);
  const [votesOpen, setVotesOpen] = useState(null);
  const menuRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const modalScrollRef = useRef(null);
  const titleHeadingRef = useRef(null);
  const swipeRef = useRef({ startY: 0, active: false });
  const pullRafRef = useRef(null);
  const pullNextRef = useRef(0);
  const pullOffsetRef = useRef(0);
  const [pullOffset, setPullOffset] = useState(0);
  const [showCompactTitle, setShowCompactTitle] = useState(false);
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
  const groupWatermarkUrl = task?.group_image_url || task?.group_avatar_url || task?.group_photo_url || task?.group_logo_url || null;
  const hasGroupWatermark = Boolean(task?.group_id && groupWatermarkUrl);
  const eventEndAt = isEvent ? getEventEndDate(task) : null;
  const isEventEnded = isEvent && !!eventEndAt && eventEndAt.getTime() < Date.now();
  const voteYesCount = Number(taskVotes.yes_count || 0);
  const voteNoCount = Number(taskVotes.no_count || 0);
  const votePendingCount = Number.isFinite(Number(taskVotes?.unanswered_count))
    ? Math.max(0, Number(taskVotes.unanswered_count))
    : (Number.isFinite(Number(task?.vote_unanswered_count)) ? Math.max(0, Number(task.vote_unanswered_count)) : null);
  const voteNeedsAction = taskVotes.my_vote !== 'yes' && taskVotes.my_vote !== 'no';

  useEffect(() => {
    if (!task?.id) { setComments([]); return; }
    api.getComments(task.id)
      .then((res) => { if (res.comments && Array.isArray(res.comments)) setComments(res.comments); })
      .catch(() => setComments([]));
  }, [task?.id]);

  useEffect(() => {
    if (!task?.id || task?.enable_group_rsvp !== true) {
      setTaskVotes({ yes_count: 0, no_count: 0, yes_users: [], no_users: [], unanswered_users: [], my_vote: null, member_count: null, unanswered_count: null });
      setVotesOpen(null);
      return;
    }
    api.getTaskVotes(task.id)
      .then((res) => {
        setTaskVotes({
          yes_count: Number(res?.yes_count || 0),
          no_count: Number(res?.no_count || 0),
          yes_users: Array.isArray(res?.yes_users) ? res.yes_users : [],
          no_users: Array.isArray(res?.no_users) ? res.no_users : [],
          unanswered_users: Array.isArray(res?.unanswered_users) ? res.unanswered_users : [],
          my_vote: res?.my_vote || null,
          member_count: Number.isFinite(Number(res?.member_count)) ? Number(res.member_count) : null,
          unanswered_count: Number.isFinite(Number(res?.unanswered_count)) ? Number(res.unanswered_count) : null,
        });
      })
      .catch(() => {
        setTaskVotes({ yes_count: 0, no_count: 0, yes_users: [], no_users: [], unanswered_users: [], my_vote: null, member_count: null, unanswered_count: null });
      });
  }, [task?.id, task?.enable_group_rsvp]);

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

  useEffect(() => {
    const scroller = modalScrollRef.current;
    if (!isMobile || !scroller) {
      setShowCompactTitle(false);
      return;
    }

    let rafId = 0;
    const updateCompactTitle = () => {
      rafId = 0;
      const titleEl = titleHeadingRef.current;
      if (!titleEl) {
        setShowCompactTitle(false);
        return;
      }
      const scrollerTop = scroller.getBoundingClientRect().top;
      const titleBottom = titleEl.getBoundingClientRect().bottom;
      const shouldShow = titleBottom <= (scrollerTop + 72);
      setShowCompactTitle((prev) => (prev === shouldShow ? prev : shouldShow));
    };

    const onScrollOrResize = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(updateCompactTitle);
    };

    updateCompactTitle();
    scroller.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);

    return () => {
      scroller.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [isMobile, task?.id, task?.title]);

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
      author_avatar_url: currentUser?.avatar_url || null,
      author_color: currentUser?.avatar_color || currentUser?.color || '#007AFF',
      created_at: new Date().toISOString(),
      user_id: currentUser?.id || null,
    };
    setCommentText('');
    setComments((prev) => [...prev, optimistic]);
    try {
      const res = await api.addComment(task.id, '💬', text);
      if (res.comment) {
        setComments((prev) => prev.map((c) => (c.id === optimistic.id ? res.comment : c)));
        addToast('Kommentar hinzugefügt');
      }
    } catch {
      setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
      addToast('Kommentar konnte nicht gespeichert werden');
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
      addToast('📤 In den Gruppen-Chat geteilt');
    } catch (err) {
      addToast(err.message || 'Teilen fehlgeschlagen', 'error');
    } finally {
      setSharingToChat(false);
    }
  };

  const handleVote = async (status) => {
    if (!task?.id || voting) return;
    setVoting(true);
    try {
      const next = taskVotes.my_vote === status ? null : status;
      const res = await api.voteTask(task.id, next);
      setTaskVotes({
        yes_count: Number(res?.yes_count || 0),
        no_count: Number(res?.no_count || 0),
        yes_users: Array.isArray(res?.yes_users) ? res.yes_users : [],
        no_users: Array.isArray(res?.no_users) ? res.no_users : [],
        unanswered_users: Array.isArray(res?.unanswered_users) ? res.unanswered_users : [],
        my_vote: res?.my_vote || null,
        member_count: Number.isFinite(Number(res?.member_count)) ? Number(res.member_count) : null,
        unanswered_count: Number.isFinite(Number(res?.unanswered_count)) ? Number(res.unanswered_count) : null,
      });
    } catch {
      addToast('Abstimmung konnte nicht gespeichert werden');
    } finally {
      setVoting(false);
    }
  };

  const renderVoteSection = () => (
    <div className={`task-detail-section task-detail-votes-section${voteNeedsAction ? ' vote-needs-action' : ''}`}>
      <div className="task-detail-description-header">
        <ThumbsUp size={16} /><span>Abstimmung</span>
      </div>
      <div className="task-detail-vote-surface">
        {voteNeedsAction && (
          <div className="task-detail-vote-cta">Bitte stimme jetzt ab, damit die Gruppe direkt planen kann.</div>
        )}

        <div className={`task-detail-vote-actions${voteNeedsAction ? ' is-unvoted' : ''}`}>
          <button
            type="button"
            className={`task-detail-vote-btn yes ${taskVotes.my_vote === 'yes' ? 'active' : ''}`}
            onClick={() => handleVote('yes')}
            disabled={voting}
          >
            <ThumbsUp size={14} />
            <span>Zusagen</span>
            <span className="task-detail-vote-btn-count">{voteYesCount}</span>
          </button>
          <button
            type="button"
            className={`task-detail-vote-btn no ${taskVotes.my_vote === 'no' ? 'active' : ''}`}
            onClick={() => handleVote('no')}
            disabled={voting}
          >
            <ThumbsDown size={14} />
            <span>Absagen</span>
            <span className="task-detail-vote-btn-count">{voteNoCount}</span>
          </button>
          {votePendingCount !== null && (
            <button
              type="button"
              className={`task-detail-vote-btn pending ${votesOpen === 'pending' ? 'active' : ''}`}
              onClick={() => setVotesOpen(votesOpen === 'pending' ? null : 'pending')}
              disabled={voting}
              title="Unbeantwortete anzeigen"
            >
              <Users size={13} />
              <span>Unbeantwortet</span>
              <span className="task-detail-vote-btn-count">{votePendingCount}</span>
            </button>
          )}
        </div>

        <div className="task-detail-vote-attendees">
          {taskVotes.yes_users.length > 0 && (
            <button
              type="button"
              className="task-detail-vote-stack-btn task-detail-vote-stack-btn--yes"
              onClick={() => setVotesOpen(votesOpen === 'yes' ? null : 'yes')}
              title={`Zusagen (${taskVotes.yes_users.length})`}
            >
              <ThumbsUp size={12} />
              <span className="task-detail-vote-stack">
                {taskVotes.yes_users.slice(0, 5).map((u, i) => (
                  <span key={`yes_${i}`} className="task-detail-vote-avatar-wrap" style={{ zIndex: 6 - i }}>
                    <AvatarBadge name={u.name} color={u.avatar_color || '#4C7BD9'} avatarUrl={u.avatar_url} size={22} />
                  </span>
                ))}
                {taskVotes.yes_users.length > 5 && (
                  <span className="task-detail-vote-avatar-wrap task-detail-vote-avatar-wrap--more">+{taskVotes.yes_users.length - 5}</span>
                )}
              </span>
              <span className="task-detail-vote-count">{taskVotes.yes_users.length}</span>
            </button>
          )}
          {taskVotes.no_users.length > 0 && (
            <button
              type="button"
              className="task-detail-vote-stack-btn task-detail-vote-stack-btn--no"
              onClick={() => setVotesOpen(votesOpen === 'no' ? null : 'no')}
              title={`Absagen (${taskVotes.no_users.length})`}
            >
              <ThumbsDown size={12} />
              <span className="task-detail-vote-stack">
                {taskVotes.no_users.slice(0, 5).map((u, i) => (
                  <span key={`no_${i}`} className="task-detail-vote-avatar-wrap" style={{ zIndex: 6 - i }}>
                    <AvatarBadge name={u.name} color={u.avatar_color || '#8e8e93'} avatarUrl={u.avatar_url} size={22} />
                  </span>
                ))}
                {taskVotes.no_users.length > 5 && (
                  <span className="task-detail-vote-avatar-wrap task-detail-vote-avatar-wrap--more">+{taskVotes.no_users.length - 5}</span>
                )}
              </span>
              <span className="task-detail-vote-count">{taskVotes.no_users.length}</span>
            </button>
          )}
          {taskVotes.unanswered_users.length > 0 && (
            <button
              type="button"
              className="task-detail-vote-stack-btn task-detail-vote-stack-btn--pending"
              onClick={() => setVotesOpen(votesOpen === 'pending' ? null : 'pending')}
              title={`Unbeantwortet (${taskVotes.unanswered_users.length})`}
            >
              <Users size={12} />
              <span className="task-detail-vote-stack">
                {taskVotes.unanswered_users.slice(0, 5).map((u, i) => (
                  <span key={`pending_${i}`} className="task-detail-vote-avatar-wrap" style={{ zIndex: 6 - i }}>
                    <AvatarBadge name={u.name} color={u.avatar_color || '#8e8e93'} avatarUrl={u.avatar_url} size={22} />
                  </span>
                ))}
                {taskVotes.unanswered_users.length > 5 && (
                  <span className="task-detail-vote-avatar-wrap task-detail-vote-avatar-wrap--more">+{taskVotes.unanswered_users.length - 5}</span>
                )}
              </span>
              <span className="task-detail-vote-count">{taskVotes.unanswered_users.length}</span>
            </button>
          )}

          {votesOpen && (() => {
            const isYes = votesOpen === 'yes';
            const isNo = votesOpen === 'no';
            const users = isYes
              ? taskVotes.yes_users
              : (isNo ? taskVotes.no_users : taskVotes.unanswered_users);
            return (
              <div className={`task-detail-vote-popup ${isYes ? 'task-detail-vote-popup--yes' : (isNo ? 'task-detail-vote-popup--no' : 'task-detail-vote-popup--pending')}`}>
                <div className="task-detail-vote-popup-head">
                  {isYes ? <ThumbsUp size={12} /> : (isNo ? <ThumbsDown size={12} /> : <Users size={12} />)}
                  <span>{isYes ? 'Zusagen' : (isNo ? 'Absagen' : 'Unbeantwortet')} ({users.length})</span>
                  <button type="button" className="task-detail-vote-popup-close" onClick={() => setVotesOpen(null)}><X size={12} /></button>
                </div>
                <div className="task-detail-vote-popup-list">
                  {users.map((u, i) => (
                    <div key={`${isYes ? 'py' : (isNo ? 'pn' : 'pp')}_${i}`} className="task-detail-vote-popup-row">
                      <AvatarBadge name={u.name} color={u.avatar_color || (isYes ? '#4C7BD9' : '#8e8e93')} avatarUrl={u.avatar_url} size={24} />
                      <span className="task-detail-vote-popup-name">{u.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );

  const content = (
    <motion.div
      ref={modalScrollRef}
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
      <div className={`task-detail-main${hasGroupWatermark ? ' has-group-watermark' : ''}`}>
        {hasGroupWatermark && (
          <div className="task-detail-group-watermark" aria-hidden="true">
            <img src={groupWatermarkUrl} alt="" loading="lazy" />
          </div>
        )}
        <div className="task-detail-sticky-top">
          <div className="task-detail-header">
            {pageMode && (
              <button className="task-detail-back-btn" onClick={onClose}>
                <ArrowLeft size={18} />
              </button>
            )}
            <div className="task-detail-priority-bar" style={{ background: priority.color }} />
            {isMobile && <div className="modal-pull-handle" />}
            <div className={`task-detail-scroll-title ${showCompactTitle ? 'visible' : ''}${task.completed && !isEvent ? ' completed' : ''}`}>
              {task.title}
            </div>
            <div className="task-detail-header-actions" ref={menuRef} style={{ zIndex: 200, pointerEvents: 'auto' }}>
              <button className="task-detail-more-btn" onClick={() => setShowMenu((s) => !s)} title="Mehr" aria-label="Mehr" style={{ position: 'relative', zIndex: 201, pointerEvents: 'auto' }}>
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
                <button className="task-detail-close" onClick={onClose} style={{ position: 'relative', zIndex: 201, pointerEvents: 'auto' }}><X size={20} /></button>
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
              <h2 ref={titleHeadingRef} className={`task-detail-title ${task.completed && !isEvent ? 'completed' : ''}`}>{task.title}</h2>
              {!isEvent && <span className="task-detail-status task">Aufgabe</span>}
              {isEvent && <span className="task-detail-status event">Termin</span>}
              {isEvent && isEventEnded && <span className="task-detail-status ended">Beendet</span>}
              {!isEvent && task.completed && <span className="task-detail-status done">Erledigt</span>}
              {isOverdue && !isEvent && <span className="task-detail-status overdue">Überfällig</span>}
            </div>
          </div>
        </div>

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
                <div className="task-detail-time-range">
                  <span className="task-detail-time-chip">{task.time.slice(0, 5)}</span>
                  {task.time_end && (
                    <>
                      <span className="task-detail-time-arrow">→</span>
                      <span className="task-detail-time-chip task-detail-time-chip--end">{task.time_end.slice(0, 5)}</span>
                    </>
                  )}
                </div>
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

        <div className="task-detail-section">
          <div className="task-detail-description-header">
            {task.description?.includes('•') ? <ListChecks size={16} /> : <FileText size={16} />}
            <span>{task.description?.includes('•') ? 'Liste' : 'Details'}</span>
          </div>
          <div className="task-detail-description">
            {task.description
              ? task.description.split('\n').map((line, i) => (
                  <div key={i} className={line.startsWith('•') ? 'task-detail-list-item' : 'task-detail-desc-line'}>
                    {line.startsWith('•') ? (<><span className="task-detail-bullet">•</span>{line.substring(1).trim()}</>) : line}
                  </div>
                ))
              : <div className="task-detail-desc-line">Keine Details hinterlegt.</div>}
          </div>
        </div>

        {isMobile && task.group_id && task.enable_group_rsvp === true && renderVoteSection()}

        <TaskAttachments taskId={task.id} canEdit={canEdit} />

        {task.created_at && (
          <div className="task-detail-footer-info">
            Erstellt am {format(parseISO(task.created_at), 'd. MMMM yyyy, HH:mm', { locale: de })} Uhr
          </div>
        )}
        <div className="task-detail-actions">
          {task.group_id && !(isEvent && isEventEnded) && (
            <motion.button className="task-detail-btn edit" onClick={handleShareToGroupChat} whileTap={{ scale: 0.97 }} disabled={sharingToChat}>
              <Share2 size={18} /> {sharingToChat ? 'Teile...' : 'In Chat teilen'}
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
        {isShared && (
          <div className="task-detail-section task-detail-collab task-detail-collab-shared">
            <div className="task-detail-description-header">
              {task.visibility === 'shared' ? <Users size={16} /> : <UserCheck size={16} />}
              <span className="task-detail-collab-visibility">{task.visibility === 'shared' ? 'Mit allen Freunden geteilt' : 'Mit ausgewählten Personen geteilt'}</span>
            </div>
            {Array.isArray(task.shared_with_users) && task.shared_with_users.length > 0 && (
              <div className="task-detail-shared-stack-wrap">
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
                <span className="task-detail-shared-count">{task.shared_with_users.length} Person{task.shared_with_users.length === 1 ? '' : 'en'}</span>
              </div>
            )}
            {!task.is_owner && task.creator_name && (
              <div className="task-detail-collab-info">
                <AvatarBadge className="collab-avatar" name={task.creator_name} color={task.creator_color || '#007AFF'} avatarUrl={task.creator_avatar_url} size={22} />
                <span className="task-detail-collab-info-text"><span className="task-detail-collab-label">Erstellt von</span><strong>{task.creator_name}</strong></span>
              </div>
            )}
            {!canEdit && <div className="task-detail-collab-info readonly"><Eye size={14} /><span className="task-detail-collab-info-text"><span className="task-detail-collab-label">Zugriff</span>Du hast nur Leserechte</span></div>}
            {task.last_editor_name && (
              <div className="task-detail-collab-info">
                <Edit3 size={14} /><span className="task-detail-collab-info-text"><span className="task-detail-collab-label">Zuletzt bearbeitet von</span><strong>{task.last_editor_name}</strong></span>
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

        {!isMobile && task.group_id && task.enable_group_rsvp === true && renderVoteSection()}

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
                  <AvatarBadge
                    className="task-detail-comment-avatar"
                    name={c.author || 'Nutzer'}
                    color={c.author_color || '#8E8E93'}
                    avatarUrl={c.author_avatar_url}
                    size={20}
                  />
                  <span className="task-detail-comment-author">{c.author}</span>
                  <span className="task-detail-comment-time">{format(parseISO(c.created_at), 'd. MMM, HH:mm', { locale: de })}</span>
                  {currentUser?.id === c.user_id && (
                    <button type="button" className="task-detail-comment-delete" onClick={async () => {
                      try {
                        await api.deleteComment(c.id);
                        setComments((prev) => prev.filter((item) => item.id !== c.id));
                        addToast('Kommentar gelöscht');
                      } catch { addToast('Kommentar konnte nicht gelöscht werden'); }
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
