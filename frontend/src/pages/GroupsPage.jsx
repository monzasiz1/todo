import { useState, useEffect, useMemo } from 'react';
import { useGroupStore } from '../store/groupStore';
import { useAuthStore } from '../store/authStore';
import { useTaskStore } from '../store/taskStore';
import { api } from '../utils/api';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Plus, Hash, Copy, Check, ChevronRight, ChevronDown, Crown,
  Shield, UserMinus, Settings, Trash2, LogOut, X,
  Calendar, CalendarCheck, Clock, Flag, Search, ArrowLeft, ListTodo
} from 'lucide-react';
import AvatarBadge from '../components/AvatarBadge';
import TaskDetailModal from '../components/TaskDetailModal';
import { usePlan } from '../hooks/usePlan';
import UpgradeModal from '../components/UpgradeModal';

const GROUP_COLORS = [
  '#007AFF', '#5856D6', '#34C759', '#FF9500', '#FF3B30',
  '#AF52DE', '#FF2D55', '#00C7BE', '#5AC8FA', '#FFCC00',
];

const ROLE_CONFIG = {
  owner: { label: 'Ersteller', icon: Crown, color: '#FFD700' },
  admin: { label: 'Admin', icon: Shield, color: '#007AFF' },
  member: { label: 'Mitglied', icon: Users, color: '#8E8E93' },
};

function getEventEndDate(task) {
  if (!task?.date) return null;
  const datePart = String(task.date).slice(0, 10);
  const rawEnd = String(task.time_end || task.time || '23:59').slice(0, 5);
  const parts = rawEnd.split(':');
  const hh = String(Math.min(23, Math.max(0, Number(parts[0]) || 23))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, Number(parts[1]) || 59))).padStart(2, '0');
  const dt = new Date(`${datePart}T${hh}:${mm}:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function isEventEnded(task) {
  if (task?.type !== 'event') return false;
  const end = getEventEndDate(task);
  return !!end && end.getTime() < Date.now();
}

async function fileToResizedDataUrl(file, maxSize = 320) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      if (w > h) {
        h = (h / w) * maxSize;
        w = maxSize;
      } else {
        w = (w / h) * maxSize;
        h = maxSize;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = dataUrl;
  });
}

export default function GroupsPage() {
  const { groups, fetchGroups, createGroup, joinGroup, loading } = useGroupStore();
  const [view, setView] = useState('list');
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const { can, limit } = usePlan();

  useEffect(() => { fetchGroups(); }, []);

  const openGroup = (id) => {
    setSelectedGroupId(id);
    setView('detail');
  };

  // Gate: free users cannot use groups at all
  if (!can('groups')) {
    return (
      <div>
        {showUpgrade && (
          <UpgradeModal feature="groups" onClose={() => setShowUpgrade(false)} />
        )}
        <div className="page-header">
          <h2>Gruppen</h2>
          <p>Arbeite gemeinsam mit anderen an Aufgaben.</p>
        </div>
        <div className="plan-gate-wrap" style={{ minHeight: 260 }}>
          <div className="plan-gate-blur" style={{ filter: 'blur(4px)', padding: 24 }}>
            <div style={{ height: 200, background: 'var(--bg)', borderRadius: 16 }} />
          </div>
          <div className="plan-gate-overlay" onClick={() => setShowUpgrade(true)}>
            <div className="plan-gate-lock">
              <Users size={22} />
            </div>
            <p className="plan-gate-label">Pro-Feature</p>
            <button className="plan-gate-btn">Gruppen freischalten</button>
          </div>
        </div>
      </div>
    );
  }

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
  const [query, setQuery] = useState('');

  const normalizedGroups = useMemo(() => {
    return (groups || []).map((g) => ({
      ...g,
      member_count: Number(g.member_count || 0),
      task_count: Number(g.task_count || 0),
    }));
  }, [groups]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return normalizedGroups;
    return normalizedGroups.filter((g) => {
      const name = String(g.name || '').toLowerCase();
      const role = String(g.role || '').toLowerCase();
      return name.includes(q) || role.includes(q);
    });
  }, [normalizedGroups, query]);

  const stats = useMemo(() => {
    const totalGroups = normalizedGroups.length;
    const totalMembers = normalizedGroups.reduce((sum, g) => sum + g.member_count, 0);
    const totalTasks = normalizedGroups.reduce((sum, g) => sum + g.task_count, 0);
    const adminOrOwnerCount = normalizedGroups.filter((g) => g.role === 'owner' || g.role === 'admin').length;
    return { totalGroups, totalMembers, totalTasks, adminOrOwnerCount };
  }, [normalizedGroups]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="page-header">
        <h2>Gruppen</h2>
        <p>Gemeinsam planen und organisieren</p>
      </div>

      <section className="groups-hub">
        <div className="groups-hub-stats" aria-label="Gruppen Statistiken">
          <article className="groups-hub-stat-card">
            <span>Anzahl Gruppen</span>
            <strong>{stats.totalGroups}</strong>
          </article>
          <article className="groups-hub-stat-card">
            <span>Mitglieder gesamt</span>
            <strong>{stats.totalMembers}</strong>
          </article>
          <article className="groups-hub-stat-card">
            <span>Einträge gesamt</span>
            <strong>{stats.totalTasks}</strong>
          </article>
          <article className="groups-hub-stat-card">
            <span>Leitungsrollen</span>
            <strong>{stats.adminOrOwnerCount}</strong>
          </article>
        </div>

        <div className="group-actions-row">
          <button className="group-action-btn primary" onClick={onCreateClick}>
            <Plus size={18} /> Gruppe erstellen
          </button>
          <button className="group-action-btn secondary" onClick={onJoinClick}>
            <Hash size={18} /> Beitreten
          </button>
        </div>

        <div className="groups-search-wrap">
          <Search size={16} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Gruppe oder Rolle suchen..."
            className="groups-search-input"
            aria-label="Gruppen durchsuchen"
          />
          {query && (
            <button
              type="button"
              className="groups-search-clear"
              onClick={() => setQuery('')}
              aria-label="Suche leeren"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </section>

      {loading && groups.length === 0 ? (
        <div className="group-loading">Laden...</div>
      ) : filteredGroups.length === 0 && groups.length > 0 ? (
        <div className="group-empty">
          <div className="group-empty-icon"><Search size={32} /></div>
          <h3>Keine Treffer</h3>
          <p>Versuche einen anderen Suchbegriff</p>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="group-empty">
          <div className="group-empty-icon"><Users size={40} /></div>
          <h3>Noch keine Gruppen</h3>
          <p>Erstelle eine Gruppe oder tritt einer bei</p>
        </div>
      ) : (
        <div className="group-list">
          {filteredGroups.map((g) => (
            <motion.div
              key={g.id}
              className="group-card"
              onClick={() => onOpenGroup(g.id)}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.99 }}
            >
              <div className="group-card-accent" style={{ background: g.color || '#007AFF' }} />
              <AvatarBadge
                className="group-card-avatar"
                name={g.name}
                color={g.color || '#007AFF'}
                avatarUrl={g.image_url}
                size={46}
              />
              <div className="group-card-info">
                <div className="group-card-name-row">
                  <h3>{g.name}</h3>
                  <span className={`group-role-badge ${g.role}`}>
                    {ROLE_CONFIG[g.role]?.label || 'Mitglied'}
                  </span>
                </div>
                <div className="group-card-meta">
                  <span><Users size={12} /> {g.member_count} Mitglieder</span>
                  <span><Calendar size={12} /> {g.task_count} Einträge</span>
                </div>
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
  const [imageUrl, setImageUrl] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreate({ name: name.trim(), description: description.trim(), color, image_url: imageUrl });
    } finally {
      setSaving(false);
    }
  };

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const resized = await fileToResizedDataUrl(file, 320);
    setImageUrl(resized);
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      <div className="group-sub-header">
        <button className="group-back-btn" onClick={onBack}><ArrowLeft size={20} /></button>
        <h2>Neue Gruppe</h2>
      </div>

      <form className="group-form" onSubmit={handleSubmit}>
        <div className="group-form-preview">
          <AvatarBadge
            className="group-big-avatar"
            name={name || '?'}
            color={color}
            avatarUrl={imageUrl}
            size={68}
          />
        </div>

        <div className="task-edit-field">
          <label>Gruppenbild (optional)</label>
          <input type="file" accept="image/*" onChange={handleImageChange} className="task-edit-input" />
          {imageUrl && (
            <button type="button" className="group-cancel-btn" onClick={() => setImageUrl(null)} style={{ marginTop: 8 }}>
              Bild entfernen
            </button>
          )}
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
const DASHBOARD_REFRESH_PARAMS = [
  { dashboard: 'true', limit: '300', horizon_days: '42', completed_lookback_days: '30' },
  { force: true },
];

function GroupDetail({ groupId, onBack }) {
  const {
    currentGroup, members, groupTasks, myRole,
    fetchGroup, addGroupTask, removeGroupTask, changeMemberRole, removeMember, deleteGroup, updateGroup,
    updateGroupTask,
  } = useGroupStore();
  const { user } = useAuthStore();
  const { addToast, fetchTasks } = useTaskStore();
  const [tab, setTab] = useState('tasks'); // 'tasks' | 'members' | 'settings'
  const [showAddTask, setShowAddTask] = useState(false);
  const [copied, setCopied] = useState(false);
  const [visibleCount, setVisibleCount] = useState(15);
  const [detailTask, setDetailTask] = useState(null);
  const [showPastGroupTasks, setShowPastGroupTasks] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');

  useEffect(() => { fetchGroup(groupId); }, [groupId]);
  useEffect(() => { setVisibleCount(15); }, [tab]);

  const copyCode = () => {
    if (!currentGroup?.invite_code) return;
    navigator.clipboard.writeText(currentGroup.invite_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const activeTasks = useMemo(() => groupTasks.filter((t) => !t.completed && !isEventEnded(t)), [groupTasks]);
  const pastTasks = useMemo(() => groupTasks.filter((t) => t.completed || isEventEnded(t)), [groupTasks]);
  const categoryOptions = useMemo(() => {
    const map = new Map();
    groupTasks.forEach((task) => {
      // Nur echte Gruppen-Kategorien anzeigen – keine persönlichen Kategorien
      if (!task.group_category_name) return;
      const key = String(task.group_category_id || task.group_category_name);
      if (!map.has(key)) {
        map.set(key, {
          value: key,
          label: task.group_category_name,
          color: task.group_category_color || '#8E8E93',
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'de'));
  }, [groupTasks]);
  const filteredActiveTasks = useMemo(() => {
    if (categoryFilter === 'all') return activeTasks;
    return activeTasks.filter((task) => String(task.group_category_id || task.group_category_name) === categoryFilter);
  }, [activeTasks, categoryFilter]);
  const filteredPastTasks = useMemo(() => {
    if (categoryFilter === 'all') return pastTasks;
    return pastTasks.filter((task) => String(task.group_category_id || task.group_category_name) === categoryFilter);
  }, [pastTasks, categoryFilter]);
  const completionRate = groupTasks.length > 0 ? Math.round((pastTasks.length / groupTasks.length) * 100) : 0;
  const sortedMembers = useMemo(() => {
    const roleWeight = { owner: 0, admin: 1, member: 2 };
    return [...members].sort((a, b) => {
      const weightDiff = (roleWeight[a.role] ?? 3) - (roleWeight[b.role] ?? 3);
      if (weightDiff !== 0) return weightDiff;
      if (a.user_id === user?.id) return -1;
      if (b.user_id === user?.id) return 1;
      return String(a.name || '').localeCompare(String(b.name || ''), 'de');
    });
  }, [members, user?.id]);
  const adminCount = useMemo(() => members.filter((m) => m.role === 'admin' || m.role === 'owner').length, [members]);

  useEffect(() => {
    if (categoryFilter === 'all') return;
    const exists = categoryOptions.some((opt) => opt.value === categoryFilter);
    if (!exists) setCategoryFilter('all');
  }, [categoryFilter, categoryOptions]);

  if (!currentGroup || String(currentGroup.id) !== String(groupId)) return <div className="group-loading">Laden...</div>;

  return (
    <motion.div className="group-detail-shell" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      {/* Header */}
      <div className="group-detail-header">
        <button className="group-back-btn" onClick={onBack}><ArrowLeft size={20} /></button>
        <AvatarBadge
          className="group-detail-avatar"
          name={currentGroup.name}
          color={currentGroup.color || '#007AFF'}
          avatarUrl={currentGroup.image_url}
          size={54}
        />
        <div className="group-detail-info">
          <h2>{currentGroup.name}</h2>
          {currentGroup.description && <p>{currentGroup.description}</p>}
          <div className="group-detail-role-row">
            <span className={`group-role-badge ${myRole}`}>
              {ROLE_CONFIG[myRole]?.label || 'Mitglied'}
            </span>
            <span className="group-detail-role-hint">Collaboration Space</span>
          </div>
        </div>
      </div>

      <div className="group-quick-stats" aria-label="Gruppenübersicht">
        <article className="group-quick-stat">
          <span>Mitglieder</span>
          <strong>{members.length}</strong>
        </article>
        <article className="group-quick-stat">
          <span>Aktive Aufgaben</span>
          <strong>{activeTasks.length}</strong>
        </article>
        <article className="group-quick-stat">
          <span>Abgeschlossen</span>
          <strong>{completionRate}%</strong>
        </article>
        <article className="group-quick-stat">
          <span>Admins</span>
          <strong>{adminCount}</strong>
        </article>
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
          Einträge <span className="group-tab-count">{groupTasks.length}</span>
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
          <div className="group-tab-toolbar">
            <div className="group-tab-heading-wrap">
              <h3 className="group-tab-heading">Team-Planung</h3>
              <p>Aufgaben und Termine zentral planen, Vergangenes optional einblendbar.</p>
            </div>
            {categoryOptions.length > 0 && (
              <select
                className="task-edit-input"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={{ maxWidth: 220 }}
              >
                <option value="all">Alle Kategorien</option>
                {categoryOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
            <button className="group-add-task-btn" onClick={() => setShowAddTask(true)}>
              <Plus size={16} /> Eintrag hinzufügen
            </button>
          </div>

          {groupTasks.length === 0 ? (
            <div className="group-empty-tab">Noch keine Einträge in dieser Gruppe</div>
          ) : (
            <div className="group-task-list">
              {filteredActiveTasks.slice(0, visibleCount).map((task) => (
                <GroupTaskCard
                  key={task.id}
                  task={task}
                  groupId={groupId}
                  canRemove={isAdmin || task.user_id === user?.id}
                  onRemove={async (gId, tId) => {
                    await removeGroupTask(gId, tId);
                    fetchTasks(...DASHBOARD_REFRESH_PARAMS);
                  }}
                  onOpenTask={setDetailTask}
                />
              ))}
              {visibleCount < filteredActiveTasks.length && (
                <button
                  className="group-load-more-btn"
                  onClick={() => setVisibleCount(v => v + 15)}
                >
                  Mehr anzeigen ({filteredActiveTasks.length - visibleCount} weitere)
                </button>
              )}
              {filteredPastTasks.length > 0 && (
                <div className="group-past-section">
                  <button
                    className="group-past-toggle"
                    onClick={() => setShowPastGroupTasks(v => !v)}
                  >
                    <span>Vergangene / Erledigte ({filteredPastTasks.length})</span>
                    <ChevronDown size={14} style={{ transform: showPastGroupTasks ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  </button>
                  {showPastGroupTasks && filteredPastTasks.map((task) => (
                    <GroupTaskCard
                      key={task.id}
                      task={task}
                      groupId={groupId}
                      canRemove={isAdmin || task.user_id === user?.id}
                      onRemove={async (gId, tId) => {
                        await removeGroupTask(gId, tId);
                        fetchTasks(...DASHBOARD_REFRESH_PARAMS);
                      }}
                      onOpenTask={setDetailTask}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {showAddTask && (
            <AddGroupTask
              groupId={groupId}
              onClose={() => setShowAddTask(false)}
              onAdd={async (task) => {
                await addGroupTask(groupId, task);
                addToast(`✅ ${task.type === 'event' ? 'Termin' : 'Aufgabe'} zur Gruppe hinzugefügt`);
                setShowAddTask(false);
                fetchTasks(...DASHBOARD_REFRESH_PARAMS);
              }}
            />
          )}

          {detailTask && (
            <TaskDetailModal
              task={detailTask}
              onClose={() => setDetailTask(null)}
              onUpdated={(updated) => {
                updateGroupTask(updated.id, updated);
                fetchTasks(...DASHBOARD_REFRESH_PARAMS);
              }}
            />
          )}
        </div>
      )}

      {/* Members Tab */}
      {tab === 'members' && (
        <div className="group-tab-content">
          <div className="group-tab-heading-wrap" style={{ marginBottom: 12 }}>
            <h3 className="group-tab-heading">Mitgliederverwaltung</h3>
            <p>Rollen, Verantwortlichkeiten und Zugriffe im Team steuern.</p>
          </div>
          {sortedMembers.map((m) => {
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
        <>
          <div className="group-tab-heading-wrap" style={{ marginBottom: 12 }}>
            <h3 className="group-tab-heading">Gruppeneinstellungen</h3>
            <p>Branding, Beschreibung und sensible Aktionen zentral verwalten.</p>
          </div>
          <GroupCategoryManager groupId={groupId} />
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
        </>
      )}
    </motion.div>
  );
}

// ============================================
// Group Task Card
// ============================================
function GroupTaskCard({ task, groupId, canRemove, onRemove, onOpenTask }) {
  const priorityColors = {
    low: 'var(--success)', medium: 'var(--primary)',
    high: 'var(--warning)', urgent: 'var(--danger)',
  };

  const endedEvent = isEventEnded(task);
  const categoryLabel = task.group_category_name;
  const categoryColor = task.group_category_color || '#8E8E93';

  return (
    <div
      className={`group-task-card group-task-card-clickable ${task.completed ? 'completed' : ''} ${endedEvent ? 'ended-event' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpenTask?.(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenTask?.(task);
        }
      }}
      title="Aufgabe öffnen"
    >
      <div className="group-task-priority" style={{ background: priorityColors[task.priority] }} />
      <div className="group-task-content">
        <div className="group-task-title">
          <span className={`group-entry-type-badge ${task.type === 'event' ? 'event' : 'task'}`}>
            {task.type === 'event' ? <CalendarCheck size={11} /> : <ListTodo size={11} />}
            {task.type === 'event' ? 'Termin' : 'Aufgabe'}
          </span>
          {task.title}
          {endedEvent && <span className="group-task-status">Beendet</span>}
        </div>
        <div className="group-task-meta">
          {categoryLabel && (
            <span className="group-task-category">
              <span className="group-task-category-dot" style={{ background: categoryColor }} />
              {categoryLabel}
            </span>
          )}
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
        <button
          className="group-task-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(groupId, task.id);
          }}
          title="Entfernen"
        >
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
  const [type, setType] = useState('task');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [priority, setPriority] = useState('medium');
  const [groupCategories, setGroupCategories] = useState([]);
  const [groupCategoryId, setGroupCategoryId] = useState('');
  const [saving, setSaving] = useState(false);

  const loadGroupCategories = async () => {
    try {
      const data = await api.getGroupCategories(groupId);
      setGroupCategories(Array.isArray(data?.categories) ? data.categories : []);
    } catch {
      setGroupCategories([]);
    }
  };

  useEffect(() => {
    loadGroupCategories();
  }, [groupId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onAdd({
        type,
        title: title.trim(),
        date: date || null,
        time: time || null,
        time_end: type === 'event' ? (timeEnd || null) : null,
        priority,
        group_category_id: groupCategoryId || null,
      });
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
          <h4 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
            Neuer Gruppeneintrag
          </h4>
          <button type="button" onClick={onClose} style={{ background: 'var(--hover)', border: 'none', borderRadius: 10, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
        </div>

        <div className="task-type-toggle">
          <button
            type="button"
            className={`task-type-btn ${type === 'task' ? 'active' : ''}`}
            onClick={() => setType('task')}
          >
            <ListTodo size={16} /> Aufgabe
          </button>
          <button
            type="button"
            className={`task-type-btn event ${type === 'event' ? 'active' : ''}`}
            onClick={() => setType('event')}
          >
            <CalendarCheck size={16} /> Termin
          </button>
        </div>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={type === 'event' ? 'Wie heißt der Termin?' : 'Was muss erledigt werden?'}
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
          {type === 'event' && (
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}><Clock size={12} /> Endzeit</label>
              <input type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} />
            </div>
          )}
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

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Gruppenkategorie</label>
          <select value={groupCategoryId} onChange={(e) => setGroupCategoryId(e.target.value)} className="task-edit-input">
            <option value="">Keine Gruppenkategorie</option>
            {groupCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          <p className="group-cat-manage-hint">Kategorien im Tab Einstellungen verwalten.</p>
        </div>

        <button type="submit" className="group-submit-btn" disabled={!title.trim() || saving}>
          {saving ? 'Hinzufügen...' : `${type === 'event' ? 'Termin' : 'Aufgabe'} zur Gruppe hinzufügen`}
        </button>
      </motion.form>
    </motion.div>
  );
}

function GroupCategoryManager({ groupId }) {
  const [categories, setCategories] = useState([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#8E8E93');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const loadCategories = async () => {
    setLoading(true);
    try {
      const data = await api.getGroupCategories(groupId);
      const next = Array.isArray(data?.categories) ? data.categories : [];
      setCategories(next.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de')));
    } catch {
      setCategories([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
  }, [groupId]);

  const handleCreate = async () => {
    const trimmed = String(name || '').trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const data = await api.createGroupCategory(groupId, { name: trimmed, color });
      const created = data?.category;
      if (created?.id) {
        setCategories((prev) => {
          const next = [...prev.filter((c) => String(c.id) !== String(created.id)), created];
          return next.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de'));
        });
      } else {
        await loadCategories();
      }
      setName('');
      setColor('#8E8E93');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (categoryId) => {
    if (!categoryId || deletingId) return;
    setDeletingId(categoryId);
    try {
      await api.deleteGroupCategory(groupId, categoryId);
      setCategories((prev) => prev.filter((c) => String(c.id) !== String(categoryId)));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="group-tab-content group-cat-manager">
      <div className="group-cat-head">
        <div>
          <h4>Gruppenkategorien</h4>
          <p>Zentrale Kategorien fuer alle Gruppentermine und Aufgaben.</p>
        </div>
        <span>{categories.length} vorhanden</span>
      </div>

      <div className="group-cat-create-row">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="task-edit-input"
          placeholder="Neue Gruppenkategorie"
          maxLength={80}
        />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          title="Kategoriefarbe"
          className="group-cat-color"
        />
        <button
          type="button"
          className="group-submit-btn"
          onClick={handleCreate}
          disabled={!name.trim() || saving}
        >
          {saving ? 'Anlegen...' : 'Kategorie anlegen'}
        </button>
      </div>

      {loading ? (
        <div className="group-empty-tab">Kategorien laden...</div>
      ) : categories.length === 0 ? (
        <div className="group-empty-tab">Noch keine Gruppenkategorien vorhanden.</div>
      ) : (
        <div className="group-cat-list">
          {categories.map((cat) => (
            <div key={cat.id} className="group-cat-item">
              <span className="group-task-category" style={{ background: `${cat.color || '#8E8E93'}22`, color: cat.color || '#5E5E66' }}>
                <span className="group-task-category-dot" style={{ background: cat.color || '#8E8E93' }} />
                {cat.name}
              </span>
              <button
                type="button"
                className="group-cat-delete-btn"
                onClick={() => handleDelete(cat.id)}
                disabled={String(deletingId) === String(cat.id)}
                title="Kategorie löschen"
              >
                <Trash2 size={14} />
                {String(deletingId) === String(cat.id) ? 'Loesche...' : 'Loeschen'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// Group Settings
// ============================================
function GroupSettings({ group, onUpdate, onDelete, isOwner }) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || '');
  const [color, setColor] = useState(group.color);
  const [imageUrl, setImageUrl] = useState(group.image_url || null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate({ name, description, color, image_url: imageUrl });
    } finally {
      setSaving(false);
    }
  };

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const resized = await fileToResizedDataUrl(file, 320);
    setImageUrl(resized);
  };

  return (
    <div className="group-tab-content">
      <div className="group-form">
        <div className="group-form-preview">
          <AvatarBadge
            className="group-big-avatar"
            name={name || '?'}
            color={color || '#007AFF'}
            avatarUrl={imageUrl}
            size={68}
          />
        </div>

        <div className="task-edit-field">
          <label>Gruppenbild</label>
          <input type="file" accept="image/*" onChange={handleImageChange} className="task-edit-input" />
          {imageUrl && (
            <button type="button" className="group-cancel-btn" onClick={() => setImageUrl(null)} style={{ marginTop: 8 }}>
              Bild entfernen
            </button>
          )}
        </div>

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
