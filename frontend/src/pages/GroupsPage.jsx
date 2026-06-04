import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useGroupStore } from '../store/groupStore';
import { useAuthStore } from '../store/authStore';
import { useTaskStore } from '../store/taskStore';
import { api } from '../utils/api';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import TaskCard from '../components/TaskCard';
import {
  Users, UserPlus, Globe, Plus, Hash, Copy, Check, ChevronRight, ChevronDown, Crown,
  Shield, UserMinus, Settings, Trash2, LogOut, X,
  Calendar, CalendarCheck, Clock, Flag, Search, ArrowLeft, ListTodo,
  Camera, Tag, AlertTriangle, Pencil, ChevronsDown, ThumbsUp, Bell, EyeOff, RotateCcw,
  Activity, CalendarClock, Sparkles,
  MessageCircle, FileText, Save, Palette,
} from 'lucide-react';
import { formatDistanceToNowStrict, isToday as isTodayDate, parseISO, format as formatDate } from 'date-fns';
import { de as deLocale } from 'date-fns/locale';
import AvatarBadge from '../components/AvatarBadge';
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
  const navigate = useNavigate();
  const { groups, fetchGroups, createGroup, joinGroup, loading } = useGroupStore();
  const [view, setView] = useState('list');
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const { can, limit } = usePlan();
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingGroupRef = useRef(null); // kept for compat
  const pendingTaskRef = useRef(null);  // kept for compat

  // Parse URL params and navigate — works both on fresh mount and when already on page
  useEffect(() => {
    const groupParam = searchParams.get('group');
    const taskParam = searchParams.get('task');
    if (!groupParam && !taskParam) return;
    setSearchParams({}, { replace: true });

    const applyNav = (groupId, taskId) => {
      if (groupId) {
        setSelectedGroupId(groupId);
        setView('detail');
      }
      if (taskId) {
        navigate(`/app/tasks/${taskId}`);
      }
    };

    const gId = groupParam ? Number(groupParam) : null;
    const tId = taskParam ? Number(taskParam) : null;

    if (groups.length > 0) {
      // Groups already in store — navigate immediately
      applyNav(gId, tId);
    } else {
      // Groups not yet loaded — fetch first, then navigate
      fetchGroups().then(() => applyNav(gId, tId));
    }
  }, [searchParams]);

  useEffect(() => {
    fetchGroups();
  }, []);

  const openGroup = (id) => {
    setSelectedGroupId(id);
    setView('detail');
  };

  // Gate: nur wenn der Plan gar keine Gruppen erlaubt (alte Free-Variante / Fallback).
  // Mit aktuellem Free-Plan (1 Gruppe) wird der Limit-Check beim Erstellen geprueft.
  if (!can('groups') || limit('groups') === 0) {
    return (
      <div className="groups-page">
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
      {showUpgrade && (
        <UpgradeModal feature="groups" onClose={() => setShowUpgrade(false)} />
      )}
      <AnimatePresence mode="wait">
        {view === 'list' && (
          <GroupList
            key="list"
            groups={groups}
            loading={loading}
            onOpenGroup={openGroup}
            onCreateClick={() => {
              const max = limit('groups');
              // Nur selbst erstellte (owner) Gruppen zaehlen aufs Limit -
              // Einladungen/Mitgliedschaften sind unbegrenzt.
              const ownedCount = groups.filter((g) => g.role === 'owner').length;
              if (Number.isFinite(max) && ownedCount >= max) {
                setShowUpgrade(true);
                return;
              }
              setView('create');
            }}
            onJoinClick={() => setView('join')}
            onSearchGroupsClick={() => setView('search-groups')}
          />
        )}
        {view === 'create' && (
          <CreateGroup
            key="create"
            onBack={() => setView('list')}
            onCreate={async (data) => {
              try {
                const newGroup = await createGroup(data);
                setView('list');
                return newGroup;
              } catch (err) {
                const code = err?.data?.error || err?.body?.error || err?.error;
                if (code === 'plan_limit_groups' || /plan_limit/.test(String(err?.message))) {
                  setView('list');
                  setShowUpgrade(true);
                  return null;
                }
                throw err;
              }
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
        {view === 'search-groups' && (
          <SearchGroups
            key="search-groups"
            onBack={() => setView('list')}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================
// Group List
// ============================================

// Hilfen für relative Zeit / kommendes Event
function parseTaskDate(t) {
  if (!t?.date) return null;
  const datePart = String(t.date).slice(0, 10);
  const timePart = String(t.time || '00:00').slice(0, 5);
  const d = new Date(`${datePart}T${timePart}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function nextUpcomingEventFor(groupId, tasks) {
  const now = Date.now();
  let best = null;
  let bestTime = Infinity;
  for (const t of tasks || []) {
    if (t.group_id !== groupId) continue;
    if (t.type !== 'event') continue;
    if (t.completed) continue;
    const d = parseTaskDate(t);
    if (!d) continue;
    const time = d.getTime();
    if (time < now) continue;
    if (time < bestTime) {
      bestTime = time;
      best = { ...t, _date: d };
    }
  }
  return best;
}

function countTasksTodayFor(groupId, tasks) {
  let n = 0;
  for (const t of tasks || []) {
    if (t.group_id !== groupId) continue;
    if (t.completed) continue;
    const d = parseTaskDate(t);
    if (d && isTodayDate(d)) n += 1;
  }
  return n;
}

function relativeFromNow(value) {
  if (!value) return null;
  try {
    const d = typeof value === 'string' ? parseISO(value) : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return formatDistanceToNowStrict(d, { addSuffix: true, locale: deLocale });
  } catch { return null; }
}

function formatEventWhen(date) {
  if (!date) return '';
  try {
    if (isTodayDate(date)) {
      return `Heute, ${formatDate(date, 'HH:mm', { locale: deLocale })}`;
    }
    return formatDate(date, "EEE d. MMM · HH:mm", { locale: deLocale });
  } catch { return ''; }
}

function GroupListLoadingSkeleton() {
  return (
    <div className="bq-groups-skeleton" aria-live="polite" aria-busy="true">
      <div className="bq-groups-skeleton-bento">
        {[0, 1, 2].map((i) => <div key={i} className="bq-groups-skeleton-tile beequ-shimmer" />)}
      </div>
      {[0, 1, 2].map((i) => <div key={i} className="bq-groups-skeleton-card beequ-shimmer" />)}
    </div>
  );
}

function GroupDetailLoadingSkeleton({ onBack }) {
  return (
    <div className="group-detail-shell group-detail-loading" aria-live="polite" aria-busy="true">
      <div className="group-sub-header">
        <button className="group-back-btn" onClick={onBack}><ArrowLeft size={20} /></button>
        <h2>Lade Gruppe...</h2>
      </div>
      <div className="group-detail-loading-header beequ-shimmer" />
      <div className="group-detail-loading-stats">
        {[0, 1, 2, 3].map((idx) => (
          <div key={idx} className="group-detail-loading-stat beequ-shimmer" />
        ))}
      </div>
      <div className="group-detail-loading-list">
        {[0, 1, 2].map((idx) => (
          <div key={idx} className="group-detail-loading-row beequ-shimmer" />
        ))}
      </div>
    </div>
  );
}

function GroupList({ groups, loading, onOpenGroup, onCreateClick, onJoinClick, onSearchGroupsClick }) {
  const [query, setQuery] = useState('');
  const tasks = useTaskStore((s) => s.tasks);
  const { fetchGroups } = useGroupStore();
  const [invitations, setInvitations] = useState([]);
  const [invBusy, setInvBusy] = useState({});

  const loadInvitations = () => {
    api.getMyGroupRequests()
      .then((data) => {
        const all = Array.isArray(data?.requests) ? data.requests : [];
        setInvitations(all.filter((r) => r.status === 'invited'));
      })
      .catch(() => setInvitations([]));
  };

  useEffect(() => {
    loadInvitations();
  }, []);

  const handleInvitation = async (groupId, action) => {
    if (invBusy[groupId]) return;
    setInvBusy((s) => ({ ...s, [groupId]: true }));
    try {
      if (action === 'accept') {
        await api.acceptGroupInvitation(groupId);
        await fetchGroups();
      } else {
        await api.rejectGroupInvitation(groupId);
      }
      setInvitations((list) => list.filter((i) => String(i.group_id) !== String(groupId)));
    } catch (err) {
      console.error('Invitation action failed', err);
    } finally {
      setInvBusy((s) => {
        const copy = { ...s };
        delete copy[groupId];
        return copy;
      });
    }
  };

  const normalizedGroups = useMemo(() => {
    return (groups || []).map((g) => ({
      ...g,
      member_count: Number(g.member_count || 0),
      task_count: Number(g.task_count || 0),
    }));
  }, [groups]);

  // Pro-Group-Computations: nächstes Event, heutige Aufgaben, letzte Aktivität
  const enrichedGroups = useMemo(() => {
    return normalizedGroups.map((g) => {
      const nextEvent = nextUpcomingEventFor(g.id, tasks);
      const tasksToday = countTasksTodayFor(g.id, tasks);
      const activityRel = relativeFromNow(g.updated_at);
      return { ...g, _nextEvent: nextEvent, _tasksToday: tasksToday, _activityRel: activityRel };
    });
  }, [normalizedGroups, tasks]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return enrichedGroups;
    return enrichedGroups.filter((g) => {
      const name = String(g.name || '').toLowerCase();
      const role = String(g.role || '').toLowerCase();
      return name.includes(q) || role.includes(q);
    });
  }, [enrichedGroups, query]);

  // Bento-Aggregates über ALLE Gruppen
  const bento = useMemo(() => {
    const totalActive = enrichedGroups.reduce((s, g) => s + g.task_count, 0);
    const totalToday = enrichedGroups.reduce((s, g) => s + g._tasksToday, 0);
    const totalMembers = enrichedGroups.reduce((s, g) => s + g.member_count, 0);
    const earliest = enrichedGroups.reduce((acc, g) => {
      if (!g._nextEvent) return acc;
      if (!acc) return { event: g._nextEvent, group: g };
      return g._nextEvent._date < acc.event._date ? { event: g._nextEvent, group: g } : acc;
    }, null);
    return { totalActive, totalToday, totalMembers, earliest };
  }, [enrichedGroups]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="page-header">
        <h2>Gruppen</h2>
        <p>Gemeinsam planen und organisieren</p>
      </div>

      <section className="bq-groups">
        {invitations.length > 0 && (
          <div className="group-invitations-panel" role="region" aria-label="Offene Einladungen">
            <div className="group-invitations-header">
              <Bell size={14} />
              <span>Offene Einladungen</span>
              <span className="group-invitations-badge">{invitations.length}</span>
            </div>
            <ul className="group-invitations-list">
              {invitations.map((inv) => {
                const busy = !!invBusy[inv.group_id];
                return (
                  <li key={inv.id} className="group-invitation-row">
                    <AvatarBadge
                      name={inv.group_name}
                      color={inv.group_color || '#007AFF'}
                      avatarUrl={inv.group_image_url}
                      size={36}
                    />
                    <div className="group-invitation-info">
                      <strong>{inv.group_name}</strong>
                      <small>
                        {inv.invited_by_name
                          ? `${inv.invited_by_name} hat dich eingeladen`
                          : 'Du wurdest eingeladen'}
                      </small>
                    </div>
                    <div className="group-invitation-actions">
                      <button
                        type="button"
                        className="group-invitation-btn is-accept"
                        disabled={busy}
                        onClick={() => handleInvitation(inv.group_id, 'accept')}
                      >
                        <Check size={14} /> Annehmen
                      </button>
                      <button
                        type="button"
                        className="group-invitation-btn is-reject"
                        disabled={busy}
                        onClick={() => handleInvitation(inv.group_id, 'reject')}
                      >
                        <X size={14} /> Ablehnen
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Bento Quickview */}
        <div className="bq-groups-bento" aria-label="Team-Überblick">
          <article className="bq-groups-bento-card is-primary">
            <div className="bq-groups-bento-icon"><ListTodo size={16} /></div>
            <div className="bq-groups-bento-num">
              <strong>{bento.totalActive}</strong>
              <span>Team-Aufgaben</span>
            </div>
            <div className="bq-groups-bento-foot">
              <span className="bq-groups-bento-pulse" aria-hidden />
              {bento.totalToday > 0
                ? `${bento.totalToday} heute fällig`
                : 'Heute nichts dringend'}
            </div>
          </article>

          <article className="bq-groups-bento-card is-event">
            <div className="bq-groups-bento-icon"><CalendarClock size={16} /></div>
            <div className="bq-groups-bento-num">
              <strong className="bq-groups-bento-eventtitle" title={bento.earliest?.event?.title}>
                {bento.earliest ? bento.earliest.event.title : 'Kein Event'}
              </strong>
              <span>Nächstes Team-Event</span>
            </div>
            <div className="bq-groups-bento-foot">
              {bento.earliest
                ? `${formatEventWhen(bento.earliest.event._date)} · ${bento.earliest.group.name}`
                : 'Plane ein gemeinsames Event'}
            </div>
          </article>

          <article className="bq-groups-bento-card is-members">
            <div className="bq-groups-bento-icon"><Users size={16} /></div>
            <div className="bq-groups-bento-num">
              <strong>{bento.totalMembers}</strong>
              <span>Mitglieder gesamt</span>
            </div>
            <div className="bq-groups-bento-foot">
              {enrichedGroups.length > 0
                ? `verteilt auf ${enrichedGroups.length} ${enrichedGroups.length === 1 ? 'Gruppe' : 'Gruppen'}`
                : 'Lade Team-Member ein'}
            </div>
          </article>
        </div>

        {/* Quick Actions */}
        <div className="bq-groups-actions">
          <button className="bq-groups-action is-primary" onClick={onCreateClick}>
            <span className="bq-groups-action-ico"><Plus size={16} /></span>
            <span className="bq-groups-action-text">
              <strong>Neue Gruppe</strong>
              <small>Eigenen Team-Space starten</small>
            </span>
          </button>
          <button className="bq-groups-action" onClick={onJoinClick}>
            <span className="bq-groups-action-ico"><Hash size={16} /></span>
            <span className="bq-groups-action-text">
              <strong>Per Code beitreten</strong>
              <small>Einladung einlösen</small>
            </span>
          </button>
          <button className="bq-groups-action" onClick={onSearchGroupsClick}>
            <span className="bq-groups-action-ico"><Globe size={16} /></span>
            <span className="bq-groups-action-text">
              <strong>Öffentliche finden</strong>
              <small>Communities entdecken</small>
            </span>
          </button>
        </div>

        {/* Search */}
        {groups.length > 0 && (
          <div className="bq-groups-search">
            <Search size={16} aria-hidden />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Gruppe oder Rolle suchen..."
              aria-label="Gruppen durchsuchen"
            />
            {query && (
              <button
                type="button"
                className="bq-groups-search-clear"
                onClick={() => setQuery('')}
                aria-label="Suche leeren"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
      </section>

      {loading && groups.length === 0 ? (
        <GroupListLoadingSkeleton />
      ) : filteredGroups.length === 0 && groups.length > 0 ? (
        <div className="bq-groups-empty">
          <div className="bq-groups-empty-icon"><Search size={28} /></div>
          <h3>Keine Treffer</h3>
          <p>Versuche einen anderen Suchbegriff.</p>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="bq-groups-empty">
          <div className="bq-groups-empty-icon"><Users size={32} /></div>
          <h3>Noch keine Gruppen</h3>
          <p>Erstelle deinen ersten Team-Space oder tritt mit einem Code bei.</p>
          <button className="bq-groups-action is-primary" style={{ marginTop: 14 }} onClick={onCreateClick}>
            <span className="bq-groups-action-ico"><Plus size={16} /></span>
            <span className="bq-groups-action-text">
              <strong>Erste Gruppe anlegen</strong>
              <small>In 30 Sekunden startklar</small>
            </span>
          </button>
        </div>
      ) : (
        <div className="bq-groups-list">
          {filteredGroups.map((g, i) => {
            const roleConf = ROLE_CONFIG[g.role] || ROLE_CONFIG.member;
            const cardColor = g.color || '#007AFF';
            const RoleIcon = roleConf.icon || Users;
            const recentlyActive = g._activityRel &&
              /\b(Sekund|sekund|Minute|minut)/.test(g._activityRel);

            return (
              <motion.button
                key={g.id}
                type="button"
                className="bq-group-card"
                style={{ '--bq-g-color': cardColor }}
                onClick={() => onOpenGroup(g.id)}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.28, ease: 'easeOut' }}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.99 }}
                aria-label={`Gruppe ${g.name} öffnen`}
              >
                <span className="bq-group-card-bar" aria-hidden />

                <div className="bq-group-card-avatar-wrap">
                  <AvatarBadge
                    name={g.name}
                    color={cardColor}
                    avatarUrl={g.image_url}
                    size={56}
                  />
                  {recentlyActive && (
                    <span className="bq-group-card-livedot" aria-label="Gerade aktiv" />
                  )}
                </div>

                <div className="bq-group-card-main">
                  <div className="bq-group-card-row1">
                    <h3 className="bq-group-card-title">{g.name}</h3>
                    <span className="bq-group-card-role" style={{ color: roleConf.color }}>
                      <RoleIcon size={11} /> {roleConf.label}
                    </span>
                  </div>

                  <div className="bq-group-card-chips">
                    <span className="bq-group-card-chip">
                      <Users size={11} />
                      <strong>{g.member_count}</strong>
                      <em>{g.member_count === 1 ? 'Person' : 'Personen'}</em>
                    </span>
                    <span className="bq-group-card-chip">
                      <ListTodo size={11} />
                      <strong>{g.task_count}</strong>
                      <em>Einträge</em>
                    </span>
                    {g._tasksToday > 0 && (
                      <span className="bq-group-card-chip bq-group-card-chip-today">
                        <Sparkles size={11} />
                        <strong>{g._tasksToday}</strong>
                        <em>heute</em>
                      </span>
                    )}
                  </div>

                  {g._nextEvent ? (
                    <div className="bq-group-card-event">
                      <CalendarClock size={13} />
                      <span className="bq-group-card-event-title">{g._nextEvent.title}</span>
                      <span className="bq-group-card-event-when">{formatEventWhen(g._nextEvent._date)}</span>
                    </div>
                  ) : (
                    <div className="bq-group-card-event is-placeholder">
                      <Calendar size={13} />
                      <span>Kein anstehendes Team-Event</span>
                    </div>
                  )}

                  {g._activityRel && (
                    <div className="bq-group-card-activity">
                      <Activity size={11} />
                      <span>Zuletzt aktiv {g._activityRel}</span>
                    </div>
                  )}
                </div>

                <div className="bq-group-card-arrow" aria-hidden>
                  <ChevronRight size={18} />
                </div>
              </motion.button>
            );
          })}
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
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendQuery, setFriendQuery] = useState('');
  const [selectedFriendIds, setSelectedFriendIds] = useState([]);
  const addToast = useTaskStore((s) => s.addToast);

  useEffect(() => {
    let cancelled = false;
    setFriendsLoading(true);
    api.getFriends()
      .then((data) => {
        if (cancelled) return;
        const accepted = (data?.friends || []).filter((f) => f.status === 'accepted');
        setFriends(accepted);
      })
      .catch(() => { if (!cancelled) setFriends([]); })
      .finally(() => { if (!cancelled) setFriendsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filteredFriends = useMemo(() => {
    const q = friendQuery.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) =>
      (f.name || '').toLowerCase().includes(q) ||
      (f.email || '').toLowerCase().includes(q)
    );
  }, [friends, friendQuery]);

  const toggleFriend = (userId) => {
    setSelectedFriendIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const newGroup = await onCreate({ name: name.trim(), description: description.trim(), color, image_url: imageUrl });
      const newGroupId = newGroup?.id;
      if (newGroupId && selectedFriendIds.length > 0) {
        const results = await Promise.allSettled(
          selectedFriendIds.map((uid) => api.inviteGroupUser(newGroupId, uid))
        );
        const okCount = results.filter((r) => r.status === 'fulfilled').length;
        const failCount = results.length - okCount;
        if (okCount > 0) {
          addToast(`${okCount} Freund${okCount === 1 ? '' : 'e'} eingeladen`);
        }
        if (failCount > 0) {
          addToast(`${failCount} Einladung${failCount === 1 ? '' : 'en'} fehlgeschlagen`, 'error');
        }
      }
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

        <div className="task-edit-field">
          <label>
            Freunde direkt einladen (optional)
            {selectedFriendIds.length > 0 && (
              <span style={{ marginLeft: 8, opacity: 0.7, fontWeight: 400 }}>
                {selectedFriendIds.length} ausgewählt
              </span>
            )}
          </label>
          {friendsLoading ? (
            <div style={{ padding: '8px 0', opacity: 0.6, fontSize: 13 }}>Lade Freunde...</div>
          ) : friends.length === 0 ? (
            <div style={{ padding: '8px 0', opacity: 0.6, fontSize: 13 }}>
              Noch keine Freunde. Du kannst später Mitglieder einladen.
            </div>
          ) : (
            <>
              {friends.length > 5 && (
                <input
                  type="text"
                  value={friendQuery}
                  onChange={(e) => setFriendQuery(e.target.value)}
                  placeholder="Freunde durchsuchen..."
                  className="task-edit-input"
                  style={{ marginBottom: 8 }}
                />
              )}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  maxHeight: 220,
                  overflowY: 'auto',
                  border: '1px solid var(--border, rgba(0,0,0,0.08))',
                  borderRadius: 10,
                  padding: 6,
                }}
              >
                {filteredFriends.length === 0 ? (
                  <div style={{ padding: 8, opacity: 0.6, fontSize: 13 }}>Keine Treffer</div>
                ) : (
                  filteredFriends.map((f) => {
                    const uid = f.friend_user_id || f.id;
                    const checked = selectedFriendIds.includes(uid);
                    return (
                      <button
                        type="button"
                        key={uid}
                        onClick={() => toggleFriend(uid)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: 'none',
                          background: checked ? 'rgba(0,122,255,0.12)' : 'transparent',
                          cursor: 'pointer',
                          textAlign: 'left',
                          width: '100%',
                        }}
                      >
                        <AvatarBadge
                          name={f.name}
                          color={f.avatar_color || '#007AFF'}
                          avatarUrl={f.avatar_url}
                          size={32}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, fontSize: 14, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                          {f.email && (
                            <div style={{ fontSize: 12, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.email}</div>
                          )}
                        </div>
                        <span
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            border: `2px solid ${checked ? '#007AFF' : 'rgba(0,0,0,0.2)'}`,
                            background: checked ? '#007AFF' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            fontSize: 13,
                            flexShrink: 0,
                          }}
                        >
                          {checked ? <Check size={14} strokeWidth={3} /> : null}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
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
  const addToast = useTaskStore((s) => s.addToast);

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setError('');
    setJoining(true);
    try {
      const data = await onJoin(code.trim());
      addToast(data.message || 'Gruppe beigetreten');
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
    currentGroup, members, groupTasks, myRole, subgroups, loading,
    fetchGroup, addGroupTask, changeMemberRole, removeMember, deleteGroup, updateGroup,
    updateGroupPermissions,
  } = useGroupStore();
  const { user } = useAuthStore();
  const addToast = useTaskStore((s) => s.addToast);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const restoreDismissedTask = useTaskStore((s) => s.restoreDismissedTask);
  const [tab, setTab] = useState('tasks'); // 'tasks' | 'members' | 'settings'
  const [showAddTask, setShowAddTask] = useState(false);
  const [copied, setCopied] = useState(false);
  const [visibleCount, setVisibleCount] = useState(15);
  const [showPastGroupTasks, setShowPastGroupTasks] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissedTasks, setDismissedTasks] = useState([]);
  const [dismissedLoading, setDismissedLoading] = useState(false);
  const [restoringId, setRestoringId] = useState(null);
  // Invite user state (admin only)
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState([]);
  const [inviteSearchLoading, setInviteSearchLoading] = useState(false);
  const [inviteSending, setInviteSending] = useState({});
  // Join requests state (admin only)
  const [joinRequests, setJoinRequests] = useState([]);
  const [handlingReq, setHandlingReq] = useState({});

  // Derived role flags — must be declared BEFORE any useEffect that uses them
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';

  // Effektive Berechtigungen für den aktuellen User in dieser Gruppe.
  // Owner/Admin = alle true. Member: Custom-Rolle falls zugewiesen, sonst
  // group.member_permissions, sonst Defaults. Genauso wie der Server rechnet.
  const myPerms = useMemo(() => {
    const all = {
      create_tasks: true, edit_own_tasks: true, manage_notes: true, chat: true,
      invite: true, create_categories: true, create_subgroups: true,
    };
    const defaults = {
      create_tasks: true, edit_own_tasks: true, manage_notes: true, chat: true,
      invite: false, create_categories: false, create_subgroups: false,
    };
    if (isAdmin) return all;
    const me = (members || []).find((m) => String(m.user_id) === String(user?.id));
    const groupPerms = { ...defaults, ...(currentGroup?.member_permissions || {}) };
    if (me?.custom_role_id && Array.isArray(currentGroup?.custom_roles)) {
      const role = currentGroup.custom_roles.find((r) => r.id === me.custom_role_id);
      if (role && role.permissions) return { ...defaults, ...role.permissions };
    }
    return groupPerms;
  }, [isAdmin, members, user?.id, currentGroup?.member_permissions, currentGroup?.custom_roles]);
  const can = (key) => isAdmin || !!myPerms[key];

  useEffect(() => { fetchGroup(groupId); }, [groupId]);
  useEffect(() => { setVisibleCount(15); }, [tab]);

  useEffect(() => {
    if (tab !== 'members' || !isAdmin) return;
    api.getGroupJoinRequests(groupId)
      .then((data) => setJoinRequests(data.requests || []))
      .catch(() => setJoinRequests([]));
  }, [tab, groupId, isAdmin]);

  const loadDismissed = async (silent = false) => {
    if (!silent) setDismissedLoading(true);
    try {
      const data = await api.getGroupDismissedTasks(groupId);
      setDismissedTasks(data.tasks || []);
    } catch (err) {
      if (!silent) addToast(err.message || 'Konnte entfernte Aufgaben nicht laden', 'error');
      setDismissedTasks([]);
    } finally {
      if (!silent) setDismissedLoading(false);
    }
  };

  // Dismissed-IDs werden immer geladen, damit "Einträge" sie ausblendet.
  useEffect(() => {
    if (tab === 'tasks') loadDismissed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, groupId]);

  // Reagiere auf optimistische Dismiss/Delete-Events aus taskStore:
  //  - mode='dismiss': Task in lokale Liste aufnehmen, damit sie sofort in "Entfernte" erscheint.
  //  - mode='full' oder Owner-Delete: Task aus dismissed-Liste entfernen.
  useEffect(() => {
    const onRemoved = (e) => {
      const { taskId, task, mode } = e.detail || {};
      if (taskId === undefined || taskId === null) return;
      const idStr = String(taskId);
      if (mode === 'dismiss' && task) {
        setDismissedTasks((prev) => {
          if (prev.some((t) => String(t.id) === idStr)) return prev;
          return [{ ...task, dismissed_at: new Date().toISOString() }, ...prev];
        });
      } else if (mode === 'full' || mode === null) {
        setDismissedTasks((prev) => prev.filter((t) => String(t.id) !== idStr));
      }
    };
    const onRestored = () => {
      // Nach Undo: Server-Wahrheit holen
      loadDismissed(true);
      fetchGroup(groupId);
    };
    window.addEventListener('beequ:task-removed', onRemoved);
    window.addEventListener('beequ:task-restored', onRestored);
    return () => {
      window.removeEventListener('beequ:task-removed', onRemoved);
      window.removeEventListener('beequ:task-restored', onRestored);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const handleRestoreDismissed = async (taskId) => {
    setRestoringId(taskId);
    const ok = await restoreDismissedTask(taskId);
    if (ok) {
      setDismissedTasks((prev) => prev.filter((t) => String(t.id) !== String(taskId)));
      fetchGroup(groupId);
      fetchTasks(...DASHBOARD_REFRESH_PARAMS);
    }
    setRestoringId(null);
  };

  const dismissedIdSet = useMemo(
    () => new Set(dismissedTasks.map((t) => String(t.id))),
    [dismissedTasks]
  );

  const searchInviteUsers = async () => {
    const q = inviteQuery.trim();
    if (!q) return;
    setInviteSearchLoading(true);
    try {
      const data = await api.searchGroupUsers(groupId, q);
      setInviteResults(data.users || []);
    } catch {
      setInviteResults([]);
    } finally {
      setInviteSearchLoading(false);
    }
  };

  const handleInviteUser = async (userId) => {
    setInviteSending((prev) => ({ ...prev, [userId]: true }));
    try {
      await api.inviteGroupUser(groupId, userId);
      addToast('Einladung gesendet');
      setInviteResults((prev) => prev.filter((u) => u.id !== userId));
      fetchGroup(groupId);
    } catch (err) {
      addToast(err.message || 'Fehler', 'error');
    } finally {
      setInviteSending((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const handleJoinRequest = async (requestId, action) => {
    setHandlingReq((prev) => ({ ...prev, [requestId]: action }));
    try {
      await api.handleGroupJoinRequest(groupId, requestId, action);
      setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
      if (action === 'accept') {
        fetchGroup(groupId);
        addToast('Mitglied aufgenommen');
      } else {
        addToast('Anfrage abgelehnt');
      }
    } catch (err) {
      addToast(err.message || 'Fehler', 'error');
    } finally {
      setHandlingReq((prev) => ({ ...prev, [requestId]: null }));
    }
  };

  const copyCode = () => {
    if (!currentGroup?.invite_code) return;
    navigator.clipboard.writeText(currentGroup.invite_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const visibleGroupTasks = useMemo(
    () => groupTasks.filter((t) => !dismissedIdSet.has(String(t.id))),
    [groupTasks, dismissedIdSet]
  );
  // Aktive Aufgaben: nach naechstem Datum/Zeit aufsteigend ("Naechste zuerst")
  // Vergangene/Erledigte: nach Datum absteigend (Neueste zuerst)
  const sortAsc = (a, b) => {
    const da = String(a.date || '9999-12-31');
    const db = String(b.date || '9999-12-31');
    if (da !== db) return da < db ? -1 : 1;
    const ta = String(a.time || '99:99');
    const tb = String(b.time || '99:99');
    if (ta !== tb) return ta < tb ? -1 : 1;
    const pri = { urgent: 0, high: 1, medium: 2, low: 3 };
    return (pri[a.priority] ?? 2) - (pri[b.priority] ?? 2);
  };
  const sortDesc = (a, b) => -sortAsc(a, b);
  const activeTasks = useMemo(
    () => visibleGroupTasks.filter((t) => !t.completed && !isEventEnded(t)).slice().sort(sortAsc),
    [visibleGroupTasks]
  );
  const pastTasks = useMemo(
    () => visibleGroupTasks.filter((t) => t.completed || isEventEnded(t)).slice().sort(sortDesc),
    [visibleGroupTasks]
  );
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
  const hasMoreActive = visibleCount < filteredActiveTasks.length;
  const isExpandedActive = !hasMoreActive && filteredActiveTasks.length > 15;
  const toggleActiveExpanded = () => {
    setVisibleCount((prev) => (prev < filteredActiveTasks.length ? filteredActiveTasks.length : 15));
  };
  const completionRate = visibleGroupTasks.length > 0 ? Math.round((pastTasks.length / visibleGroupTasks.length) * 100) : 0;
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

  if (loading || !currentGroup || String(currentGroup.id) !== String(groupId)) {
    return <GroupDetailLoadingSkeleton onBack={onBack} />;
  }

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
            {(() => {
              const RoleIcon = ROLE_CONFIG[myRole]?.icon || Users;
              return (
                <span className={`group-role-chip role-${myRole}`}>
                  <RoleIcon size={12} strokeWidth={2.4} />
                  {ROLE_CONFIG[myRole]?.label || 'Mitglied'}
                </span>
              );
            })()}
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

      {/* Invite Code — nur für Admins/Owner sichtbar */}
      {isAdmin && (
        <div className="group-invite-row">
          <span className="group-invite-label">Einladungscode:</span>
          <code className="group-invite-code">{currentGroup.invite_code}</code>
          <button className="group-invite-copy" onClick={copyCode}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Kopiert!' : 'Kopieren'}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="group-tabs">
        <button className={`group-tab ${tab === 'tasks' ? 'active' : ''}`} onClick={() => setTab('tasks')}>
          Einträge <span className="group-tab-count">{visibleGroupTasks.length}</span>
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
            <button
              className={`group-add-task-btn${showDismissed ? ' active' : ''}`}
              onClick={() => setShowDismissed((v) => !v)}
              title="Aus dem Kalender entfernte Aufgaben anzeigen"
              style={{ background: showDismissed ? 'var(--bg-tertiary)' : undefined }}
            >
              <EyeOff size={16} /> Entfernte
            </button>
            <button
              className="group-add-task-btn"
              onClick={() => can('create_tasks') ? setShowAddTask(true) : addToast('Einträge erstellen ist für deine Rolle gesperrt')}
              disabled={!can('create_tasks')}
              title={can('create_tasks') ? 'Eintrag hinzufügen' : 'Für deine Rolle gesperrt'}
              style={!can('create_tasks') ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
            >
              {can('create_tasks') ? <Plus size={16} /> : <Shield size={14} />} Eintrag hinzufügen
            </button>
          </div>

          {visibleGroupTasks.length === 0 ? (
            <div className="group-empty-tab">
              {groupTasks.length === 0
                ? 'Noch keine Einträge in dieser Gruppe'
                : 'Du hast alle Einträge aus deinem Kalender entfernt – wähle „Entfernte", um sie wiederherzustellen.'}
            </div>
          ) : (
            <div className="group-task-list dash-section-list">
              {filteredActiveTasks.slice(0, visibleCount).map((task, index) => (
                <TaskCard
                  key={task.id}
                  task={{
                    ...task,
                    group_id: task.group_id || currentGroup?.id,
                    group_name: task.group_name || currentGroup?.name,
                    group_color: task.group_color || currentGroup?.color,
                    group_image_url: task.group_image_url || currentGroup?.image_url,
                  }}
                  index={index}
                  showDashboardDateTile
                  showSharedInfo={false}
                />
              ))}
              {filteredActiveTasks.length > 15 && (
                <button
                  className={`dash-section-expander ${isExpandedActive ? 'expanded' : ''}`}
                  onClick={toggleActiveExpanded}
                >
                  <span className="dash-section-expander-line" aria-hidden />
                  <span className="dash-section-expander-copy">
                    <ChevronsDown size={14} className="dash-section-expander-icon" />
                    {hasMoreActive
                      ? `Mehr anzeigen (${filteredActiveTasks.length - visibleCount} weitere)`
                      : 'Weniger anzeigen'}
                  </span>
                  <span className="dash-section-expander-line" aria-hidden />
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
                  {showPastGroupTasks && (
                    <div className="group-task-list dash-section-list dash-section-completed">
                      {filteredPastTasks.map((task, index) => (
                        <TaskCard
                          key={task.id}
                          task={{
                            ...task,
                            group_id: task.group_id || currentGroup?.id,
                            group_name: task.group_name || currentGroup?.name,
                            group_color: task.group_color || currentGroup?.color,
                            group_image_url: task.group_image_url || currentGroup?.image_url,
                          }}
                          index={index}
                          disableLayout
                          showDashboardDateTile
                          showSharedInfo={false}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {showDismissed && (
            <div className="group-past-section" style={{ marginTop: 16 }}>
              <div className="group-past-toggle" style={{ cursor: 'default' }}>
                <span>
                  <EyeOff size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  Aus deinem Kalender entfernt ({dismissedTasks.length})
                </span>
                {dismissedLoading && <span style={{ fontSize: 12, opacity: 0.6 }}>Lädt…</span>}
              </div>
              {!dismissedLoading && dismissedTasks.length === 0 && (
                <div className="group-empty-tab" style={{ padding: 16 }}>
                  Keine entfernten Aufgaben aus dieser Gruppe.
                </div>
              )}
              {dismissedTasks.length > 0 && (
                <div className="group-task-list dash-section-list dash-section-completed">
                  {dismissedTasks.map((task) => (
                    <div
                      key={`dismissed-${task.id}`}
                      className="group-join-request-row"
                      style={{ alignItems: 'center' }}
                    >
                      <div
                        className="group-join-request-info"
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        <span
                          className="group-join-request-name"
                          style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        >
                          {task.title}
                        </span>
                        <p
                          className="group-join-request-msg"
                          style={{ marginTop: 2, fontSize: 12, opacity: 0.7 }}
                        >
                          {task.date ? new Date(task.date).toLocaleDateString('de-DE') : 'Kein Datum'}
                          {task.group_category_name ? ` · ${task.group_category_name}` : ''}
                        </p>
                      </div>
                      <div className="group-join-request-actions">
                        <button
                          className="group-join-req-accept"
                          disabled={restoringId === task.id}
                          onClick={() => handleRestoreDismissed(task.id)}
                          title="Wieder in deinen Kalender aufnehmen"
                        >
                          <RotateCcw size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                          {restoringId === task.id ? '...' : 'Wiederherstellen'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {showAddTask && (
            <AddGroupTask
              groupId={groupId}
              subgroups={subgroups}
              members={members}
              onClose={() => setShowAddTask(false)}
              onAdd={async (task) => {
                await addGroupTask(groupId, task);
                addToast(`${task.type === 'event' ? 'Termin' : 'Aufgabe'} zur Gruppe hinzugefügt`);
                setShowAddTask(false);
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

          {/* Pending join requests (admin only) */}
          {isAdmin && joinRequests.length > 0 && (
            <div className="group-join-requests-panel">
              <div className="group-join-requests-header">
                <Bell size={14} />
                <span>Beitrittsanfragen</span>
                <span className="group-join-requests-badge">{joinRequests.length}</span>
              </div>
              {joinRequests.map((req) => (
                <div key={req.id} className="group-join-request-row">
                  <AvatarBadge
                    name={req.user_name}
                    color={req.user_color || '#007AFF'}
                    avatarUrl={req.user_avatar_url}
                    size={36}
                  />
                  <div className="group-join-request-info">
                    <span className="group-join-request-name">{req.user_name}</span>
                    {req.message && <p className="group-join-request-msg">{req.message}</p>}
                  </div>
                  <div className="group-join-request-actions">
                    <button
                      className="group-join-req-accept"
                      disabled={!!handlingReq[req.id]}
                      onClick={() => handleJoinRequest(req.id, 'accept')}
                    >
                      {handlingReq[req.id] === 'accept' ? '...' : 'Aufnehmen'}
                    </button>
                    <button
                      className="group-join-req-reject"
                      disabled={!!handlingReq[req.id]}
                      onClick={() => handleJoinRequest(req.id, 'reject')}
                    >
                      {handlingReq[req.id] === 'reject' ? '...' : 'Ablehnen'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Invite user panel (admin oder member mit invite-recht) */}
          {can('invite') && (
            <div className="group-invite-user-section">
              <button
                className="group-invite-user-toggle-btn"
                onClick={() => { setShowInvitePanel((v) => !v); setInviteResults([]); setInviteQuery(''); }}
              >
                <UserPlus size={15} />
                Nutzer einladen
                <ChevronDown size={13} style={{ transform: showInvitePanel ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
              </button>
              <AnimatePresence>
                {showInvitePanel && (
                  <motion.div
                    className="group-invite-user-panel"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="group-invite-search-row">
                      <input
                        className="group-invite-search-input"
                        value={inviteQuery}
                        onChange={(e) => setInviteQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && searchInviteUsers()}
                        placeholder="Name suchen..."
                      />
                      <button
                        className="group-invite-search-btn"
                        onClick={searchInviteUsers}
                        disabled={inviteSearchLoading}
                      >
                        {inviteSearchLoading ? '...' : <Search size={15} />}
                      </button>
                    </div>
                    {inviteResults.length === 0 && inviteQuery.trim() && !inviteSearchLoading && (
                      <p className="group-invite-no-results">Keine Nutzer gefunden</p>
                    )}
                    {inviteResults.map((u) => (
                      <div key={u.id} className="group-invite-user-row">
                        <AvatarBadge
                          name={u.name}
                          color={u.avatar_color || '#007AFF'}
                          avatarUrl={u.avatar_url}
                          size={34}
                        />
                        <span className="group-invite-user-name">{u.name}</span>
                        <button
                          className="group-invite-user-btn"
                          onClick={() => handleInviteUser(u.id)}
                          disabled={inviteSending[u.id]}
                        >
                          {inviteSending[u.id] ? '...' : <><UserPlus size={13} /> Hinzufügen</>}
                        </button>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Untergruppen-Übersicht — für ALLE Mitglieder sichtbar (read-only) */}
          {Array.isArray(subgroups) && subgroups.length > 0 && (
            <div className="group-subgroups-overview" style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 12,
              marginBottom: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Users size={14} style={{ color: 'var(--text-secondary)' }} />
                <strong style={{ fontSize: 13 }}>Untergruppen</strong>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                  {isAdmin ? 'Bearbeiten unter Einstellungen' : 'Nur Admins können bearbeiten'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {subgroups.map((sg) => {
                  const sgMembers = Array.isArray(sg.members) ? sg.members : [];
                  const youAreIn = sgMembers.some((sgm) => String(sgm.user_id) === String(user?.id));
                  return (
                    <div key={sg.id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 10,
                      background: youAreIn ? `${sg.color || '#007AFF'}12` : 'var(--bg-tertiary)',
                      border: youAreIn ? `1px solid ${sg.color || '#007AFF'}55` : '1px solid transparent',
                    }}>
                      <span style={{
                        width: 10, height: 10, borderRadius: '50%',
                        background: sg.color || '#007AFF', flexShrink: 0,
                      }} />
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{sg.name}</span>
                      {youAreIn && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                          color: sg.color || '#007AFF',
                          background: `${sg.color || '#007AFF'}22`,
                          padding: '2px 6px', borderRadius: 6, letterSpacing: 0.3,
                        }}>Du</span>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', flexWrap: 'wrap' }}>
                        {sgMembers.slice(0, 6).map((sgm) => (
                          <AvatarBadge
                            key={sgm.user_id}
                            name={sgm.name}
                            color={sgm.avatar_color || '#007AFF'}
                            avatarUrl={sgm.avatar_url}
                            size={22}
                            title={sgm.name}
                          />
                        ))}
                        {sgMembers.length > 6 && (
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                            +{sgMembers.length - 6}
                          </span>
                        )}
                        {sgMembers.length === 0 && (
                          <span style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--text-tertiary)' }}>
                            Alle Mitglieder
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {sortedMembers.map((m) => {
            const RoleIcon = ROLE_CONFIG[m.role]?.icon || Users;
            const canOwnerManageRole = isAdmin && m.user_id !== user?.id && m.role !== 'owner';
            const canRemoveMember = (
              (isAdmin && m.user_id !== user?.id && m.role !== 'owner')
            );
            const memberSubgroups = (subgroups || []).filter((sg) =>
              Array.isArray(sg.members) && sg.members.some((sgm) => String(sgm.user_id) === String(m.user_id))
            );
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
                  {isAdmin && m.role === 'member' && Array.isArray(currentGroup?.custom_roles) && currentGroup.custom_roles.length > 0 && (
                    <MemberCustomRoleSelect
                      groupId={groupId}
                      member={m}
                      roles={currentGroup.custom_roles}
                    />
                  )}
                  {memberSubgroups.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                      {memberSubgroups.map((sg) => (
                        <span
                          key={sg.id}
                          title={`Untergruppe: ${sg.name}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 999,
                            color: sg.color || '#007AFF',
                            background: `${sg.color || '#007AFF'}1a`,
                            border: `1px solid ${sg.color || '#007AFF'}55`,
                          }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: sg.color || '#007AFF' }} />
                          {sg.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {(canOwnerManageRole || canRemoveMember) && (
                  <div className="group-member-actions">
                    {canOwnerManageRole && (
                      <>
                        <button
                          className={`group-member-action-btn role ${m.role === 'admin' ? 'active' : ''}`}
                          onClick={() => {
                            changeMemberRole(groupId, m.user_id, 'admin');
                            addToast('Rolle auf Admin gesetzt');
                          }}
                          title="Als Admin setzen"
                        >
                          <Shield size={13} /> Admin
                        </button>
                        <button
                          className={`group-member-action-btn role ${m.role === 'member' ? 'active' : ''}`}
                          onClick={() => {
                            changeMemberRole(groupId, m.user_id, 'member');
                            addToast('Rolle auf Mitglied gesetzt');
                          }}
                          title="Als Mitglied setzen"
                        >
                          <Users size={13} /> Mitglied
                        </button>
                      </>
                    )}
                    {canRemoveMember && (
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
                    )}
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
          <div className="gs-page-header">
            <div className="gs-page-header-icon">
              <Settings size={18} />
            </div>
            <div>
              <h3 className="gs-page-title">Gruppeneinstellungen</h3>
              <p className="gs-page-sub">Branding, Kategorien und sensible Aktionen</p>
            </div>
          </div>
          <div className="group-settings-layout">
            <div style={{ gridColumn: '1 / -1' }}>
              <SubgroupManager groupId={groupId} members={members} subgroups={subgroups} onRefresh={() => fetchGroup(groupId)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <GroupCustomRolesPanel
                groupId={groupId}
                currentGroup={currentGroup}
              />
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
          </div>
        </>
      )}
    </motion.div>
  );
}

// ============================================
// Add Task to Group (Quick Form)
// ============================================
function AddGroupTask({ groupId, onClose, onAdd, subgroups = [], members = [] }) {
  const [type, setType] = useState('task');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [priority, setPriority] = useState('medium');
  const [groupCategories, setGroupCategories] = useState([]);
  const [groupCategoryId, setGroupCategoryId] = useState('');
  const [enableGroupRsvp, setEnableGroupRsvp] = useState(false);
  const [subgroupId, setSubgroupId] = useState('');
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
        enable_group_rsvp: enableGroupRsvp === true,
        subgroup_id: subgroupId || null,
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

        {subgroups.length > 0 && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Users size={12} /> Sichtbar für
            </label>
            <select value={subgroupId} onChange={(e) => setSubgroupId(e.target.value)} className="task-edit-input">
              <option value="">Alle Mitglieder</option>
              {subgroups.map((sg) => {
                const sgMembers = Array.isArray(sg.members) ? sg.members : [];
                return (
                  <option key={sg.id} value={sg.id}>
                    {sg.name} ({sgMembers.length} {sgMembers.length === 1 ? 'Person' : 'Personen'})
                  </option>
                );
              })}
            </select>
            {subgroupId && (() => {
              const sg = subgroups.find((s) => String(s.id) === String(subgroupId));
              const sgMembers = Array.isArray(sg?.members) ? sg.members : [];
              return sgMembers.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {sgMembers.map((m) => (
                    <AvatarBadge key={m.user_id} name={m.name} color={m.avatar_color || '#007AFF'} avatarUrl={m.avatar_url} size={28} title={m.name} />
                  ))}
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    Nur diese {sgMembers.length} {sgMembers.length === 1 ? 'Person' : 'Personen'} sehen diesen Eintrag
                  </span>
                </div>
              ) : null;
            })()}
          </div>
        )}

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

        <button type="submit" className="group-submit-btn" disabled={!title.trim() || saving}>
          {saving ? 'Hinzufügen...' : `${type === 'event' ? 'Termin' : 'Aufgabe'} zur Gruppe hinzufügen`}
        </button>
      </motion.form>
    </motion.div>
  );
}

// ============================================
// Search Groups (public group discovery)
// ============================================
function SearchGroups({ onBack }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [requestMsg, setRequestMsg] = useState({});
  const [sending, setSending] = useState({});
  const addToast = useTaskStore((s) => s.addToast);

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setSearched(true);
    try {
      const data = await api.searchGroups(q);
      setResults(data.groups || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const sendRequest = async (groupId) => {
    setSending((prev) => ({ ...prev, [groupId]: true }));
    try {
      await api.sendGroupJoinRequest(groupId, requestMsg[groupId] || '');
      setResults((prev) =>
        prev.map((g) => g.id === groupId ? { ...g, my_request_status: 'pending' } : g)
      );
      addToast('Beitrittsanfrage gesendet');
    } catch (err) {
      addToast(err.message || 'Fehler', 'error');
    } finally {
      setSending((prev) => ({ ...prev, [groupId]: false }));
    }
  };

  const clearQuery = () => {
    setQuery('');
    setResults([]);
    setSearched(false);
  };

  return (
    <motion.div
      className="gs-discover"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.22 }}
    >
      <div className="gs-discover-topbar">
        <button className="gs-discover-back" onClick={onBack} aria-label="Zurück">
          <ArrowLeft size={20} />
        </button>
        <div className="gs-discover-topbar-title">Gruppen entdecken</div>
        <div className="gs-discover-topbar-spacer" />
      </div>

      <div className="gs-discover-hero">
        <div className="gs-discover-hero-icon"><Globe size={26} /></div>
        <h1 className="gs-discover-hero-title">Öffentliche Gruppen finden</h1>
        <p className="gs-discover-hero-sub">
          Suche nach Gruppen, die zu dir passen und sende dem Admin eine Beitrittsanfrage.
        </p>
      </div>

      <div className="gs-discover-searchbar">
        <Search size={18} className="gs-discover-searchbar-icon" />
        <input
          className="gs-discover-searchbar-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder="Gruppenname eingeben…"
          autoFocus
        />
        {query && (
          <button className="gs-discover-searchbar-clear" onClick={clearQuery} aria-label="Leeren">
            <X size={14} />
          </button>
        )}
        <button
          className="gs-discover-searchbar-cta"
          onClick={doSearch}
          disabled={loading || !query.trim()}
        >
          {loading ? <span className="gs-discover-spinner" /> : 'Suchen'}
        </button>
      </div>

      {loading && (
        <div className="gs-discover-skeletons">
          {[0, 1, 2].map((i) => (
            <div key={i} className="gs-discover-skeleton" />
          ))}
        </div>
      )}

      {!loading && !searched && (
        <div className="gs-discover-placeholder">
          <div className="gs-discover-placeholder-icon"><Search size={22} /></div>
          <p>Tippe einen Gruppennamen ein, um öffentliche Gruppen zu durchsuchen.</p>
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="gs-discover-empty">
          <div className="gs-discover-empty-icon"><Globe size={26} /></div>
          <h3>Keine Treffer</h3>
          <p>Keine öffentlichen Gruppen mit diesem Namen gefunden.</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="gs-discover-results">
          <div className="gs-discover-results-head">
            <span>{results.length} {results.length === 1 ? 'Treffer' : 'Treffer'}</span>
          </div>

          {results.map((g) => {
            const isMember = !!g.already_member;
            const isPending = g.my_request_status === 'pending';
            const isRejected = g.my_request_status === 'rejected';
            const canRequest = !isMember && !isPending && !isRejected;
            const isSending = !!sending[g.id];

            return (
              <div key={g.id} className="gs-discover-card">
                <div className="gs-discover-card-main">
                  <AvatarBadge
                    name={g.name}
                    color={g.color || '#007AFF'}
                    avatarUrl={g.image_url}
                    size={48}
                  />
                  <div className="gs-discover-card-info">
                    <div className="gs-discover-card-name">{g.name}</div>
                    {g.description && (
                      <div className="gs-discover-card-desc">{g.description}</div>
                    )}
                    <div className="gs-discover-card-meta">
                      <span className="gs-discover-card-chip">
                        <Users size={12} />
                        {g.member_count} Mitglied{g.member_count === 1 ? '' : 'er'}
                      </span>
                      <span className="gs-discover-card-chip subtle">
                        <Globe size={12} /> Öffentlich
                      </span>
                    </div>
                  </div>

                  <div className="gs-discover-card-status">
                    {isMember && (
                      <span className="gs-discover-status ok">
                        <Check size={14} /> Mitglied
                      </span>
                    )}
                    {isPending && (
                      <span className="gs-discover-status pending">
                        <Clock size={14} /> Anfrage offen
                      </span>
                    )}
                    {isRejected && (
                      <span className="gs-discover-status rejected">
                        <X size={14} /> Abgelehnt
                      </span>
                    )}
                  </div>
                </div>

                {canRequest && (
                  <div className="gs-discover-card-request">
                    <input
                      className="gs-discover-card-msg"
                      placeholder="Kurze Nachricht an den Admin (optional)"
                      value={requestMsg[g.id] || ''}
                      onChange={(e) => setRequestMsg((prev) => ({ ...prev, [g.id]: e.target.value }))}
                      maxLength={200}
                    />
                    <button
                      className="gs-discover-card-join"
                      onClick={() => sendRequest(g.id)}
                      disabled={isSending}
                    >
                      {isSending ? (
                        <span className="gs-discover-spinner" />
                      ) : (
                        <>
                          <UserPlus size={14} /> Beitreten
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

// ============================================
// Subgroup Manager
// ============================================
function SubgroupManager({ groupId, members, subgroups, onRefresh }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#007AFF');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#007AFF');
  const [editMembers, setEditMembers] = useState([]);
  const [editSaving, setEditSaving] = useState(false);

  const toggleMember = (userId) => {
    setSelectedMembers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };
  const toggleEditMember = (userId) => {
    setEditMembers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleCreate = async () => {
    const trimmed = String(name || '').trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await api.createGroupSubgroup(groupId, { name: trimmed, color, member_ids: selectedMembers });
      setName('');
      setColor('#007AFF');
      setSelectedMembers([]);
      setShowForm(false);
      onRefresh();
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (sg) => {
    setEditingId(sg.id);
    setEditName(sg.name || '');
    setEditColor(sg.color || '#007AFF');
    setEditMembers((Array.isArray(sg.members) ? sg.members : []).map((m) => m.user_id));
    setShowForm(false);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditColor('#007AFF');
    setEditMembers([]);
  };
  const handleSaveEdit = async () => {
    const trimmed = String(editName || '').trim();
    if (!trimmed || editSaving || !editingId) return;
    setEditSaving(true);
    try {
      await api.updateGroupSubgroup(groupId, editingId, {
        name: trimmed,
        color: editColor,
        member_ids: editMembers,
      });
      cancelEdit();
      onRefresh();
    } catch {
      /* ignore */
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (subgroupId) => {
    setDeletingId(subgroupId);
    try {
      await api.deleteGroupSubgroup(groupId, subgroupId);
      onRefresh();
    } catch {
      /* ignore */
    } finally {
      setDeletingId(null);
    }
  };

  const groupMembers = Array.isArray(members) ? members : [];

  const renderMemberPicker = (selected, onToggle) => (
    <div
      className="group-subgroup-member-picker"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 6,
        maxHeight: 220,
        overflowY: 'auto',
        padding: 4,
      }}
    >
      {groupMembers.map((m) => {
        const isSel = selected.includes(m.user_id);
        return (
          <label
            key={m.user_id}
            className={`group-subgroup-member-row ${isSel ? 'selected' : ''}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 10,
              border: isSel ? '1px solid var(--accent, #007AFF)' : '1px solid var(--border, rgba(120,120,128,0.25))',
              background: isSel ? 'rgba(0,122,255,0.12)' : 'transparent',
              cursor: 'pointer', transition: 'all 120ms ease',
            }}
          >
            <input
              type="checkbox"
              checked={isSel}
              onChange={() => onToggle(m.user_id)}
              style={{ display: 'none' }}
            />
            <AvatarBadge name={m.name} color={m.avatar_color || '#007AFF'} avatarUrl={m.avatar_url} size={26} />
            <span className="group-subgroup-member-name" style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
            <span
              className={`group-subgroup-check ${isSel ? 'on' : ''}`}
              style={{
                width: 18, height: 18, borderRadius: '50%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                border: isSel ? 'none' : '1px solid var(--border, rgba(120,120,128,0.35))',
                background: isSel ? 'var(--accent, #007AFF)' : 'transparent',
                color: '#fff', flexShrink: 0,
              }}
            >
              {isSel ? <Check size={12} /> : null}
            </span>
          </label>
        );
      })}
    </div>
  );

  const renderColorPresets = (value, onPick) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {ROLE_COLOR_PRESETS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          title={c}
          style={{
            width: 22, height: 22, borderRadius: '50%',
            background: c, cursor: 'pointer',
            border: value?.toLowerCase() === c.toLowerCase() ? '2px solid var(--text-primary, #fff)' : '2px solid transparent',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.2)',
            padding: 0,
          }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onPick(e.target.value)}
        style={{ width: 30, height: 22, border: 'none', borderRadius: 6, cursor: 'pointer', padding: 0, background: 'transparent' }}
        title="Eigene Farbe"
      />
    </div>
  );

  return (
    <div className="group-cat-manager">
      <div className="group-cat-manager-header">
        <h4>Untergruppen</h4>
        <button
          className="group-cat-add-btn"
          onClick={() => { setShowForm((v) => !v); if (editingId) cancelEdit(); }}
        >
          {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? 'Abbrechen' : 'Neue Untergruppe'}
        </button>
      </div>

      {showForm && (
        <div
          className="group-subgroup-form"
          style={{
            padding: 12, borderRadius: 12, marginBottom: 12,
            background: 'var(--bg-secondary, rgba(255,255,255,0.03))',
            border: '1px solid var(--border, rgba(120,120,128,0.2))',
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span
              style={{
                width: 14, height: 14, borderRadius: '50%',
                background: color, flexShrink: 0,
                boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
              }}
            />
            <input
              className="group-cat-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name der Untergruppe"
              style={{ flex: 1 }}
              autoFocus
            />
          </div>
          {renderColorPresets(color, setColor)}
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Mitglieder ({selectedMembers.length} ausgewählt)
            </p>
            {renderMemberPicker(selectedMembers, toggleMember)}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => { setShowForm(false); setName(''); setSelectedMembers([]); }}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: 'transparent', color: 'var(--text-secondary)',
                border: '1px solid var(--border, rgba(120,120,128,0.25))', cursor: 'pointer',
              }}
            >
              Abbrechen
            </button>
            <button
              className="group-cat-save-btn"
              onClick={handleCreate}
              disabled={!name.trim() || saving}
            >
              {saving ? 'Erstellen...' : 'Untergruppe erstellen'}
            </button>
          </div>
        </div>
      )}

      {subgroups.length === 0 && !showForm && (
        <p className="group-cat-empty">Noch keine Untergruppen. Erstelle eine, um Sichtbarkeit einzuschraenken.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {subgroups.map((sg) => {
          const sgMembers = Array.isArray(sg.members) ? sg.members : [];
          const isEditing = editingId === sg.id;
          if (isEditing) {
            return (
              <div
                key={sg.id}
                style={{
                  padding: 12, borderRadius: 12,
                  background: 'var(--bg-secondary, rgba(255,255,255,0.03))',
                  border: '1px solid var(--accent, #007AFF)',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span
                    style={{
                      width: 14, height: 14, borderRadius: '50%',
                      background: editColor, flexShrink: 0,
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
                    }}
                  />
                  <input
                    className="group-cat-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Name der Untergruppe"
                    style={{ flex: 1 }}
                    autoFocus
                  />
                </div>
                {renderColorPresets(editColor, setEditColor)}
                <div style={{ marginTop: 12 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Mitglieder ({editMembers.length} ausgewählt)
                  </p>
                  {renderMemberPicker(editMembers, toggleEditMember)}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    style={{
                      padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                      background: 'transparent', color: 'var(--text-secondary)',
                      border: '1px solid var(--border, rgba(120,120,128,0.25))', cursor: 'pointer',
                    }}
                  >
                    Abbrechen
                  </button>
                  <button
                    className="group-cat-save-btn"
                    onClick={handleSaveEdit}
                    disabled={!editName.trim() || editSaving}
                  >
                    {editSaving ? 'Speichern...' : 'Speichern'}
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div
              key={sg.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: 12,
                background: 'var(--bg-secondary, rgba(255,255,255,0.03))',
                border: '1px solid var(--border, rgba(120,120,128,0.18))',
                transition: 'border-color 120ms ease',
              }}
            >
              <span
                style={{
                  width: 12, height: 12, borderRadius: '50%',
                  background: sg.color || '#007AFF', flexShrink: 0,
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="group-cat-name" style={{ fontWeight: 600 }}>{sg.name}</span>
                  <span
                    style={{
                      fontSize: 11, color: 'var(--text-tertiary)',
                      padding: '2px 8px', borderRadius: 999,
                      background: 'var(--bg-tertiary, rgba(120,120,128,0.15))',
                    }}
                  >
                    {sgMembers.length === 0 ? 'Alle Mitglieder' : `${sgMembers.length} ${sgMembers.length === 1 ? 'Person' : 'Personen'}`}
                  </span>
                </div>
                {sgMembers.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {sgMembers.slice(0, 8).map((m) => (
                      <AvatarBadge key={m.user_id} name={m.name} color={m.avatar_color || '#007AFF'} avatarUrl={m.avatar_url} size={24} title={m.name} />
                    ))}
                    {sgMembers.length > 8 && (
                      <span
                        style={{
                          width: 24, height: 24, borderRadius: '50%',
                          background: 'var(--bg-tertiary, rgba(120,120,128,0.2))',
                          color: 'var(--text-secondary)',
                          fontSize: 11, fontWeight: 600,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        +{sgMembers.length - 8}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button
                  onClick={() => startEdit(sg)}
                  title="Untergruppe bearbeiten"
                  style={{
                    width: 32, height: 32, borderRadius: 8,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: 'transparent',
                    border: '1px solid var(--border, rgba(120,120,128,0.2))',
                    color: 'var(--text-secondary)', cursor: 'pointer',
                    transition: 'all 120ms ease',
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="group-cat-delete-btn"
                  onClick={() => handleDelete(sg.id)}
                  disabled={deletingId === sg.id}
                  title="Untergruppe löschen"
                  style={{
                    width: 32, height: 32, borderRadius: 8,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// Group Member-Permissions Panel (kompakt)
// + Custom-Rollen Manager
// ============================================
const PERMISSION_DEFS = [
  { key: 'create_tasks',      label: 'Tasks erstellen',     short: 'Tasks',     icon: ListTodo },
  { key: 'edit_own_tasks',    label: 'Eigene Tasks bearbeiten', short: 'Bearb.', icon: Pencil },
  { key: 'manage_notes',      label: 'Notizen verwalten',   short: 'Notizen',   icon: FileText },
  { key: 'chat',              label: 'Chat senden',         short: 'Chat',      icon: MessageCircle },
  { key: 'invite',            label: 'Mitglieder einladen', short: 'Einladen',  icon: UserPlus },
  { key: 'create_categories', label: 'Kategorien anlegen',  short: 'Kategorien', icon: Tag },
  { key: 'create_subgroups',  label: 'Untergruppen anlegen', short: 'Subgr.',   icon: Users },
];

const DEFAULT_PERMISSIONS_FALLBACK = {
  create_tasks: true,
  edit_own_tasks: true,
  manage_notes: true,
  chat: true,
  invite: false,
  create_categories: false,
  create_subgroups: false,
};

const ROLE_COLOR_PRESETS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#8E8E93'];

// Kompakte Permission-Pill (Icon + Kuerzel, toggle bei Klick)
function PermissionPill({ def, active, onToggle, disabled, size = 'md' }) {
  const Icon = def.icon;
  const dim = size === 'sm' ? { pad: '6px 9px', icon: 13, font: 11 } : { pad: '8px 11px', icon: 15, font: 12 };
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={def.label + (active ? ' (an)' : ' (aus)')}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: dim.pad, borderRadius: 999,
        border: active ? '1px solid var(--accent, #007AFF)' : '1px solid var(--border, rgba(120,120,128,0.25))',
        background: active ? 'rgba(0,122,255,0.14)' : 'transparent',
        color: active ? 'var(--accent, #007AFF)' : 'var(--text-secondary, #8E8E93)',
        fontSize: dim.font, fontWeight: 600,
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'all 140ms ease',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon size={dim.icon} />
      <span>{def.short}</span>
    </button>
  );
}

function GroupPermissionsPanel({ groupId, currentGroup }) {
  const updateGroupPermissions = useGroupStore((s) => s.updateGroupPermissions);
  const addToast = useTaskStore((s) => s.addToast);
  const initial = useMemo(() => ({
    ...DEFAULT_PERMISSIONS_FALLBACK,
    ...(currentGroup?.member_permissions || {}),
  }), [currentGroup?.member_permissions]);
  const [perms, setPerms] = useState(initial);
  const [saving, setSaving] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => { setPerms(initial); }, [initial]);

  const activeCount = Object.values(perms).filter(Boolean).length;

  const togglePerm = async (key) => {
    if (saving) return;
    const next = { ...perms, [key]: !perms[key] };
    setPerms(next);
    setSaving(key);
    try {
      await updateGroupPermissions(groupId, { [key]: next[key] });
    } catch (err) {
      setPerms(perms);
      addToast(err?.message || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div style={panelStyle}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          background: 'transparent', border: 'none', padding: 0,
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={iconBadgeStyle('rgba(0,122,255,0.12)', 'var(--accent, #007AFF)')}>
          <Shield size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Standard-Berechtigungen</div>
          <div style={{ fontSize: 11, opacity: 0.65, marginTop: 1 }}>
            {activeCount}/{PERMISSION_DEFS.length} aktiv &middot; gilt für Mitglieder ohne eigene Rolle
          </div>
        </div>
        <ChevronDown size={16} style={{
          transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
          transition: 'transform 180ms', opacity: 0.6,
        }} />
      </button>

      {expanded && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {PERMISSION_DEFS.map((def) => (
            <PermissionPill
              key={def.key}
              def={def}
              active={!!perms[def.key]}
              disabled={!!saving}
              onToggle={() => togglePerm(def.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupCustomRolesPanel({ groupId, currentGroup }) {
  const createCustomRole = useGroupStore((s) => s.createCustomRole);
  const updateCustomRole = useGroupStore((s) => s.updateCustomRole);
  const deleteCustomRole = useGroupStore((s) => s.deleteCustomRole);
  const updateGroupPermissions = useGroupStore((s) => s.updateGroupPermissions);
  const addToast = useTaskStore((s) => s.addToast);
  const roles = currentGroup?.custom_roles || [];
  const [expanded, setExpanded] = useState(true);
  const [editingId, setEditingId] = useState('__default__');
  const [creating, setCreating] = useState(false);

  // Synthetische "Standard"-Rolle aus group.member_permissions. Wird genau
  // wie eine Custom-Rolle dargestellt, ist aber nicht loeschbar/umbenennbar
  // und persistiert via PUT /permissions. Gilt für alle Member ohne
  // custom_role_id (siehe getEffectivePerms im Server).
  const defaultRole = {
    id: '__default__',
    name: 'Standard',
    color: '#8E8E93',
    permissions: { ...DEFAULT_PERMISSIONS_FALLBACK, ...(currentGroup?.member_permissions || {}) },
  };

  const handleCreate = async () => {
    try {
      const role = await createCustomRole(groupId, {
        name: `Rolle ${roles.length + 1}`,
        color: ROLE_COLOR_PRESETS[roles.length % ROLE_COLOR_PRESETS.length],
        permissions: { ...DEFAULT_PERMISSIONS_FALLBACK },
      });
      setEditingId(role.id);
      setExpanded(true);
    } catch (err) {
      addToast(err?.message || 'Anlegen fehlgeschlagen');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={panelStyle}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          background: 'transparent', border: 'none', padding: 0,
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={iconBadgeStyle('rgba(175,82,222,0.14)', '#AF52DE')}>
          <Crown size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Rollen &amp; Berechtigungen</div>
          <div style={{ fontSize: 11, opacity: 0.65, marginTop: 1 }}>
            1 Standard &middot; {roles.length} {roles.length === 1 ? 'eigene Rolle' : 'eigene Rollen'}
          </div>
        </div>
        <ChevronDown size={16} style={{
          transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
          transition: 'transform 180ms', opacity: 0.6,
        }} />
      </button>

      {expanded && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Standard-Rolle (synthetic) */}
          <CustomRoleRow
            role={defaultRole}
            expanded={editingId === '__default__'}
            onToggle={() => setEditingId(editingId === '__default__' ? null : '__default__')}
            onUpdate={async (data) => {
              // Nur Permissions persistieren; Name/Farbe sind fix.
              if (data && data.permissions) {
                await updateGroupPermissions(groupId, data.permissions);
              }
            }}
            onDelete={null}
            isDefault
          />
          {roles.length === 0 && (
            <div style={{
              fontSize: 12, opacity: 0.65, padding: '10px',
              background: 'var(--hover, rgba(120,120,128,0.06))',
              borderRadius: 10, textAlign: 'center',
            }}>
              Lege zusaetzlich eigene Rollen an, z.B. "Moderator", "Gast" oder "Editor". Mitglieder mit eigener Rolle ignorieren die Standardrechte.
            </div>
          )}
          {roles.map((role) => (
            <CustomRoleRow
              key={role.id}
              role={role}
              expanded={editingId === role.id}
              onToggle={() => setEditingId(editingId === role.id ? null : role.id)}
              onUpdate={(data) => updateCustomRole(groupId, role.id, data)}
              onDelete={async () => {
                if (!window.confirm(`Rolle "${role.name}" wirklich löschen? Zugewiesene Mitglieder fallen auf Standard zurück.`)) return;
                try {
                  await deleteCustomRole(groupId, role.id);
                  setEditingId(null);
                  addToast('Rolle gelöscht');
                } catch (err) {
                  addToast(err?.message || 'Löschen fehlgeschlagen');
                }
              }}
            />
          ))}
          <button
            type="button"
            onClick={() => { setCreating(true); handleCreate(); }}
            disabled={creating}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '10px 12px', borderRadius: 10,
              border: '1px dashed var(--border, rgba(120,120,128,0.35))',
              background: 'transparent', color: 'var(--accent, #007AFF)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Plus size={15} /> Neue Rolle
          </button>
        </div>
      )}
    </div>
  );
}

function CustomRoleRow({ role, expanded, onToggle, onUpdate, onDelete, isDefault = false }) {
  const addToast = useTaskStore((s) => s.addToast);
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  const [perms, setPerms] = useState({ ...DEFAULT_PERMISSIONS_FALLBACK, ...(role.permissions || {}) });
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    setName(role.name);
    setColor(role.color);
    setPerms({ ...DEFAULT_PERMISSIONS_FALLBACK, ...(role.permissions || {}) });
  }, [role.id, role.name, role.color, role.permissions]);

  const activeCount = Object.values(perms).filter(Boolean).length;

  const togglePerm = async (key) => {
    if (saving) return;
    const next = { ...perms, [key]: !perms[key] };
    setPerms(next);
    setSaving(key);
    try {
      await onUpdate({ name, color, permissions: next });
    } catch (err) {
      setPerms(perms);
      addToast(err?.message || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(null);
    }
  };

  const saveMeta = async () => {
    if (name === role.name && color === role.color) return;
    setSaving('meta');
    try {
      await onUpdate({ name, color, permissions: perms });
    } catch (err) {
      addToast(err?.message || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div style={{
      borderRadius: 12,
      background: 'var(--hover, rgba(120,120,128,0.06))',
      border: '1px solid var(--border, rgba(120,120,128,0.15))',
      overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '8px 10px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          width: 22, height: 22, borderRadius: '50%', background: role.color,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}>
          {isDefault ? <Shield size={12} /> : (role.name || '?').slice(0, 1).toUpperCase()}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {role.name}
        </span>
        {isDefault && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
            padding: '2px 7px', borderRadius: 999,
            background: 'rgba(0,122,255,0.14)', color: 'var(--accent, #007AFF)',
            textTransform: 'uppercase', flexShrink: 0,
          }}>Standard</span>
        )}
        <span style={{ fontSize: 11, opacity: 0.6 }}>{activeCount}/{PERMISSION_DEFS.length}</span>
        <ChevronDown size={14} style={{
          transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
          transition: 'transform 180ms', opacity: 0.5,
        }} />
      </button>

      {expanded && (
        <div style={{ padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!isDefault && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="text"
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveMeta}
                placeholder="Rollenname"
                style={{
                  flex: 1, minWidth: 0,
                  padding: '7px 10px', borderRadius: 8, fontSize: 13,
                  border: '1px solid var(--border, rgba(120,120,128,0.25))',
                  background: 'var(--surface, #fff)', color: 'var(--text, inherit)',
                }}
              />
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 180 }}>
                {ROLE_COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { setColor(c); onUpdate({ name, color: c, permissions: perms }).catch(() => {}); }}
                    aria-label={`Farbe ${c}`}
                    style={{
                      width: 18, height: 18, borderRadius: '50%', background: c,
                      border: color === c ? '2px solid var(--text, #000)' : '1px solid rgba(255,255,255,0.4)',
                      cursor: 'pointer', padding: 0,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          {isDefault && (
            <div style={{
              fontSize: 12, opacity: 0.7, padding: '6px 10px', borderRadius: 8,
              background: 'rgba(0,122,255,0.08)', color: 'var(--text-secondary, #555)',
              lineHeight: 1.45,
            }}>
              Diese Berechtigungen gelten für alle Mitglieder, die keine eigene Rolle zugewiesen bekommen.
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {PERMISSION_DEFS.map((def) => (
              <PermissionPill
                key={def.key}
                def={def}
                active={!!perms[def.key]}
                disabled={!!saving}
                onToggle={() => togglePerm(def.key)}
                size="sm"
              />
            ))}
          </div>
          {!isDefault && onDelete && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={onDelete}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '6px 10px', borderRadius: 8,
                  background: 'rgba(255,59,48,0.12)', color: '#FF3B30',
                  border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                <Trash2 size={12} /> Rolle löschen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Inline-Helpers
const panelStyle = {
  background: 'var(--surface, #fff)',
  border: '1px solid var(--border, rgba(120,120,128,0.18))',
  borderRadius: 14,
  padding: 12,
};
const iconBadgeStyle = (bg, color) => ({
  width: 30, height: 30, borderRadius: 9,
  background: bg, color,
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
});

// Compact custom-role assignment select in member rows
function MemberCustomRoleSelect({ groupId, member, roles }) {
  const assignCustomRole = useGroupStore((s) => s.assignCustomRole);
  const addToast = useTaskStore((s) => s.addToast);
  const currentId = member.custom_role_id || '';
  const currentRole = roles.find((r) => r.id === currentId);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      const inTrigger = wrapRef.current && wrapRef.current.contains(e.target);
      const inMenu = menuRef.current && menuRef.current.contains(e.target);
      if (!inTrigger && !inMenu) setOpen(false);
    };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  // Position des Portal-Menüs berechnen: oeffnet nach oben, wenn unten zu wenig Platz
  // (z.B. wenn das Chip direkt ueber der Bottom-Nav-Pille sitzt).
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) { setMenuPos(null); return; }
    const compute = () => {
      const rect = wrapRef.current.getBoundingClientRect();
      const menuH = (1 + roles.length) * 56 + 16; // grob: 56px pro Eintrag + Padding
      const reservedBottom = 96; // Bottom-Nav-Pille + Sicherheit
      const spaceBelow = window.innerHeight - rect.bottom - reservedBottom;
      const dropUp = spaceBelow < menuH && rect.top > menuH + 12;
      const minW = 200;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - minW - 8));
      if (dropUp) {
        setMenuPos({ left, bottom: window.innerHeight - rect.top + 6 });
      } else {
        setMenuPos({ left, top: rect.bottom + 6 });
      }
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, roles.length]);

  const choose = async (roleId) => {
    setOpen(false);
    if ((roleId || null) === (currentId || null)) return;
    setSaving(true);
    try {
      await assignCustomRole(groupId, member.user_id, roleId || null);
    } catch (err) {
      addToast(err?.message || 'Zuweisung fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const chipBg = currentRole ? `${currentRole.color}1a` : 'var(--hover, rgba(120,120,128,0.08))';
  const chipColor = currentRole ? currentRole.color : 'var(--text-secondary, #8E8E93)';
  const chipBorder = currentRole
    ? `1px solid ${currentRole.color}55`
    : '1px dashed var(--border, rgba(120,120,128,0.35))';

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-block', marginTop: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        title={currentRole ? `Rolle: ${currentRole.name}` : 'Rolle zuweisen'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 8px 3px 7px', borderRadius: 999,
          background: chipBg, color: chipColor, border: chipBorder,
          fontSize: 11, fontWeight: 600,
          cursor: saving ? 'wait' : 'pointer',
          opacity: saving ? 0.6 : 1,
          maxWidth: 180, transition: 'all 140ms ease',
        }}
      >
        {currentRole ? (
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: currentRole.color, flexShrink: 0,
          }} />
        ) : (
          <Crown size={11} style={{ flexShrink: 0 }} />
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentRole ? currentRole.name : 'Rolle zuweisen'}
        </span>
        <ChevronDown size={11} style={{ opacity: 0.7, flexShrink: 0 }} />
      </button>

      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            top: menuPos.top,
            bottom: menuPos.bottom,
            left: menuPos.left,
            zIndex: 10300,
            minWidth: 200, maxWidth: 260,
            background: 'var(--surface, #fff)',
            border: '1px solid var(--border, rgba(120,120,128,0.25))',
            borderRadius: 12,
            boxShadow: '0 12px 32px rgba(0,0,0,0.22)',
            padding: 4, overflow: 'hidden',
          }}
        >
          <RoleMenuItem
            active={!currentRole}
            color={null}
            label="Standard"
            sub="Gruppen-Standardrechte"
            onClick={() => choose('')}
          />
          {roles.length > 0 && (
            <div style={{
              height: 1, background: 'var(--border, rgba(120,120,128,0.18))', margin: '4px 2px',
            }} />
          )}
          {roles.map((r) => {
            const active = r.id === currentId;
            const count = r.permissions
              ? Object.values(r.permissions).filter(Boolean).length
              : 0;
            return (
              <RoleMenuItem
                key={r.id}
                active={active}
                color={r.color}
                label={r.name}
                sub={`${count} Berechtigungen`}
                onClick={() => choose(r.id)}
              />
            );
          })}
        </div>,
        document.body,
      )}
    </span>
  );
}

function RoleMenuItem({ active, color, label, sub, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '8px 10px', borderRadius: 8, border: 'none',
        background: active ? 'var(--hover, rgba(120,120,128,0.12))' : 'transparent',
        color: 'var(--text, inherit)', textAlign: 'left', cursor: 'pointer',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--hover, rgba(120,120,128,0.08))'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {color ? (
        <span style={{
          width: 18, height: 18, borderRadius: '50%', background: color,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 10, fontWeight: 700, flexShrink: 0,
        }}>
          {(label || '?').slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <span style={{
          width: 18, height: 18, borderRadius: '50%',
          background: 'var(--hover, rgba(120,120,128,0.15))',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-secondary, #8E8E93)', flexShrink: 0,
        }}>
          <Crown size={10} />
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{
          fontSize: 13, fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{label}</span>
        {sub && (
          <span style={{ fontSize: 11, opacity: 0.6, marginTop: 1 }}>{sub}</span>
        )}
      </span>
      {active && <Check size={14} style={{ color: 'var(--accent, #007AFF)', flexShrink: 0 }} />}
    </button>
  );
}

function GroupCategoryManager({ groupId }) {
  const [categories, setCategories] = useState([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#8E8E93');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#8E8E93');
  const [editSaving, setEditSaving] = useState(false);

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

  useEffect(() => { loadCategories(); }, [groupId]);

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

  const startEdit = (cat) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditColor(cat.color || '#8E8E93');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditColor('#8E8E93');
  };

  const handleUpdate = async (categoryId) => {
    const trimmed = String(editName || '').trim();
    if (!trimmed || editSaving) return;
    setEditSaving(true);
    try {
      const data = await api.updateGroupCategory(groupId, categoryId, { name: trimmed, color: editColor });
      const updated = data?.category;
      if (updated?.id) {
        setCategories((prev) => {
          const next = prev.map((c) => String(c.id) === String(updated.id) ? updated : c);
          return next.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de'));
        });
      }
      cancelEdit();
    } finally {
      setEditSaving(false);
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
    <section className="gs-card gs-cat-card">
      <div className="gs-card-header">
        <div className="gs-card-header-icon" style={{ background: 'rgba(88,86,214,0.12)', color: '#5856D6' }}>
          <Tag size={16} />
        </div>
        <div className="gs-card-header-text">
          <h4>Kategorien</h4>
          <p>Für alle Termine und Aufgaben</p>
        </div>
        <span className="gs-badge">{categories.length}</span>
      </div>

      <div className="gs-cat-input-row">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="gs-input"
          placeholder="Neue Kategorie..."
          maxLength={80}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <label className="gs-color-swatch" style={{ background: color }} title="Farbe wählen">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="gs-color-input-hidden" />
        </label>
        <button type="button" className="gs-add-btn" onClick={handleCreate} disabled={!name.trim() || saving}>
          <Plus size={16} />
          <span className="gs-add-btn-label">{saving ? '...' : 'Anlegen'}</span>
        </button>
      </div>

      {loading ? (
        <div className="gs-empty">Lädt...</div>
      ) : categories.length === 0 ? (
        <div className="gs-empty">Noch keine Kategorien vorhanden</div>
      ) : (
        <div className="gs-cat-list">
          {categories.map((cat) => {
            const isEditing = String(editingId) === String(cat.id);
            if (isEditing) {
              return (
                <div key={cat.id} className="gs-cat-row gs-cat-row-editing">
                  <label className="gs-color-swatch gs-color-swatch-sm" style={{ background: editColor }}>
                    <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} className="gs-color-input-hidden" />
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="gs-input gs-cat-edit-input"
                    maxLength={80}
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') handleUpdate(cat.id); if (e.key === 'Escape') cancelEdit(); }}
                  />
                  <button type="button" className="gs-cat-save-btn" onClick={() => handleUpdate(cat.id)} disabled={!editName.trim() || editSaving}>
                    <Check size={14} />
                  </button>
                  <button type="button" className="gs-cat-cancel-edit-btn" onClick={cancelEdit}>
                    <X size={14} />
                  </button>
                </div>
              );
            }
            return (
              <div key={cat.id} className="gs-cat-row">
                <span className="gs-cat-dot" style={{ background: cat.color || '#8E8E93' }} />
                <span className="gs-cat-name">{cat.name}</span>
                <button type="button" className="gs-cat-edit-btn" onClick={() => startEdit(cat)} title="Bearbeiten">
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  className="gs-cat-del-btn"
                  onClick={() => handleDelete(cat.id)}
                  disabled={String(deletingId) === String(cat.id)}
                  title="Löschen"
                >
                  <Trash2 size={14} />
                  <span className="gs-cat-del-label">Löschen</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
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
  const [isPublic, setIsPublic] = useState(group.is_public === true);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef(null);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate({ name, description, color, image_url: imageUrl, is_public: isPublic });
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
    <section className="gs-card gs-profile-card">
      <div className="gs-card-header">
        <div className="gs-card-header-icon" style={{ background: 'rgba(0,122,255,0.12)', color: '#007AFF' }}>
          <Settings size={16} />
        </div>
        <div className="gs-card-header-text">
          <h4>Gruppenprofil</h4>
          <p>Name, Bild, Farbe & Beschreibung</p>
        </div>
      </div>

      <div className="gs-avatar-upload-area" onClick={() => fileInputRef.current?.click()}>
        <AvatarBadge
          name={name || '?'}
          color={color || '#007AFF'}
          avatarUrl={imageUrl}
          size={76}
        />
        <div className="gs-avatar-camera-ring">
          <Camera size={14} />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageChange}
          className="gs-file-hidden"
        />
      </div>
      {imageUrl && (
        <button type="button" className="gs-remove-photo-btn" onClick={() => setImageUrl(null)}>
          Foto entfernen
        </button>
      )}

      <div className="gs-form">
        <div className="gs-field">
          <label className="gs-label">Gruppenname</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="gs-input"
            placeholder="z.B. Familie, Team Alpha..."
          />
        </div>

        <div className="gs-field">
          <label className="gs-label">Beschreibung</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="gs-input gs-textarea"
            rows={3}
            placeholder="Worum geht es in dieser Gruppe?"
          />
        </div>

        <div className="gs-field">
          <label className="gs-label">Farbe</label>
          <div className="gs-color-row">
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`gs-color-swatch-btn${color === c ? ' active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                title={c}
              />
            ))}
          </div>
        </div>

        <button className="gs-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Wird gespeichert…' : 'Änderungen speichern'}
        </button>

        <div className="gs-field gs-public-field">
          <label className="gs-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
            <Globe size={14} style={{ color: '#007AFF' }} />
            <span style={{ flex: 1 }}>Gruppe öffentlich auffindbar</span>
            <button
              type="button"
              role="switch"
              aria-checked={isPublic}
              className={`manual-task-allday-btn${isPublic ? ' on' : ''}`}
              onClick={() => setIsPublic((v) => !v)}
            />
          </label>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
            Wenn aktiv, können Nutzer diese Gruppe über die Suche finden und eine Beitrittsanfrage senden.
          </p>
        </div>
      </div>

      {isOwner && (
        <div className="gs-danger-zone">
          <div className="gs-danger-header">
            <AlertTriangle size={15} />
            <span>Gefahrenzone</span>
          </div>
          {!confirmDelete ? (
            <button className="gs-danger-btn" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15} /> Gruppe löschen
            </button>
          ) : (
            <div className="gs-confirm-delete">
              <p>Alle Daten und Verknüpfungen werden entfernt. Dieser Schritt kann nicht rückgängig gemacht werden.</p>
              <div className="gs-confirm-actions">
                <button className="gs-danger-btn confirm" onClick={onDelete}>Ja, endgültig löschen</button>
                <button className="gs-cancel-btn" onClick={() => setConfirmDelete(false)}>Abbrechen</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
