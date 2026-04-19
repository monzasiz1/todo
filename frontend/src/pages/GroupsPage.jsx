import { useState, useEffect } from 'react';
import { useGroupStore } from '../store/groupStore';
import { useAuthStore } from '../store/authStore';
import { useTaskStore } from '../store/taskStore';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Plus, Hash, Copy, Check, ChevronRight, Crown,
  Shield, UserMinus, Settings, Trash2, LogOut, X,
  Calendar, Clock, Flag, Search, ArrowLeft
} from 'lucide-react';
import AvatarBadge from '../components/AvatarBadge';

const GROUP_COLORS = [
  '#007AFF', '#5856D6', '#34C759', '#FF9500', '#FF3B30',
  '#AF52DE', '#FF2D55', '#00C7BE', '#5AC8FA', '#FFCC00',
];

const ROLE_CONFIG = {
  owner: { label: 'Ersteller', icon: Crown, color: '#FFD700' },
  admin: { label: 'Admin', icon: Shield, color: '#007AFF' },
  member: { label: 'Mitglied', icon: Users, color: '#8E8E93' },
};

export default function GroupsPage() {
  const { groups, fetchGroups, createGroup, joinGroup, loading } = useGroupStore();
  const [view, setView] = useState('list'); // 'list' | 'create' | 'join' | 'detail'
  const [selectedGroupId, setSelectedGroupId] = useState(null);

  useEffect(() => { fetchGroups(); }, []);

  const openGroup = (id) => {
    setSelectedGroupId(id);
    setView('detail');
  };

  return (
    <div>
      <AnimatePresence mode="wait">
        {view === 'list' && (
          <GroupList
            key="list"
            groups={groups}
            loading={loading}
            onOpenGroup={openGroup}
            onCreateClick={() => setView('create')}
            onJoinClick={() => setView('join')}
          />
        )}
        {view === 'create' && (
          <CreateGroup
            key="create"
            onBack={() => setView('list')}
            onCreate={async (data) => {
              await createGroup(data);
              setView('list');
            }}
          />
        )}
        {view === 'join' && (
          <JoinGroup
            key="join"
            onBack={() => setView('list')}
            onJoin={async (code) => {
              await joinGroup(code);
              setView('list');
            }}
          />
        )}
        {view === 'detail' && selectedGroupId && (
          <GroupDetail
            key="detail"
            groupId={selectedGroupId}
            onBack={() => { setView('list'); setSelectedGroupId(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================
// Group List
// ============================================
function GroupList({ groups, loading, onOpenGroup, onCreateClick, onJoinClick }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="page-header">
        <h2>Gruppen</h2>
        <p>Gemeinsam planen und organisieren</p>
      </div>

      <div className="group-actions-row">
        <button className="group-action-btn primary" onClick={onCreateClick}>
          <Plus size={18} /> Gruppe erstellen
        </button>
        <button className="group-action-btn" onClick={onJoinClick}>
          <Hash size={18} /> Beitreten
        </button>
      </div>

      {loading && groups.length === 0 ? (
        <div className="group-loading">Laden...</div>
      ) : groups.length === 0 ? (
        <div className="group-empty">
          <div className="group-empty-icon"><Users size={40} /></div>
          <h3>Noch keine Gruppen</h3>
          <p>Erstelle eine Gruppe oder tritt einer bei</p>
        </div>
      ) : (
        <div className="group-list">
          {groups.map((g) => (
            <motion.div
              key={g.id}
              className="group-card"
              onClick={() => onOpenGroup(g.id)}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="group-card-avatar" style={{ background: g.color || '#007AFF' }}>
                {g.name?.[0]?.toUpperCase()}
              </div>
              <div className="group-card-info">
                <h3>{g.name}</h3>
                <div className="group-card-meta">
                  <span><Users size={12} /> {g.member_count} Mitglieder</span>
                  <span className="group-card-dot">·</span>
                  <span>{g.task_count} Aufgaben</span>
                </div>
              </div>
              <div className="group-card-role">
                <span className={`group-role-badge ${g.role}`}>
                  {ROLE_CONFIG[g.role]?.label}
                </span>
              </div>
              <ChevronRight size={18} className="group-card-chevron" />
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ============================================
// Create Group
// ============================================
function CreateGroup({ onBack, onCreate }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#007AFF');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreate({ name: name.trim(), description: description.trim(), color });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      <div className="group-sub-header">
        <button className="group-back-btn" onClick={onBack}><ArrowLeft size={20} /></button>
        <h2>Neue Gruppe</h2>
      </div>

      <form className="group-form" onSubmit={handleSubmit}>
        <div className="group-form-preview">
          <div className="group-big-avatar" style={{ background: color }}>
            {name ? name[0].toUpperCase() : '?'}
          </div>
        </div>

        <div className="task-edit-field">
          <label>Gruppenname</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. WG Haushalt, Projekt Alpha..."
            className="task-edit-input"
            maxLength={100}
            autoFocus
          />
        </div>

        <div className="task-edit-field">
          <label>Beschreibung (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Wofür ist die Gruppe?"
            className="task-edit-input task-edit-textarea"
            rows={2}
          />
        </div>

        <div className="task-edit-field">
          <label>Farbe</label>
          <div className="group-color-picker">
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`group-color-dot ${color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <button type="submit" className="group-submit-btn" disabled={!name.trim() || saving}>
          {saving ? 'Erstellen...' : 'Gruppe erstellen'}
        </button>
      </form>
    </motion.div>
  );
}

// ============================================
// Join Group
// ============================================
function JoinGroup({ onBack, onJoin }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const { addToast } = useTaskStore();

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setError('');
    setJoining(true);
    try {
      const data = await onJoin(code.trim());
      addToast(`✅ ${data.message || 'Gruppe beigetreten!'}`);
    } catch (err) {
      setError(err.message || 'Ungültiger Code');
    } finally {
      setJoining(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      <div className="group-sub-header">
        <button className="group-back-btn" onClick={onBack}><ArrowLeft size={20} /></button>
        <h2>Gruppe beitreten</h2>
      </div>

      <form className="group-form" onSubmit={handleJoin}>
        <div className="group-join-icon">
          <Hash size={40} />
        </div>
        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>
          Gib den Einladungscode ein, den du erhalten hast
        </p>

        <div className="task-edit-field">
          <label>Einladungscode</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="z.B. A1B2C3D4"
            className="task-edit-input"
            style={{ textAlign: 'center', fontSize: 20, fontWeight: 700, letterSpacing: 4 }}
            maxLength={8}
            autoFocus
          />
        </div>

        {error && <p className="group-error">{error}</p>}

        <button type="submit" className="group-submit-btn" disabled={code.length < 4 || joining}>
          {joining ? 'Beitretend...' : 'Beitreten'}
        </button>
      </form>
    </motion.div>
  );
}

// ============================================
// Group Detail
// ============================================
function GroupDetail({ groupId, onBack }) {
  const {
    currentGroup, members, groupTasks, myRole,
    fetchGroup, addGroupTask, removeGroupTask, changeMemberRole, removeMember, deleteGroup, updateGroup
  } = useGroupStore();
  const { user } = useAuthStore();
  const { addToast } = useTaskStore();
  const [tab, setTab] = useState('tasks'); // 'tasks' | 'members' | 'settings'
  const [showAddTask, setShowAddTask] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { fetchGroup(groupId); }, [groupId]);

  const copyCode = () => {
    if (!currentGroup?.invite_code) return;
    navigator.clipboard.writeText(currentGroup.invite_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const isAdmin = myRole === 'owner' || myRole === 'admin';

  if (!currentGroup) return <div className="group-loading">Laden...</div>;

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      {/* Header */}
      <div className="group-detail-header">
        <button className="group-back-btn" onClick={onBack}><ArrowLeft size={20} /></button>
        <div className="group-detail-avatar" style={{ background: currentGroup.color }}>
          {currentGroup.name?.[0]?.toUpperCase()}
        </div>
        <div className="group-detail-info">
          <h2>{currentGroup.name}</h2>
          {currentGroup.description && <p>{currentGroup.description}</p>}
        </div>
      </div>

      {/* Invite Code */}
      <div className="group-invite-row">
        <span className="group-invite-label">Einladungscode:</span>
        <code className="group-invite-code">{currentGroup.invite_code}</code>
        <button className="group-invite-copy" onClick={copyCode}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Kopiert!' : 'Kopieren'}
        </button>
      </div>

      {/* Tabs */}
      <div className="group-tabs">
        <button className={`group-tab ${tab === 'tasks' ? 'active' : ''}`} onClick={() => setTab('tasks')}>
          Aufgaben <span className="group-tab-count">{groupTasks.length}</span>
        </button>
        <button className={`group-tab ${tab === 'members' ? 'active' : ''}`} onClick={() => setTab('members')}>
          Mitglieder <span className="group-tab-count">{members.length}</span>
        </button>
        {isAdmin && (
          <button className={`group-tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
            <Settings size={14} />
          </button>
        )}
      </div>

      {/* Tasks Tab */}
      {tab === 'tasks' && (
        <div className="group-tab-content">
          <button className="group-add-task-btn" onClick={() => setShowAddTask(true)}>
            <Plus size={16} /> Aufgabe hinzufügen
          </button>

          {groupTasks.length === 0 ? (
            <div className="group-empty-tab">Noch keine Aufgaben in dieser Gruppe</div>
          ) : (
            <div className="group-task-list">
              {groupTasks.map((task) => (
                <GroupTaskCard
                  key={task.id}
                  task={task}
                  groupId={groupId}
                  canRemove={isAdmin || task.user_id === user?.id}
                  onRemove={removeGroupTask}
                />
              ))}
            </div>
          )}

          {showAddTask && (
            <AddGroupTask
              groupId={groupId}
              onClose={() => setShowAddTask(false)}
              onAdd={async (task) => {
                await addGroupTask(groupId, task);
                addToast('✅ Aufgabe zur Gruppe hinzugefügt');
                setShowAddTask(false);
              }}
            />
          )}
        </div>
      )}

      {/* Members Tab */}
      {tab === 'members' && (
        <div className="group-tab-content">
          {members.map((m) => {
            const RoleIcon = ROLE_CONFIG[m.role]?.icon || Users;
            return (
              <div key={m.user_id} className="group-member-card">
                <AvatarBadge
                  className="group-member-avatar"
                  name={m.name}
                  color={m.avatar_color || '#007AFF'}
                  avatarUrl={m.avatar_url}
                  size={40}
                />
                <div className="group-member-info">
                  <span className="group-member-name">
                    {m.name} {m.user_id === user?.id && <span className="group-member-you">(Du)</span>}
                  </span>
                  <span className={`group-role-badge ${m.role}`}>
                    <RoleIcon size={11} /> {ROLE_CONFIG[m.role]?.label}
                  </span>
                </div>
                {isAdmin && m.user_id !== user?.id && m.role !== 'owner' && (
                  <div className="group-member-actions">
                    {myRole === 'owner' && (
                      <button
                        className="group-member-action-btn"
                        onClick={() => {
                          changeMemberRole(groupId, m.user_id, m.role === 'admin' ? 'member' : 'admin');
                        }}
                        title={m.role === 'admin' ? 'Zu Mitglied herabstufen' : 'Zum Admin befördern'}
                      >
                        <Shield size={14} />
                      </button>
                    )}
                    <button
                      className="group-member-action-btn remove"
                      onClick={() => {
                        removeMember(groupId, m.user_id);
                        addToast('Mitglied entfernt');
                      }}
                      title="Entfernen"
                    >
                      <UserMinus size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Leave */}
          {myRole !== 'owner' && (
            <button
              className="group-leave-btn"
              onClick={async () => {
                await removeMember(groupId, user.id);
                addToast('Du hast die Gruppe verlassen');
                onBack();
              }}
            >
              <LogOut size={16} /> Gruppe verlassen
            </button>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {tab === 'settings' && isAdmin && (
        <GroupSettings
          group={currentGroup}
          onUpdate={(data) => updateGroup(groupId, data)}
          onDelete={async () => {
            await deleteGroup(groupId);
            addToast('Gruppe gelöscht');
            onBack();
          }}
          isOwner={myRole === 'owner'}
        />
      )}
    </motion.div>
  );
}

// ============================================
// Group Task Card
// ============================================
function GroupTaskCard({ task, groupId, canRemove, onRemove }) {
  const priorityColors = {
    low: 'var(--success)', medium: 'var(--primary)',
    high: 'var(--warning)', urgent: 'var(--danger)',
  };

  return (
    <div className={`group-task-card ${task.completed ? 'completed' : ''}`}>
      <div className="group-task-priority" style={{ background: priorityColors[task.priority] }} />
      <div className="group-task-content">
        <div className="group-task-title">{task.title}</div>
        <div className="group-task-meta">
          {task.creator_name && (
            <span className="group-task-creator">
              <AvatarBadge
                className="group-task-creator-dot"
                name={task.creator_name}
                color={task.creator_color || '#007AFF'}
                avatarUrl={task.creator_avatar_url}
                size={12}
              />
              {task.creator_name}
            </span>
          )}
          {task.date && (
            <span><Calendar size={11} /> {task.date.substring(0, 10)}</span>
          )}
          {task.time && (
            <span><Clock size={11} /> {task.time.substring(0, 5)}</span>
          )}
        </div>
      </div>
      {canRemove && (
        <button className="group-task-remove" onClick={() => onRemove(groupId, task.id)} title="Entfernen">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// ============================================
// Add Task to Group (Quick Form)
// ============================================
function AddGroupTask({ groupId, onClose, onAdd }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [priority, setPriority] = useState('medium');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onAdd({ title: title.trim(), date: date || null, time: time || null, priority });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      className="group-add-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.form
        className="group-add-form"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h4 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Neue Gruppenaufgabe</h4>
          <button type="button" onClick={onClose} style={{ background: 'var(--hover)', border: 'none', borderRadius: 10, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
        </div>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Was muss erledigt werden?"
          autoFocus
        />

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}><Calendar size={12} /> Datum</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}><Clock size={12} /> Uhrzeit</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}><Flag size={12} /> Priorität</label>
          <div className="group-priority-pills">
            {[
              { v: 'low', l: 'Niedrig', c: 'var(--success)' },
              { v: 'medium', l: 'Mittel', c: 'var(--primary)' },
              { v: 'high', l: 'Hoch', c: 'var(--warning)' },
              { v: 'urgent', l: 'Dringend', c: 'var(--danger)' },
            ].map((p) => (
              <button
                key={p.v}
                type="button"
                className={`group-priority-pill ${priority === p.v ? 'selected' : ''}`}
                style={priority === p.v ? { background: p.c, color: '#fff', borderColor: p.c } : {}}
                onClick={() => setPriority(p.v)}
              >{p.l}</button>
            ))}
          </div>
        </div>

        <button type="submit" className="group-submit-btn" disabled={!title.trim() || saving}>
          {saving ? 'Hinzufügen...' : 'Zur Gruppe hinzufügen'}
        </button>
      </motion.form>
    </motion.div>
  );
}

// ============================================
// Group Settings
// ============================================
function GroupSettings({ group, onUpdate, onDelete, isOwner }) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || '');
  const [color, setColor] = useState(group.color);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate({ name, description, color });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="group-tab-content">
      <div className="group-form">
        <div className="task-edit-field">
          <label>Gruppenname</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="task-edit-input"
          />
        </div>

        <div className="task-edit-field">
          <label>Beschreibung</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="task-edit-input task-edit-textarea"
            rows={2}
          />
        </div>

        <div className="task-edit-field">
          <label>Farbe</label>
          <div className="group-color-picker">
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`group-color-dot ${color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <button className="group-submit-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Speichern...' : 'Änderungen speichern'}
        </button>
      </div>

      {isOwner && (
        <div className="group-danger-zone">
          <h4>Gefahrenzone</h4>
          {!confirmDelete ? (
            <button className="group-delete-btn" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={16} /> Gruppe löschen
            </button>
          ) : (
            <div className="group-confirm-delete">
              <p>Wirklich löschen? Alle Verknüpfungen werden entfernt.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="group-delete-btn confirm" onClick={onDelete}>Ja, löschen</button>
                <button className="group-cancel-btn" onClick={() => setConfirmDelete(false)}>Abbrechen</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
