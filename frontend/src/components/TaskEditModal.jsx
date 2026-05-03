import { useState, useEffect, useRef } from 'react';
import { lockScroll, unlockScroll } from '../utils/scrollLock';
import { motion, AnimatePresence } from 'framer-motion';
import { useTaskStore } from '../store/taskStore';
import { useFriendsStore } from '../store/friendsStore';
import { api } from '../utils/api';
import {
  X, Calendar, CalendarCheck, Clock, Tag, Flag, FileText, Bell,
  Save, Users, UserCheck, Lock, Eye, Edit3, Video, ThumbsUp,
  ChevronDown, Sparkles, Loader2, AlertTriangle, UsersRound, Repeat, ListTodo
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import AvatarBadge from './AvatarBadge';
import TaskAttachments from './TaskAttachments';

const PRIORITIES = [
  { value: 'low', label: 'Niedrig', color: 'var(--success)' },
  { value: 'medium', label: 'Mittel', color: 'var(--primary)' },
  { value: 'high', label: 'Hoch', color: 'var(--warning)' },
  { value: 'urgent', label: 'Dringend', color: 'var(--danger)' },
];

const RECURRENCE_OPTIONS = [
  { value: '', label: 'Nie' },
  { value: 'daily', label: 'Täglich' },
  { value: 'weekdays', label: 'Werktags (Mo–Fr)' },
  { value: 'weekly', label: 'Wöchentlich' },
  { value: 'biweekly', label: 'Alle 2 Wochen' },
  { value: 'monthly', label: 'Monatlich' },
  { value: 'yearly', label: 'Jährlich' },
];

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Privat', icon: Lock, color: '#8E8E93' },
  { value: 'shared', label: 'Alle Freunde', icon: Users, color: '#007AFF' },
  { value: 'selected_users', label: 'Auswahl', icon: UserCheck, color: '#34C759' },
];

function parseVirtualTaskId(taskId) {
  if (typeof taskId !== 'string' || !taskId.startsWith('v_')) return null;
  const parts = taskId.split('_');
  if (parts.length < 3) return null;
  const date = parts[parts.length - 1];
  const parentId = parts.slice(1, -1).join('_');
  if (!parentId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { parentId, date };
}

export default function TaskEditModal({ task, onClose, onSaved }) {
  const { updateTask, fetchTasks, categories, fetchCategories, addToast } = useTaskStore();
  const { friends, fetchFriends } = useFriendsStore();
  const swipeRef = useRef({ startY: 0, active: false });
  const pullRafRef = useRef(null);
  const pullNextRef = useRef(0);
  const pullOffsetRef = useRef(0);
  const [pullOffset, setPullOffset] = useState(0);
  const titleFieldRef = useRef(null);
  const editHeaderRef = useRef(null);
  const [editTitleHidden, setEditTitleHidden] = useState(false);
  const [editScrollDarkened, setEditScrollDarkened] = useState(false);
  const [pullHandleHidden, setPullHandleHidden] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches
  );
  const virtualTask = parseVirtualTaskId(task.id);

  useEffect(() => { lockScroll(); return () => unlockScroll(); }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const titleEl = titleFieldRef.current;
    const headerEl = editHeaderRef.current;
    if (!titleEl || !headerEl) return;
    const check = () => {
      const titleRect = titleEl.getBoundingClientRect();
      const headerRect = headerEl.getBoundingClientRect();
      const scrolled = titleRect.top < headerRect.bottom;
      setEditTitleHidden(scrolled);
      setEditScrollDarkened(titleRect.top < headerRect.bottom + 8);
      setPullHandleHidden(scrolled);
    };
    const scrollEl =
      titleEl.closest('.is-mobile-fullscreen') ||
      titleEl.closest('.task-edit-body') ||
      titleEl.closest('.task-edit-modal');
    scrollEl?.addEventListener('scroll', check, { passive: true });
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check, { passive: true });
    check();
    return () => {
      scrollEl?.removeEventListener('scroll', check);
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [isMobile]);

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
    if (dy <= 0 || e.currentTarget.scrollTop > 0) {
      if (pullOffsetRef.current !== 0) {
        pullOffsetRef.current = 0;
        queuePullOffset(0);
      }
      return;
    }
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
    const shouldClose = dy > 120 && e.currentTarget.scrollTop <= 0;
    pullOffsetRef.current = 0;
    queuePullOffset(0);
    if (shouldClose) onClose();
  };

  useEffect(() => {
    if (!isMobile) return;
    const stopBackgroundTouchWhilePulling = (e) => {
      if (pullOffsetRef.current > 0 && e.cancelable) e.preventDefault();
    };
    document.addEventListener('touchmove', stopBackgroundTouchWhilePulling, { passive: false });
    return () => document.removeEventListener('touchmove', stopBackgroundTouchWhilePulling);
  }, [isMobile]);

  useEffect(() => {
    return () => {
      if (pullRafRef.current !== null) window.cancelAnimationFrame(pullRafRef.current);
    };
  }, []);
  const seriesTaskId = virtualTask ? virtualTask.parentId : (task.recurrence_parent_id || task.id);

  // Form state
  const [taskType, setTaskType] = useState(task.type || 'task');
  const [title, setTitle] = useState(task.title || '');
  const [description, setDescription] = useState(task.description || '');
  const [date, setDate] = useState(task.date ? task.date.substring(0, 10) : '');
  const [dateEnd, setDateEnd] = useState(task.date_end ? task.date_end.substring(0, 10) : '');
  const [time, setTime] = useState(task.time ? task.time.substring(0, 5) : '');
  const [timeEnd, setTimeEnd] = useState(task.time_end ? task.time_end.substring(0, 5) : '');
  const [allDay, setAllDay] = useState(Boolean(task.date && !task.time && !task.time_end));
  const [priority, setPriority] = useState(task.priority || 'medium');
  const [categoryId, setCategoryId] = useState(task.category_id || '');
  const [reminderAt, setReminderAt] = useState(
    task.reminder_at ? format(parseISO(task.reminder_at), "yyyy-MM-dd'T'HH:mm") : ''
  );

  // Wandelt datetime-local Wert in ISO mit Timezone-Offset um
  function localToISO(dtLocal) {
    if (!dtLocal) return null;
    const d = new Date(dtLocal);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  // Recurrence state
  const [recurrenceRule, setRecurrenceRule] = useState(task.recurrence_rule || '');
  const [recurrenceEnd, setRecurrenceEnd] = useState(task.recurrence_end ? task.recurrence_end.substring(0, 10) : '');

  // Sharing state
  const [visibility, setVisibility] = useState(task.visibility || 'private');
  const [permissions, setPermissions] = useState([]);
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [showSharing, setShowSharing] = useState(false);

  // Group state
  const [userGroups, setUserGroups] = useState([]);
  const [taskGroupId, setTaskGroupId] = useState(task.group_id || null);
  const [groupCategories, setGroupCategories] = useState([]);
  const [taskGroupCategoryId, setTaskGroupCategoryId] = useState(task.group_category_id || '');
  const [enableGroupRsvp, setEnableGroupRsvp] = useState(task.enable_group_rsvp === true);
  const [showGroups, setShowGroups] = useState(!!task.group_id);

  const [saving, setSaving] = useState(false);
  const [showDateEnd, setShowDateEnd] = useState(!!task.date_end);
  const [showTimeEnd, setShowTimeEnd] = useState(!!task.time_end);

  // Teams state
  const [addTeamsMeeting, setAddTeamsMeeting] = useState(false);
  const [teamsConnected, setTeamsConnected] = useState(null);
  const hasTeamsMeeting = !!task.teams_join_url;

  useEffect(() => {
    let mounted = true;
    if (categories.length === 0) fetchCategories();
    fetchFriends();

    const initAsync = async () => {
      if (seriesTaskId) {
        try {
          setLoadingPerms(true);
          const data = await api.getPermissions(seriesTaskId);
          if (!mounted) return;
          setVisibility(data.visibility || 'private');
          setPermissions(
            (data.permissions || []).map((p) => ({
              user_id: p.user_id,
              can_view: p.can_view,
              can_edit: p.can_edit,
              name: p.user_name,
              avatar_color: p.avatar_color,
              avatar_url: p.avatar_url,
            }))
          );
        } catch {
          // Permissions table might not exist yet
        } finally {
          if (mounted) setLoadingPerms(false);
        }
      }

      try {
        const data = await api.getGroups();
        if (mounted) setUserGroups(data.groups || []);
      } catch {
        // Groups might not exist yet
      }

      try {
        const d = await api.getTeamsStatus();
        if (mounted) setTeamsConnected(d.connected);
      } catch {
        if (mounted) setTeamsConnected(false);
      }
    };

    initAsync();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!taskGroupId) {
      setGroupCategories([]);
      setTaskGroupCategoryId('');
      return () => {
        mounted = false;
      };
    }

    api.getGroupCategories(taskGroupId)
      .then((data) => {
        if (!mounted) return;
        const categories = Array.isArray(data?.categories) ? data.categories : [];
        setGroupCategories(categories);
        setTaskGroupCategoryId((prev) => {
          if (!prev) return '';
          const exists = categories.some((cat) => String(cat.id) === String(prev));
          return exists ? prev : '';
        });
      })
      .catch(() => {
        if (!mounted) return;
        setGroupCategories([]);
        setTaskGroupCategoryId('');
      });

    return () => {
      mounted = false;
    };
  }, [taskGroupId]);

  const toggleFriendPermission = (friendUserId, friendName, friendColor, friendAvatarUrl, action) => {
    setPermissions(prev => {
      const existing = prev.find(p => p.user_id === friendUserId);
      if (action === 'remove') {
        return prev.filter(p => p.user_id !== friendUserId);
      }
      if (action === 'add') {
        if (existing) return prev;
        return [...prev, {
          user_id: friendUserId,
          can_view: true,
          can_edit: false,
          name: friendName,
          avatar_color: friendColor,
          avatar_url: friendAvatarUrl,
        }];
      }
      if (action === 'toggle_edit') {
        if (!existing) return prev;
        return prev.map(p => p.user_id === friendUserId ? { ...p, can_edit: !p.can_edit } : p);
      }
      return prev;
    });
  };

  const handleSave = async () => {
    if (!title.trim()) {
      addToast('Titel darf nicht leer sein', 'error');
      return;
    }

    setSaving(true);
    try {
      const normalizedVisibilityPermissions = visibility === 'selected_users'
        ? permissions.map((p) => ({ user_id: p.user_id, can_view: p.can_view, can_edit: p.can_edit }))
        : [];

      const hasCoreChanges = (
        taskType !== (task.type || 'task') ||
        title.trim() !== (task.title || '') ||
        description.trim() !== (task.description || '') ||
        (date || null) !== (task.date ? task.date.substring(0, 10) : null) ||
        (dateEnd || null) !== (task.date_end ? task.date_end.substring(0, 10) : null) ||
        ((allDay ? null : (time || null)) !== (task.time ? task.time.substring(0, 5) : null)) ||
        ((allDay ? null : (timeEnd || null)) !== (task.time_end ? task.time_end.substring(0, 5) : null)) ||
        priority !== (task.priority || 'medium') ||
        String(categoryId || '') !== String(task.category_id || '') ||
        (enableGroupRsvp === true) !== (task.enable_group_rsvp === true) ||
        String(localToISO(reminderAt) || '') !== String(task.reminder_at || '') ||
        (recurrenceRule || null) !== (task.recurrence_rule || null) ||
        (recurrenceEnd || null) !== (task.recurrence_end ? task.recurrence_end.substring(0, 10) : null)
      );
      const needsConcreteTeamsTask = (
        taskType === 'event' &&
        addTeamsMeeting &&
        !hasTeamsMeeting &&
        String(task.id).startsWith('v_')
      );

      // 1. Update task fields only when actual core data changed.
      const updates = {
        type: taskType,
        title: title.trim(),
        description: description.trim(),
        date: date || null,
        date_end: dateEnd || null,
        time: allDay ? null : (time || null),
        time_end: allDay ? null : (timeEnd || null),
        priority,
        category_id: categoryId || null,
        enable_group_rsvp: enableGroupRsvp === true,
        reminder_at: localToISO(reminderAt),
        recurrence_rule: recurrenceRule || null,
        recurrence_interval: 1,
        recurrence_end: recurrenceEnd || null,
      };
      const shouldPersistTask = hasCoreChanges || needsConcreteTeamsTask;
      const updatedTask = shouldPersistTask ? await updateTask(task.id, updates) : task;

      if (shouldPersistTask && !updatedTask) {
        throw new Error('Speichern fehlgeschlagen');
      }

      // 2. Update sharing/permissions (if collab tables exist)
      try {
        await api.setPermissions(seriesTaskId, {
          visibility,
          permissions: normalizedVisibilityPermissions,
        });
      } catch {
        // Ignore if collaboration tables don't exist
      }

      // 3. Update group assignment
      try {
        const oldGroupId = task.group_id || null;
        const newGroupId = taskGroupId || null;
        const groupChanged = oldGroupId !== newGroupId;
        const groupCategoryChanged = String(taskGroupCategoryId || '') !== String(task.group_category_id || '');
        if (oldGroupId !== newGroupId) {
          // Remove from old group
          if (oldGroupId) {
            await api.removeGroupTask(oldGroupId, seriesTaskId);
          }
        }
        // Add/update in selected group (also updates group category on same-group edits)
        if (newGroupId && (groupChanged || groupCategoryChanged)) {
          await api.addGroupTask(newGroupId, {
            existing_task_id: seriesTaskId,
            group_category_id: taskGroupCategoryId || null,
          });
        }
      } catch {
        // Ignore if group tables don't exist
      }

      let finalTask = updatedTask || task;

      // Handle Teams meeting creation / removal (events only)
      if (taskType === 'event') {
        const resolvedId = finalTask?.id || (String(task.id).startsWith('v_') ? null : task.id);
        if (addTeamsMeeting && !hasTeamsMeeting && resolvedId) {
          try {
            const teamsResult = await api.createTeamsMeeting({
              task_id: resolvedId,
              title: title.trim(),
              date: date || null,
              time: allDay ? null : (time || null),
              time_end: allDay ? null : (timeEnd || null),
            });

            finalTask = {
              ...finalTask,
              teams_join_url: teamsResult?.join_url || finalTask?.teams_join_url || null,
              teams_meeting_id: teamsResult?.meeting_id || finalTask?.teams_meeting_id || null,
            };
            addToast('Teams-Meeting erstellt');
          } catch (err) {
            addToast(err.message || 'Teams-Meeting konnte nicht erstellt werden', 'error');
          }
        }
      }

      addToast('Änderungen gespeichert');

      onSaved?.(finalTask);
      
      // Force reload next fetch to ensure calendar updates immediately
      if (fetchTasks) {
        setTimeout(() => fetchTasks({ force: true }), 150);
      }
      
      onClose();
    } catch (err) {
      addToast(err.message || 'Speichern fehlgeschlagen', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      className="modal-overlay task-edit-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className={`task-edit-modal${isMobile ? ' is-mobile-fullscreen' : ''}`}
        initial={isMobile ? { y: '100%' } : { opacity: 0, y: 60, scale: 0.95 }}
        animate={isMobile ? { y: pullOffset } : { opacity: 1, y: 0, scale: 1 }}
        exit={isMobile ? { y: '100%' } : { opacity: 0, y: 40, scale: 0.95 }}
        transition={isMobile
          ? { type: 'tween', duration: pullOffset > 0 ? 0 : 0.16, ease: 'easeOut' }
          : { type: 'spring', damping: 28, stiffness: 350 }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {isMobile && <div className={`modal-pull-handle${pullHandleHidden ? ' pull-handle-hidden' : ''}`} />}
        {/* Top shadow for edit modal */}
        <div className={`task-detail-top-shadow${editScrollDarkened ? ' visible' : ''}`} aria-hidden="true" />
        {/* Header */}
        <div className="task-edit-header" ref={editHeaderRef}>
          <h2 style={{ opacity: editTitleHidden ? 0 : 1, transition: 'opacity 0.15s ease', pointerEvents: 'none' }}>
            Aufgabe bearbeiten
          </h2>
          <div className={`task-detail-sticky-title task-edit-sticky-title${editTitleHidden ? ' visible' : ''}`}>
            <span>Aufgabe bearbeiten</span>
          </div>
          <button className="task-edit-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="task-edit-body">
          {/* Type Toggle */}
          <div className="task-type-toggle">
            <button
              type="button"
              className={`task-type-btn ${taskType === 'task' ? 'active' : ''}`}
              onClick={() => setTaskType('task')}
            >
              <ListTodo size={16} />
              Aufgabe
            </button>
            <button
              type="button"
              className={`task-type-btn event ${taskType === 'event' ? 'active' : ''}`}
              onClick={() => setTaskType('event')}
            >
              <CalendarCheck size={16} />
              Termin
            </button>
          </div>

          {/* Title */}
          <div className="task-edit-field" ref={titleFieldRef}>
            <label><FileText size={14} /> Titel</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Aufgabe..."
              className="task-edit-input"
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="task-edit-field">
            <label><FileText size={14} /> Beschreibung</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Details, Notizen..."
              className="task-edit-input task-edit-textarea"
              rows={3}
            />
          </div>

          {/* Date */}
          <div className="task-edit-row">
            <div className="task-edit-field flex-1">
              <label><Calendar size={14} /> Datum</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="task-edit-input"
              />
            </div>
            {showDateEnd ? (
              <div className="task-edit-field flex-1">
                <label>Bis</label>
                <div className="task-edit-removable">
                  <input
                    type="date"
                    value={dateEnd}
                    onChange={(e) => setDateEnd(e.target.value)}
                    className="task-edit-input"
                  />
                  <button className="task-edit-remove-btn" onClick={() => { setShowDateEnd(false); setDateEnd(''); }}>
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <button className="task-edit-add-btn" onClick={() => setShowDateEnd(true)}>
                + Enddatum
              </button>
            )}
          </div>

          {/* Time */}
          <div className="task-edit-row">
            <div className="task-edit-field flex-1">
              <label><Clock size={14} /> Uhrzeit</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="task-edit-input"
                disabled={allDay}
                style={allDay ? { opacity: 0.45 } : undefined}
              />
            </div>
            {!allDay && showTimeEnd ? (
              <div className="task-edit-field flex-1">
                <label>Bis</label>
                <div className="task-edit-removable">
                  <input
                    type="time"
                    value={timeEnd}
                    onChange={(e) => setTimeEnd(e.target.value)}
                    className="task-edit-input"
                  />
                  <button className="task-edit-remove-btn" onClick={() => { setShowTimeEnd(false); setTimeEnd(''); }}>
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : !allDay ? (
              <button className="task-edit-add-btn" onClick={() => setShowTimeEnd(true)}>
                + Endzeit
              </button>
            ) : (
              <div className="task-edit-field flex-1" style={{ marginBottom: 0, display: 'flex', alignItems: 'flex-end' }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', paddingBottom: 10 }}>
                  Ganztägig ohne Uhrzeit
                </div>
              </div>
            )}
          </div>

          <div className="task-edit-field" style={{ marginTop: -8 }}>
            <button
              type="button"
              className={`task-edit-pill ${allDay ? 'active' : ''}`}
              style={allDay ? { background: 'var(--primary)', color: '#fff' } : undefined}
              onClick={() => {
                setAllDay((v) => {
                  const next = !v;
                  if (next) {
                    setTime('');
                    setTimeEnd('');
                    setShowTimeEnd(false);
                  }
                  return next;
                });
              }}
            >
              Ganztägig
            </button>
          </div>

          {/* Priority */}
          <div className="task-edit-field">
            <label><Flag size={14} /> Priorität</label>
            <div className="task-edit-priority-pills">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  className={`task-edit-pill ${priority === p.value ? 'active' : ''}`}
                  style={priority === p.value ? { background: p.color, color: '#fff' } : {}}
                  onClick={() => setPriority(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Category */}
          <div className="task-edit-field">
            <label><Tag size={14} /> Persönliche Kategorie</label>
            <div className="cat-pill-picker">
              <button
                type="button"
                className={`cat-pill${!categoryId ? ' active' : ''}`}
                onClick={() => setCategoryId('')}
              >
                <span className="cat-pill-dot" style={{ background: 'var(--text-tertiary)' }} />
                Keine
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`cat-pill${String(categoryId) === String(cat.id) ? ' active' : ''}`}
                  style={String(categoryId) === String(cat.id) ? { background: `${cat.color || '#007AFF'}22`, borderColor: cat.color || '#007AFF', color: cat.color || '#007AFF' } : {}}
                  onClick={() => setCategoryId(String(cat.id))}
                >
                  <span className="cat-pill-dot" style={{ background: cat.color || '#007AFF' }} />
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* Reminder */}
          <div className="task-edit-field">
            <label><Bell size={14} /> Erinnerung</label>
            <input
              type="datetime-local"
              value={reminderAt}
              onChange={(e) => setReminderAt(e.target.value)}
              className="task-edit-input"
            />
          </div>

          {/* Recurrence */}
          <div className="task-edit-field">
            <label><Repeat size={14} /> Wiederholung</label>
            <select
              value={recurrenceRule}
              onChange={(e) => setRecurrenceRule(e.target.value)}
              className="task-edit-input task-edit-select"
            >
              {RECURRENCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {recurrenceRule && (
              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Wiederholen bis (optional)</label>
                <input
                  type="date"
                  value={recurrenceEnd}
                  onChange={(e) => setRecurrenceEnd(e.target.value)}
                  className="task-edit-input"
                  style={{ marginTop: 4 }}
                />
              </div>
            )}
          </div>

          {/* Attachments */}
          <TaskAttachments taskId={task.id} canEdit={true} />

          {/* Group Assignment */}
          {userGroups.length > 0 && (
            <div className="task-edit-sharing">
              <button
                className="task-edit-sharing-toggle"
                onClick={() => setShowGroups(!showGroups)}
              >
                <div className="task-edit-sharing-toggle-left">
                  <UsersRound size={16} />
                  <span>Gruppe zuweisen</span>
                  {taskGroupId && (
                    <span className="task-edit-sharing-count">1</span>
                  )}
                </div>
                <ChevronDown size={16} className={`task-edit-chevron ${showGroups ? 'open' : ''}`} />
              </button>

              {task.recurrence_rule && showGroups && (
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '6px 2px 0', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Repeat size={12} />
                  Alle Termine dieser Serie werden der Gruppe hinzugefügt.
                </div>
              )}

              <AnimatePresence>
                {showGroups && (
                  <motion.div
                    className="task-edit-sharing-content"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0' }}>
                      {/* None option */}
                      <div
                        className={`task-edit-shared-item addable ${!taskGroupId ? 'selected' : ''}`}
                        onClick={() => setTaskGroupId(null)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
                          <X size={14} />
                        </div>
                        <span className="task-edit-friend-name">Keine Gruppe</span>
                        {!taskGroupId && <span style={{ marginLeft: 'auto', color: 'var(--primary)', fontSize: 12, fontWeight: 600 }}>✓</span>}
                      </div>
                      {/* Groups */}
                      {userGroups.map((g) => (
                        <div
                          key={g.id}
                          className={`task-edit-shared-item addable ${taskGroupId === g.id ? 'selected' : ''}`}
                          onClick={() => {
                            setTaskGroupId(g.id);
                            setTaskGroupCategoryId('');
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <AvatarBadge
                            name={g.name}
                            color={g.color || '#007AFF'}
                            avatarUrl={g.image_url}
                            size={32}
                          />
                          <span className="task-edit-friend-name">{g.name}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{g.member_count} Mitglieder</span>
                          {taskGroupId === g.id && <span style={{ marginLeft: 'auto', color: 'var(--primary)', fontSize: 12, fontWeight: 600 }}>✓</span>}
                        </div>
                      ))}

                      {taskGroupId && (
                        <div className="task-edit-field" style={{ marginBottom: 0 }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                            <ThumbsUp size={14} style={{ color: '#1f8a47' }} />
                            <span style={{ flex: 1 }}>Abstimmung (Zu-/Absage) aktivieren</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={enableGroupRsvp}
                              className={`manual-task-allday-btn${enableGroupRsvp ? ' on' : ''}`}
                              onClick={() => setEnableGroupRsvp((v) => !v)}
                            />
                          </label>
                        </div>
                      )}

                      {taskGroupId && (
                        <div className="task-edit-field" style={{ marginTop: 8, marginBottom: 0 }}>
                          <label><Tag size={14} /> Gruppenkategorie</label>
                          <div className="cat-pill-picker">
                            <button
                              type="button"
                              className={`cat-pill${!taskGroupCategoryId ? ' active' : ''}`}
                              onClick={() => setTaskGroupCategoryId('')}
                            >
                              <span className="cat-pill-dot" style={{ background: 'var(--text-tertiary)' }} />
                              Keine
                            </button>
                            {groupCategories.map((cat) => (
                              <button
                                key={cat.id}
                                type="button"
                                className={`cat-pill${String(taskGroupCategoryId) === String(cat.id) ? ' active' : ''}`}
                                style={String(taskGroupCategoryId) === String(cat.id) ? { background: `${cat.color || '#8E8E93'}22`, borderColor: cat.color || '#8E8E93', color: cat.color || '#8E8E93' } : {}}
                                onClick={() => setTaskGroupCategoryId(String(cat.id))}
                              >
                                <span className="cat-pill-dot" style={{ background: cat.color || '#8E8E93' }} />
                                {cat.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Sharing Section */}
          <div className="task-edit-sharing">
            <button
              className="task-edit-sharing-toggle"
              onClick={() => setShowSharing(!showSharing)}
            >
              <div className="task-edit-sharing-toggle-left">
                <Users size={16} />
                <span>Teilen & Freunde</span>
                {permissions.length > 0 && (
                  <span className="task-edit-sharing-count">{permissions.length}</span>
                )}
              </div>
              <ChevronDown size={16} className={`task-edit-chevron ${showSharing ? 'open' : ''}`} />
            </button>

            {task.recurrence_rule && showSharing && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '6px 2px 0', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Repeat size={12} />
                Freigabe gilt für alle Termine dieser Serie.
              </div>
            )}

            <AnimatePresence>
              {showSharing && (
                <motion.div
                  className="task-edit-sharing-content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                >
                  {/* Visibility Pills */}
                  <div className="task-edit-visibility-pills">
                    {VISIBILITY_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const isActive = visibility === opt.value;
                      return (
                        <button
                          key={opt.value}
                          className={`task-edit-pill ${isActive ? 'active' : ''}`}
                          style={isActive ? { background: opt.color, color: '#fff' } : {}}
                          onClick={() => {
                            setVisibility(opt.value);
                            if (opt.value !== 'selected_users') setPermissions([]);
                          }}
                        >
                          <Icon size={14} /> {opt.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Selected Users */}
                  {visibility === 'selected_users' && (
                    <div className="task-edit-friends-section">
                      {/* Currently shared with */}
                      {permissions.length > 0 && (
                        <div className="task-edit-shared-list">
                          <div className="task-edit-shared-label">Geteilt mit:</div>
                          <div className="task-edit-shared-avatars" role="list" aria-label="Ausgewählte Personen">
                            {permissions.map((p, idx) => (
                              <div
                                key={p.user_id}
                                role="listitem"
                                className="task-edit-shared-avatar-chip"
                                style={{ zIndex: permissions.length - idx }}
                              >
                                <button
                                  type="button"
                                  className="task-edit-shared-avatar-btn"
                                  onClick={() => toggleFriendPermission(p.user_id, p.name, p.avatar_color, p.avatar_url, 'toggle_edit')}
                                  title={`${p.name} • ${p.can_edit ? 'Kann bearbeiten' : 'Nur lesen'}`}
                                  aria-label={`${p.name} Berechtigung umschalten`}
                                >
                                  <AvatarBadge
                                    name={p.name}
                                    color={p.avatar_color || '#007AFF'}
                                    avatarUrl={p.avatar_url}
                                    size={36}
                                  />
                                  <span className={`task-edit-shared-avatar-perm ${p.can_edit ? 'edit' : 'read'}`}>
                                    {p.can_edit ? <Edit3 size={10} /> : <Eye size={10} />}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="task-edit-shared-avatar-remove"
                                  onClick={() => toggleFriendPermission(p.user_id, null, null, null, 'remove')}
                                  title={`${p.name} entfernen`}
                                  aria-label={`${p.name} entfernen`}
                                >
                                  <X size={10} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Add friends */}
                      {friends.length > 0 && (
                        <div className="task-edit-add-friends">
                          <div className="task-edit-shared-label">Freund hinzufügen:</div>
                          <div className="task-edit-add-friends-avatars" role="list" aria-label="Freunde hinzufügen">
                            {friends
                              .filter(f => !permissions.find(p => p.user_id === f.friend_user_id))
                              .map((friend) => (
                                <div key={friend.friend_user_id} role="listitem" className="task-edit-shared-avatar-chip task-edit-shared-avatar-chip--add">
                                  <button
                                    type="button"
                                    className="task-edit-shared-avatar-btn"
                                    onClick={() => toggleFriendPermission(
                                      friend.friend_user_id,
                                      friend.name,
                                      friend.avatar_color,
                                      friend.avatar_url,
                                      'add'
                                    )}
                                    title={`${friend.name} hinzufügen`}
                                    aria-label={`${friend.name} hinzufügen`}
                                  >
                                    <AvatarBadge
                                      name={friend.name}
                                      color={friend.avatar_color || '#007AFF'}
                                      avatarUrl={friend.avatar_url}
                                      size={36}
                                    />
                                    <span className="task-edit-shared-avatar-add">+</span>
                                  </button>
                                </div>
                              ))}
                          </div>
                          {friends.filter(f => !permissions.find(p => p.user_id === f.friend_user_id)).length === 0 && (
                            <div className="task-edit-all-added">Alle Freunde hinzugefügt</div>
                          )}
                        </div>
                      )}

                      {friends.length === 0 && (
                        <div className="task-edit-no-friends">
                          Noch keine Freunde. Füge Freunde über die Freundesliste hinzu.
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <div className="task-edit-footer">
          {/* Teams Meeting (events only) */}
          {taskType === 'event' && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              {hasTeamsMeeting ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#5558a8' }}>
                  <Video size={14} /> Teams-Meeting vorhanden
                </span>
              ) : (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: teamsConnected === false ? 'default' : 'pointer', userSelect: 'none' }}>
                  <Video size={14} style={{ color: '#5558a8' }} />
                  <span style={{ color: teamsConnected === false ? 'var(--text-secondary)' : 'inherit' }}>
                    {teamsConnected === false ? 'Teams verbinden' : 'Teams-Meeting'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={addTeamsMeeting}
                    disabled={teamsConnected === false}
                    className={`manual-task-allday-btn${addTeamsMeeting ? ' on' : ''}`}
                    style={{ ...(teamsConnected === false ? { opacity: 0.4 } : {}), flexShrink: 0 }}
                    onClick={() => teamsConnected !== false && setAddTeamsMeeting((v) => !v)}
                  />
                </label>
              )}
            </div>
          )}
          <button className="task-edit-cancel" onClick={onClose}>
            Abbrechen
          </button>
          <motion.button
            className="task-edit-save"
            onClick={handleSave}
            disabled={saving || !title.trim()}
            whileTap={{ scale: 0.97 }}
          >
            {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            {saving ? 'Speichern...' : 'Speichern'}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
