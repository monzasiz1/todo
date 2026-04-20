import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTaskStore } from '../store/taskStore';
import { useFriendsStore } from '../store/friendsStore';
import { api } from '../utils/api';
import {
  X, Calendar, CalendarCheck, Clock, Tag, Flag, FileText, Bell,
  Save, Users, UserCheck, Lock, Eye, Edit3,
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

export default function TaskEditModal({ task, onClose, onSaved }) {
  const { updateTask, categories, fetchCategories, addToast } = useTaskStore();
  const { friends, fetchFriends } = useFriendsStore();

  // Form state
  const [taskType, setTaskType] = useState(task.type || 'task');
  const [title, setTitle] = useState(task.title || '');
  const [description, setDescription] = useState(task.description || '');
  const [date, setDate] = useState(task.date ? task.date.substring(0, 10) : '');
  const [dateEnd, setDateEnd] = useState(task.date_end ? task.date_end.substring(0, 10) : '');
  const [time, setTime] = useState(task.time ? task.time.substring(0, 5) : '');
  const [timeEnd, setTimeEnd] = useState(task.time_end ? task.time_end.substring(0, 5) : '');
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
  const [showGroups, setShowGroups] = useState(!!task.group_id);

  const [saving, setSaving] = useState(false);
  const [showDateEnd, setShowDateEnd] = useState(!!task.date_end);
  const [showTimeEnd, setShowTimeEnd] = useState(!!task.time_end);

  useEffect(() => {
    if (categories.length === 0) fetchCategories();
    fetchFriends();
    loadPermissions();
    loadUserGroups();
  }, []);

  const loadUserGroups = async () => {
    try {
      const data = await api.getGroups();
      setUserGroups(data.groups || []);
    } catch {
      // Groups might not exist yet
    }
  };

  const loadPermissions = async () => {
    if (!task.id) return;
    try {
      setLoadingPerms(true);
      const data = await api.getPermissions(task.id);
      setVisibility(data.visibility || 'private');
      setPermissions(
        (data.permissions || []).map(p => ({
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
      setLoadingPerms(false);
    }
  };

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
      // 1. Update task fields
      const updates = {
        type: taskType,
        title: title.trim(),
        description: description.trim(),
        date: date || null,
        date_end: dateEnd || null,
        time: time || null,
        time_end: timeEnd || null,
        priority,
        category_id: categoryId || null,
        reminder_at: localToISO(reminderAt),
        recurrence_rule: recurrenceRule || null,
        recurrence_interval: 1,
        recurrence_end: recurrenceEnd || null,
      };
      const updatedTask = await updateTask(task.id, updates);

      // 2. Update sharing/permissions (if collab tables exist)
      try {
        await api.setPermissions(task.id, {
          visibility,
          permissions: visibility === 'selected_users'
            ? permissions.map(p => ({ user_id: p.user_id, can_view: p.can_view, can_edit: p.can_edit }))
            : [],
        });
      } catch {
        // Ignore if collaboration tables don't exist
      }

      // 3. Update group assignment
      try {
        const oldGroupId = task.group_id || null;
        const newGroupId = taskGroupId || null;
        if (oldGroupId !== newGroupId) {
          // Remove from old group
          if (oldGroupId) {
            await api.removeGroupTask(oldGroupId, task.id);
          }
          // Add to new group
          if (newGroupId) {
            await api.addGroupTask(newGroupId, { existing_task_id: task.id });
          }
        }
      } catch {
        // Ignore if group tables don't exist
      }

      addToast('✅ Änderungen gespeichert');
      onSaved?.(updatedTask);
      onClose();
    } catch (err) {
      addToast('❌ ' + (err.message || 'Speichern fehlgeschlagen'), 'error');
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
        className="task-edit-modal"
        initial={{ opacity: 0, y: 60, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.95 }}
        transition={{ type: 'spring', damping: 28, stiffness: 350 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="task-edit-header">
          <h2>Aufgabe bearbeiten</h2>
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
          <div className="task-edit-field">
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
              />
            </div>
            {showTimeEnd ? (
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
            ) : (
              <button className="task-edit-add-btn" onClick={() => setShowTimeEnd(true)}>
                + Endzeit
              </button>
            )}
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
            <label><Tag size={14} /> Kategorie</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="task-edit-input task-edit-select"
            >
              <option value="">Keine Kategorie</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
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
                          onClick={() => setTaskGroupId(g.id)}
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
                          {permissions.map((p) => (
                            <div key={p.user_id} className="task-edit-shared-item">
                              <div
                                className="task-edit-friend-avatar"
                              >
                                <AvatarBadge
                                  name={p.name}
                                  color={p.avatar_color || '#007AFF'}
                                  avatarUrl={p.avatar_url}
                                  size={28}
                                />
                              </div>
                              <span className="task-edit-friend-name">{p.name}</span>
                              <div className="task-edit-friend-controls">
                                <button
                                  className={`task-edit-perm-btn ${p.can_edit ? 'active' : ''}`}
                                  onClick={() => toggleFriendPermission(p.user_id, p.name, p.avatar_color, p.avatar_url, 'toggle_edit')}
                                  title={p.can_edit ? 'Kann bearbeiten' : 'Nur lesen'}
                                >
                                  {p.can_edit ? <Edit3 size={12} /> : <Eye size={12} />}
                                  {p.can_edit ? 'Bearbeiten' : 'Lesen'}
                                </button>
                                <button
                                  className="task-edit-perm-btn remove"
                                  onClick={() => toggleFriendPermission(p.user_id, null, null, null, 'remove')}
                                  title="Entfernen"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add friends */}
                      {friends.length > 0 && (
                        <div className="task-edit-add-friends">
                          <div className="task-edit-shared-label">Freund hinzufügen:</div>
                          {friends
                            .filter(f => !permissions.find(p => p.user_id === f.friend_user_id))
                            .map((friend) => (
                              <div key={friend.friend_user_id} className="task-edit-shared-item addable">
                                <div className="task-edit-friend-avatar">
                                  <AvatarBadge
                                    name={friend.name}
                                    color={friend.avatar_color || '#007AFF'}
                                    avatarUrl={friend.avatar_url}
                                    size={28}
                                  />
                                </div>
                                <span className="task-edit-friend-name">{friend.name}</span>
                                <button
                                  className="task-edit-perm-btn add"
                                  onClick={() => toggleFriendPermission(
                                    friend.friend_user_id,
                                    friend.name,
                                    friend.avatar_color,
                                    friend.avatar_url,
                                    'add'
                                  )}
                                >
                                  + Hinzufügen
                                </button>
                              </div>
                            ))}
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
