import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Calendar, CalendarCheck, ChevronDown, Clock, Edit3, Eye, FileText, Flag, ListTodo, Lock, Plus, Repeat, Save, Tag, UserCheck, Users, UsersRound, Video, X } from 'lucide-react';
import { useTaskStore } from '../store/taskStore';
import { api } from '../utils/api';
import AvatarBadge from './AvatarBadge';
import { useFriendsStore } from '../store/friendsStore';
import { getWorkspaceLabel, useWorkspaceStore } from '../store/workspaceStore';

const PRIORITIES = [
  { value: 'low', label: 'Niedrig', color: 'var(--success)' },
  { value: 'medium', label: 'Mittel', color: 'var(--primary)' },
  { value: 'high', label: 'Hoch', color: 'var(--warning)' },
  { value: 'urgent', label: 'Dringend', color: 'var(--danger)' },
];

const RECURRENCE_OPTIONS = [
  { value: '', label: 'Keine Wiederholung' },
  { value: 'daily', label: 'Täglich' },
  { value: 'weekdays', label: 'Werktags (Mo-Fr)' },
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

function toDateValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.substring(0, 10);
  return value.toISOString().split('T')[0];
}

// Wandelt datetime-local Wert in ISO mit Timezone-Offset um
function localToISO(dtLocal) {
  if (!dtLocal) return null;
  const d = new Date(dtLocal);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function ManualTaskForm({ onTaskCreated, defaultDate = null, embedded = false, onCancel }) {
  const { createTask, categories, fetchCategories } = useTaskStore();
  const { friends, fetchFriends } = useFriendsStore();
  const { activeWorkspace } = useWorkspaceStore();
  const [isOpen, setIsOpen] = useState(embedded);
  const [taskType, setTaskType] = useState('task');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(toDateValue(defaultDate));
  const [dateEnd, setDateEnd] = useState('');
  const [time, setTime] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [priority, setPriority] = useState('medium');
  const [categoryId, setCategoryId] = useState('');
  const [reminderAt, setReminderAt] = useState('');
  const [recurrenceRule, setRecurrenceRule] = useState('');
  const [recurrenceEnd, setRecurrenceEnd] = useState('');
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [permissions, setPermissions] = useState([]);
  const [showSharing, setShowSharing] = useState(false);
  const [addTeamsMeeting, setAddTeamsMeeting] = useState(false);
  const [teamsConnected, setTeamsConnected] = useState(null); // null=unknown, true/false
  const [saving, setSaving] = useState(false);
  const isPrivateWorkspace = activeWorkspace.scope === 'private';

  useEffect(() => {
    if (categories.length === 0) fetchCategories();
    loadGroups();
    fetchFriends();
    api.getTeamsStatus().then((d) => setTeamsConnected(d.connected)).catch(() => setTeamsConnected(false));
  }, []);

  const loadGroups = async () => {
    try {
      const data = await api.getGroups();
      setGroups(data.groups || []);
    } catch {
      setGroups([]);
    }
  };

  useEffect(() => {
    if (!defaultDate) return;
    setDate((current) => current || toDateValue(defaultDate));
  }, [defaultDate]);

  useEffect(() => {
    setGroupId('');
    if (!isPrivateWorkspace) {
      setVisibility('private');
      setPermissions([]);
      setShowSharing(false);
    }
  }, [activeWorkspace.scope, activeWorkspace.id, isPrivateWorkspace]);

  const resetForm = () => {
    setTaskType('task');
    setTitle('');
    setDescription('');
    setDate(toDateValue(defaultDate));
    setDateEnd('');
    setTime('');
    setTimeEnd('');
    setAllDay(false);
    setPriority('medium');
    setCategoryId('');
    setReminderAt('');
    setRecurrenceRule('');
    setRecurrenceEnd('');
    setGroupId('');
    setVisibility('private');
    setPermissions([]);
    setShowSharing(false);
    setAddTeamsMeeting(false);
  };

  const toggleFriendPermission = (friendUserId, friendName, friendColor, friendAvatarUrl, action) => {
    setPermissions((prev) => {
      const existing = prev.find((permission) => permission.user_id === friendUserId);
      if (action === 'remove') {
        return prev.filter((permission) => permission.user_id !== friendUserId);
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
        return prev.map((permission) => (
          permission.user_id === friendUserId
            ? { ...permission, can_edit: !permission.can_edit }
            : permission
        ));
      }
      return prev;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || saving) return;

    setSaving(true);
    try {
      const result = await createTask({
        type: taskType,
        title: title.trim(),
        description: description.trim() || null,
        date: date || null,
        date_end: dateEnd || null,
        time: allDay ? null : (time || null),
        time_end: allDay ? null : (timeEnd || null),
        priority,
        category_id: categoryId || null,
        reminder_at: localToISO(reminderAt),
        recurrence_rule: recurrenceRule || null,
        recurrence_interval: recurrenceRule ? 1 : null,
        recurrence_end: recurrenceEnd || null,
        group_id: isPrivateWorkspace ? (groupId || null) : null,
        visibility,
        permissions: visibility === 'selected_users'
          ? permissions.map((permission) => ({
              user_id: permission.user_id,
              can_view: permission.can_view,
              can_edit: permission.can_edit,
            }))
          : [],
      });

      if (result) {
        let createdTask = Array.isArray(result?.created_tasks) && result.created_tasks.length > 0
          ? result.created_tasks[0]
          : (result?.task || result);

        if (visibility === 'selected_users') {
          createdTask = {
            ...createdTask,
            shared_with_users: permissions.map((permission) => ({
              name: permission.name,
              color: permission.avatar_color,
              avatar_url: permission.avatar_url,
            })),
          };
        }

        // Attach Teams meeting if requested (event only)
        if (addTeamsMeeting && taskType === 'event' && createdTask?.id) {
          try {
            const teamsResult = await api.createTeamsMeeting({
              task_id: createdTask.id,
              title: title.trim(),
              date: date || null,
              time: allDay ? null : (time || null),
              time_end: allDay ? null : (timeEnd || null),
            });

            createdTask = {
              ...createdTask,
              teams_join_url: teamsResult?.join_url || createdTask?.teams_join_url || null,
              teams_meeting_id: teamsResult?.meeting_id || createdTask?.teams_meeting_id || null,
            };
          } catch {
            // Meeting creation failure should not block task creation
          }
        }
        resetForm();
        setIsOpen(false);
        onTaskCreated?.(createdTask);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`manual-task-attachment ${embedded ? 'embedded' : ''}`}>
      {!embedded && (
        <button
          type="button"
          className={`manual-task-launcher ${isOpen ? 'open' : ''}`}
          onClick={() => setIsOpen((current) => !current)}
        >
          <span className="manual-task-launcher-left">
            <div className="manual-task-launcher-icon">
              <Plus size={16} />
            </div>
            <div className="manual-task-launcher-copy">
              <strong>Manuell erstellen</strong>
              <span>Aufgabe oder Termin ohne KI anlegen</span>
            </div>
          </span>
          <ChevronDown size={18} className={`manual-task-launcher-chevron ${isOpen ? 'open' : ''}`} />
        </button>
      )}

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.form
            onSubmit={handleSubmit}
            initial={embedded ? false : { opacity: 0, height: 0, y: -12 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={embedded ? { opacity: 0 } : { opacity: 0, height: 0, y: -12 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            style={embedded ? {} : { overflow: 'hidden', transformOrigin: 'top' }}
            className="manual-task-form-panel"
          >
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Manuell erstellen</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Aktiv fuer {getWorkspaceLabel(activeWorkspace)}. Quelle und Scope werden automatisch gesetzt.
              </div>
            </div>

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

            <div className="task-edit-field" style={{ marginBottom: 0 }}>
              <label><FileText size={14} /> Titel</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="z.B. Probe, Zahnarzt, Rechnung bezahlen"
                className="task-edit-input"
                autoFocus
              />
            </div>

            <div className="task-edit-field" style={{ marginBottom: 0 }}>
              <label><FileText size={14} /> Beschreibung</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional: Details oder Notizen"
                className="task-edit-input task-edit-textarea"
                rows={3}
              />
            </div>

            <div className="task-edit-row manual-task-two-col">
              <div className="task-edit-field flex-1" style={{ marginBottom: 0 }}>
                <label><Calendar size={14} /> Datum</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="task-edit-input" />
              </div>
              <div className="task-edit-field flex-1" style={{ marginBottom: 0 }}>
                <label><Calendar size={14} /> Enddatum</label>
                <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="task-edit-input" />
              </div>
            </div>

            <div className="task-edit-row manual-task-two-col">
              <div className="task-edit-field flex-1" style={{ marginBottom: 0 }}>
                <label><Clock size={14} /> Uhrzeit</label>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="task-edit-input" disabled={allDay} style={allDay ? { opacity: 0.35 } : {}} />
              </div>
              <div className="task-edit-field flex-1" style={{ marginBottom: 0 }}>
                <label><Clock size={14} /> Endzeit</label>
                <input type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} className="task-edit-input" disabled={allDay} style={allDay ? { opacity: 0.35 } : {}} />
              </div>
            </div>

            {/* Ganztägig toggle */}
            <label className="manual-task-allday-toggle">
              <span>Ganztägig</span>
              <button
                type="button"
                role="switch"
                aria-checked={allDay}
                className={`manual-task-allday-btn${allDay ? ' on' : ''}`}
                onClick={() => { setAllDay(v => !v); if (!allDay) { setTime(''); setTimeEnd(''); } }}
              />
            </label>

            <div className="task-edit-field" style={{ marginBottom: 0 }}>
              <label><Flag size={14} /> Priorität</label>
              <div className="task-edit-priority-pills">
                {PRIORITIES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={`task-edit-pill ${priority === item.value ? 'active' : ''}`}
                    style={priority === item.value ? { background: item.color, color: '#fff' } : {}}
                    onClick={() => setPriority(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="task-edit-field" style={{ marginBottom: 0 }}>
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

            <div className="task-edit-field" style={{ marginBottom: 0 }}>
              <label><Bell size={14} /> Erinnerung</label>
              <input
                type="datetime-local"
                value={reminderAt}
                onChange={(e) => setReminderAt(e.target.value)}
                className="task-edit-input"
              />
            </div>

            <div className="task-edit-row manual-task-two-col">
              <div className="task-edit-field flex-1" style={{ marginBottom: 0 }}>
                <label><Repeat size={14} /> Wiederholung</label>
                <select
                  value={recurrenceRule}
                  onChange={(e) => setRecurrenceRule(e.target.value)}
                  className="task-edit-input task-edit-select"
                >
                  {RECURRENCE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="task-edit-field flex-1" style={{ marginBottom: 0 }}>
                <label><Calendar size={14} /> Wiederholen bis</label>
                <input
                  type="date"
                  value={recurrenceEnd}
                  onChange={(e) => setRecurrenceEnd(e.target.value)}
                  className="task-edit-input"
                  disabled={!recurrenceRule}
                />
              </div>
            </div>
            {recurrenceRule && !recurrenceEnd && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: -4, paddingLeft: 2 }}>
                Ohne Enddatum werden Termine für 5 Jahre erstellt.
              </div>
            )}

            {isPrivateWorkspace && <div className="task-edit-field" style={{ marginBottom: 0 }}>
              <label><UsersRound size={14} /> Gruppe</label>
              <div className="manual-task-stack">
                <div
                  className={`task-edit-shared-item addable ${!groupId ? 'selected' : ''}`}
                  onClick={() => setGroupId('')}
                  style={{ cursor: 'pointer' }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
                    <Plus size={14} style={{ transform: 'rotate(45deg)' }} />
                  </div>
                  <span className="task-edit-friend-name">Keine Gruppe</span>
                </div>
                {groups.map((group) => (
                  <div
                    key={group.id}
                    className={`task-edit-shared-item addable ${String(groupId) === String(group.id) ? 'selected' : ''}`}
                    onClick={() => setGroupId(String(group.id))}
                    style={{ cursor: 'pointer' }}
                  >
                    <AvatarBadge
                      name={group.name}
                      color={group.color || '#007AFF'}
                      avatarUrl={group.image_url}
                      size={32}
                    />
                    <span className="task-edit-friend-name">{group.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{group.member_count} Mitglieder</span>
                  </div>
                ))}
                {groups.length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Keine Gruppen vorhanden.</div>
                )}
              </div>
            </div>}

            {isPrivateWorkspace && <div className="task-edit-sharing" style={{ marginTop: 2 }}>
              <button
                type="button"
                className="task-edit-sharing-toggle"
                onClick={() => setShowSharing(!showSharing)}
              >
                <div className="task-edit-sharing-toggle-left">
                  <Users size={16} />
                  <span>Teilen & Berechtigungen</span>
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
                    <div className="task-edit-visibility-pills">
                      {VISIBILITY_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const isActive = visibility === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={`task-edit-pill ${isActive ? 'active' : ''}`}
                            style={isActive ? { background: option.color, color: '#fff' } : {}}
                            onClick={() => {
                              setVisibility(option.value);
                              if (option.value !== 'selected_users') setPermissions([]);
                            }}
                          >
                            <Icon size={14} /> {option.label}
                          </button>
                        );
                      })}
                    </div>

                    {visibility === 'selected_users' && (
                      <div className="task-edit-friends-section">
                        {permissions.length > 0 && (
                          <div className="task-edit-shared-list">
                            <div className="task-edit-shared-label">Geteilt mit:</div>
                            {permissions.map((permission) => (
                              <div key={permission.user_id} className="task-edit-shared-item">
                                <div className="task-edit-friend-avatar">
                                  <AvatarBadge
                                    name={permission.name}
                                    color={permission.avatar_color || '#007AFF'}
                                    avatarUrl={permission.avatar_url}
                                    size={28}
                                  />
                                </div>
                                <span className="task-edit-friend-name">{permission.name}</span>
                                <div className="task-edit-friend-controls">
                                  <button
                                    type="button"
                                    className={`task-edit-perm-btn ${permission.can_edit ? 'active' : ''}`}
                                    onClick={() => toggleFriendPermission(permission.user_id, permission.name, permission.avatar_color, permission.avatar_url, 'toggle_edit')}
                                  >
                                    {permission.can_edit ? <Edit3 size={12} /> : <Eye size={12} />}
                                    {permission.can_edit ? 'Bearbeiten' : 'Lesen'}
                                  </button>
                                  <button
                                    type="button"
                                    className="task-edit-perm-btn remove"
                                    onClick={() => toggleFriendPermission(permission.user_id, null, null, null, 'remove')}
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {friends.length > 0 && (
                          <div className="task-edit-add-friends">
                            <div className="task-edit-shared-label">Freund hinzufügen:</div>
                            {friends
                              .filter((friend) => !permissions.find((permission) => permission.user_id === friend.friend_user_id))
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
                                    type="button"
                                    className="task-edit-perm-btn add"
                                    onClick={() => toggleFriendPermission(friend.friend_user_id, friend.name, friend.avatar_color, friend.avatar_url, 'add')}
                                  >
                                    + Hinzufügen
                                  </button>
                                </div>
                              ))}
                          </div>
                        )}

                        {friends.length === 0 && (
                          <div className="task-edit-no-friends">
                            Noch keine Freunde. Füge zuerst Freunde hinzu, um einzelne Personen auszuwählen.
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>}

            {/* Teams Meeting Toggle (events only) */}
            {taskType === 'event' && (
              <div className="task-edit-field" style={{ marginBottom: 0 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                  <Video size={14} style={{ color: '#5558a8' }} />
                  <span style={{ flex: 1 }}>Teams-Meeting erstellen</span>
                  {teamsConnected === false && (
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Profil → Microsoft verbinden</span>
                  )}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={addTeamsMeeting}
                    disabled={teamsConnected === false}
                    className={`manual-task-allday-btn${addTeamsMeeting ? ' on' : ''}`}
                    style={teamsConnected === false ? { opacity: 0.4 } : {}}
                    onClick={() => teamsConnected !== false && setAddTeamsMeeting((v) => !v)}
                  />
                </label>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="task-edit-cancel"
                onClick={() => {
                  resetForm();
                  if (embedded) {
                    onCancel?.();
                  } else {
                    setIsOpen(false);
                  }
                }}
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="task-edit-save"
                disabled={!title.trim() || saving}
              >
                <Save size={16} />
                {saving ? 'Erstellen...' : 'Erstellen'}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
