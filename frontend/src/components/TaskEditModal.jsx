import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTaskStore } from '../store/taskStore';
import { useFriendsStore } from '../store/friendsStore';
import { api } from '../utils/api';
import {
  X, Calendar, Clock, Tag, Flag, FileText, Bell,
  Save, Users, UserCheck, Lock, Eye, Edit3,
  ChevronDown, Sparkles, Loader2, AlertTriangle
} from 'lucide-react';
import { format, parseISO } from 'date-fns';

const PRIORITIES = [
  { value: 'low', label: 'Niedrig', color: 'var(--success)' },
  { value: 'medium', label: 'Mittel', color: 'var(--primary)' },
  { value: 'high', label: 'Hoch', color: 'var(--warning)' },
  { value: 'urgent', label: 'Dringend', color: 'var(--danger)' },
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

  // Sharing state
  const [visibility, setVisibility] = useState(task.visibility || 'private');
  const [permissions, setPermissions] = useState([]);
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [showSharing, setShowSharing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [showDateEnd, setShowDateEnd] = useState(!!task.date_end);
  const [showTimeEnd, setShowTimeEnd] = useState(!!task.time_end);

  useEffect(() => {
    if (categories.length === 0) fetchCategories();
    fetchFriends();
    loadPermissions();
  }, []);

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
        }))
      );
    } catch {
      // Permissions table might not exist yet
    } finally {
      setLoadingPerms(false);
    }
  };

  const toggleFriendPermission = (friendUserId, friendName, friendColor, action) => {
    setPermissions(prev => {
      const existing = prev.find(p => p.user_id === friendUserId);
      if (action === 'remove') {
        return prev.filter(p => p.user_id !== friendUserId);
      }
      if (action === 'add') {
        if (existing) return prev;
        return [...prev, { user_id: friendUserId, can_view: true, can_edit: false, name: friendName, avatar_color: friendColor }];
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
        title: title.trim(),
        description: description.trim(),
        date: date || null,
        date_end: dateEnd || null,
        time: time || null,
        time_end: timeEnd || null,
        priority,
        category_id: categoryId || null,
        reminder_at: reminderAt || null,
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
      className="modal-overlay"
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
                                style={{ background: p.avatar_color || '#007AFF' }}
                              >
                                {p.name?.[0]?.toUpperCase() || '?'}
                              </div>
                              <span className="task-edit-friend-name">{p.name}</span>
                              <div className="task-edit-friend-controls">
                                <button
                                  className={`task-edit-perm-btn ${p.can_edit ? 'active' : ''}`}
                                  onClick={() => toggleFriendPermission(p.user_id, p.name, p.avatar_color, 'toggle_edit')}
                                  title={p.can_edit ? 'Kann bearbeiten' : 'Nur lesen'}
                                >
                                  {p.can_edit ? <Edit3 size={12} /> : <Eye size={12} />}
                                  {p.can_edit ? 'Bearbeiten' : 'Lesen'}
                                </button>
                                <button
                                  className="task-edit-perm-btn remove"
                                  onClick={() => toggleFriendPermission(p.user_id, null, null, 'remove')}
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
                                <div
                                  className="task-edit-friend-avatar"
                                  style={{ background: friend.avatar_color || '#007AFF' }}
                                >
                                  {friend.name?.[0]?.toUpperCase() || '?'}
                                </div>
                                <span className="task-edit-friend-name">{friend.name}</span>
                                <button
                                  className="task-edit-perm-btn add"
                                  onClick={() => toggleFriendPermission(
                                    friend.friend_user_id,
                                    friend.name,
                                    friend.avatar_color,
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
