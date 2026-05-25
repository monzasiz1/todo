import { useEffect, useMemo, useState } from 'react';
import {
  Share2, Users, TrendingUp, Plus, Trash2, X, Check,
  UserPlus, Receipt, Sparkles, ChevronRight, LogOut, AlertCircle,
} from 'lucide-react';
import { useSharedSpendingStore } from '../store/sharedSpendingStore';
import { useFriendsStore } from '../store/friendsStore';
import '../styles/shared-spending.css';

const CATEGORY_NODES = [
  { id: 'food',   label: 'Essen & Trinken',     color: '#60A5FA' },
  { id: 'home',   label: 'Miete & Haushalt',    color: '#32D583' },
  { id: 'travel', label: 'Reisen & Ausflüge',   color: '#FF9F0A' },
  { id: 'free',   label: 'Freizeit & Erlebnisse', color: '#D14BE2' },
];

const MEMBER_PALETTE = ['#5AC8FA', '#FF9F0A', '#AF52DE', '#32D583', '#FF6B6B', '#FFD60A'];

function compactName(name) {
  if (!name) return 'Freund';
  return name.split(' ').slice(0, 2).join(' ');
}

function categoryLabel(id) {
  return CATEGORY_NODES.find((c) => c.id === id)?.label || id;
}

function categoryColor(id) {
  return CATEGORY_NODES.find((c) => c.id === id)?.color || '#8E8E93';
}

function fmtAmount(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function SharedSpendingPage() {
  const {
    groups, activeGroup, loading, detailLoading,
    fetchGroups, fetchGroupDetail, createGroup, deleteGroup,
    inviteMember, acceptInvite, declineInvite, leaveGroup, removeMember,
    addExpense, deleteExpense, setActiveGroup,
  } = useSharedSpendingStore();
  const { friends, fetchFriends } = useFriendsStore();

  const [toast, setToast] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showExpense, setShowExpense] = useState(false);

  useEffect(() => {
    fetchGroups();
    fetchFriends();
  }, []);

  // Bei aktiver Gruppe regelmaessig aktualisierte Detail-Daten laden
  useEffect(() => {
    if (!activeGroup && groups.length > 0) {
      const firstAccepted = groups.find((g) => g.my_status === 'accepted');
      if (firstAccepted) fetchGroupDetail(firstAccepted.id);
    }
  }, [groups, activeGroup]);

  const showToast = (msg, kind = 'success') => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 2600);
  };

  const acceptedGroups = useMemo(
    () => groups.filter((g) => g.my_status === 'accepted'),
    [groups]
  );
  const pendingInvites = useMemo(
    () => groups.filter((g) => g.my_status === 'pending'),
    [groups]
  );

  const handleCreate = async (name) => {
    const res = await createGroup(name);
    if (res.success) {
      setShowCreate(false);
      showToast('Gruppe erstellt');
      await fetchGroupDetail(res.group.id);
    } else {
      showToast(res.error || 'Fehler', 'error');
    }
  };

  const handleSelectGroup = async (groupId) => {
    await fetchGroupDetail(groupId);
  };

  const handleAccept = async (groupId) => {
    const res = await acceptInvite(groupId);
    if (res.success) showToast('Einladung angenommen');
    else showToast(res.error || 'Fehler', 'error');
  };

  const handleDecline = async (groupId) => {
    const res = await declineInvite(groupId);
    if (res.success) showToast('Einladung abgelehnt');
  };

  const handleLeave = async () => {
    if (!activeGroup) return;
    if (!window.confirm(`Gruppe "${activeGroup.name}" wirklich verlassen?`)) return;
    const res = await leaveGroup(activeGroup.id);
    if (res.success) showToast('Gruppe verlassen');
  };

  const handleDelete = async () => {
    if (!activeGroup) return;
    if (!window.confirm(`Gruppe "${activeGroup.name}" wirklich löschen? Alle Daten gehen verloren.`)) return;
    const res = await deleteGroup(activeGroup.id);
    if (res.success) showToast('Gruppe gelöscht');
  };

  const handleInvite = async ({ email, user_id }) => {
    if (!activeGroup) return;
    const res = await inviteMember(activeGroup.id, { email, user_id });
    if (res.success) {
      setShowInvite(false);
      showToast('Einladung gesendet');
    } else {
      showToast(res.error || 'Fehler beim Einladen', 'error');
    }
  };

  const handleRemoveMember = async (userId) => {
    if (!activeGroup) return;
    if (!window.confirm('Mitglied wirklich entfernen?')) return;
    const res = await removeMember(activeGroup.id, userId);
    if (res.success) showToast('Mitglied entfernt');
  };

  const handleAddExpense = async (payload) => {
    if (!activeGroup) return;
    const res = await addExpense(activeGroup.id, payload);
    if (res.success) {
      setShowExpense(false);
      showToast('Ausgabe hinzugefügt');
    } else {
      showToast(res.error || 'Fehler', 'error');
    }
  };

  const handleDeleteExpense = async (expenseId) => {
    if (!activeGroup) return;
    if (!window.confirm('Ausgabe löschen?')) return;
    const res = await deleteExpense(activeGroup.id, expenseId);
    if (res.success) showToast('Ausgabe gelöscht');
  };

  return (
    <div className="shared-spending-page">
      <section className="page-header shared-spending-header">
        <div>
          <span className="eyebrow">Gemeinsame Ausgaben</span>
          <h2>Geteilte Kosten im Blick</h2>
          <p>
            Erstelle Ausgaben-Gruppen, lade Freunde ein und verfolge wer wofür wieviel ausgibt — alles live geteilt.
          </p>
        </div>
        <div className="shared-spending-header-actions">
          <button type="button" className="sankey-btn sankey-btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={18} /> Neue Gruppe
          </button>
        </div>
      </section>

      {pendingInvites.length > 0 && (
        <section className="spending-invites">
          <h3 className="spending-section-title"><AlertCircle size={16} /> Offene Einladungen</h3>
          <div className="spending-invites-list">
            {pendingInvites.map((g) => (
              <article key={g.id} className="spending-invite-card">
                <div>
                  <strong>{g.name}</strong>
                  <p>Von {g.owner_name}</p>
                </div>
                <div className="spending-invite-actions">
                  <button type="button" className="sankey-btn sankey-btn-primary" onClick={() => handleAccept(g.id)}>
                    <Check size={16} /> Annehmen
                  </button>
                  <button type="button" className="sankey-btn sankey-btn-secondary" onClick={() => handleDecline(g.id)}>
                    <X size={16} /> Ablehnen
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="spending-layout">
        <aside className="spending-sidebar">
          <div className="spending-sidebar-head">
            <h3>Deine Gruppen</h3>
            <span className="spending-count">{acceptedGroups.length}</span>
          </div>
          {loading && acceptedGroups.length === 0 && (
            <p className="spending-empty">Lädt…</p>
          )}
          {!loading && acceptedGroups.length === 0 && (
            <div className="spending-empty-state">
              <p>Noch keine Gruppe.</p>
              <button type="button" className="sankey-btn sankey-btn-primary" onClick={() => setShowCreate(true)}>
                <Plus size={16} /> Erste Gruppe anlegen
              </button>
            </div>
          )}
          <ul className="spending-group-list">
            {acceptedGroups.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  className={`spending-group-item ${activeGroup?.id === g.id ? 'is-active' : ''}`}
                  onClick={() => handleSelectGroup(g.id)}
                >
                  <div>
                    <strong>{g.name}</strong>
                    <span>{g.member_count} {g.member_count === 1 ? 'Person' : 'Personen'} · {fmtAmount(g.total_amount)} €</span>
                  </div>
                  <ChevronRight size={16} />
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="spending-main">
          {!activeGroup && !detailLoading && (
            <div className="spending-empty-main">
              <Sparkles size={28} />
              <h3>Wähle oder erstelle eine Gruppe</h3>
              <p>Verfolge gemeinsame Ausgaben mit deinen Freunden und behalt den Überblick.</p>
            </div>
          )}

          {activeGroup && (
            <GroupDetail
              group={activeGroup}
              detailLoading={detailLoading}
              onInvite={() => setShowInvite(true)}
              onAddExpense={() => setShowExpense(true)}
              onDelete={handleDelete}
              onLeave={handleLeave}
              onRemoveMember={handleRemoveMember}
              onDeleteExpense={handleDeleteExpense}
            />
          )}
        </main>
      </div>

      {showCreate && (
        <CreateGroupModal onClose={() => setShowCreate(false)} onSubmit={handleCreate} />
      )}

      {showInvite && activeGroup && (
        <InviteFriendModal
          friends={friends}
          existingMemberIds={activeGroup.members.map((m) => m.user_id).concat(activeGroup.owner_id)}
          onClose={() => setShowInvite(false)}
          onSubmit={handleInvite}
        />
      )}

      {showExpense && activeGroup && (
        <AddExpenseModal onClose={() => setShowExpense(false)} onSubmit={handleAddExpense} />
      )}

      {toast && (
        <div className={`shared-spending-toast ${toast.kind === 'error' ? 'is-error' : ''}`}>
          {toast.kind === 'error' ? <AlertCircle size={16} /> : <Check size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function GroupDetail({
  group, detailLoading, onInvite, onAddExpense, onDelete, onLeave, onRemoveMember, onDeleteExpense,
}) {
  const memberMap = useMemo(() => {
    const map = {};
    map[group.owner_id] = {
      id: group.owner_id,
      name: group.owner_name,
      isOwner: true,
      color: MEMBER_PALETTE[0],
    };
    group.members
      .filter((m) => m.status === 'accepted')
      .forEach((m, i) => {
        map[m.user_id] = {
          id: m.user_id,
          name: m.name,
          isOwner: false,
          color: MEMBER_PALETTE[(i + 1) % MEMBER_PALETTE.length],
        };
      });
    return map;
  }, [group]);

  const summary = useMemo(() => {
    const byMember = {};
    const byCategory = {};
    let total = 0;
    group.expenses.forEach((e) => {
      byMember[e.user_id] = (byMember[e.user_id] || 0) + e.amount;
      byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
      total += e.amount;
    });
    return { byMember, byCategory, total };
  }, [group.expenses]);

  const flows = useMemo(() => {
    const list = [];
    group.expenses.forEach((e) => {
      list.push({
        source: `m-${e.user_id}`,
        target: `c-${e.category}`,
        value: e.amount,
        color: memberMap[e.user_id]?.color || '#8E8E93',
      });
    });
    return list;
  }, [group.expenses, memberMap]);

  const activeMembers = useMemo(
    () => Object.values(memberMap),
    [memberMap]
  );

  const usedCategories = useMemo(() => {
    const ids = new Set(group.expenses.map((e) => e.category));
    return CATEGORY_NODES.filter((c) => ids.has(c.id));
  }, [group.expenses]);

  const sourcePositions = useMemo(() => {
    const nodeHeight = 64;
    const gap = 18;
    const positions = {};
    activeMembers.forEach((m, i) => {
      positions[`m-${m.id}`] = 24 + i * (nodeHeight + gap);
    });
    return positions;
  }, [activeMembers]);

  const targetPositions = useMemo(() => {
    const nodeHeight = 64;
    const gap = 18;
    const positions = {};
    usedCategories.forEach((c, i) => {
      positions[`c-${c.id}`] = 22 + i * (nodeHeight + gap);
    });
    return positions;
  }, [usedCategories]);

  const chartPaths = useMemo(() => {
    if (flows.length === 0) return [];
    const sourceX = 200;
    const targetX = 740;
    const curveOffset = 140;
    const maxFlow = Math.max(...flows.map((f) => f.value), 1);
    return flows.map((flow, index) => {
      const sy = (sourcePositions[flow.source] ?? 24) + 32;
      const ty = (targetPositions[flow.target] ?? 22) + 32;
      const width = Math.max(8, (flow.value / maxFlow) * 26);
      const d = `M ${sourceX} ${sy} C ${sourceX + curveOffset} ${sy} ${targetX - curveOffset} ${ty} ${targetX} ${ty}`;
      return {
        id: `${flow.source}-${flow.target}-${index}`,
        d, width, color: flow.color,
      };
    });
  }, [flows, sourcePositions, targetPositions]);

  const topCategory = useMemo(() => {
    const entries = Object.entries(summary.byCategory);
    if (entries.length === 0) return null;
    return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best), entries[0]);
  }, [summary.byCategory]);

  return (
    <>
      <header className="spending-detail-head">
        <div>
          <h2>{group.name}</h2>
          <p>{activeMembers.length} {activeMembers.length === 1 ? 'Mitglied' : 'Mitglieder'} · gegründet {new Date(group.created_at).toLocaleDateString('de-DE')}</p>
        </div>
        <div className="spending-detail-head-actions">
          <button type="button" className="sankey-btn sankey-btn-primary" onClick={onAddExpense}>
            <Plus size={16} /> Ausgabe
          </button>
          <button type="button" className="sankey-btn sankey-btn-secondary" onClick={onInvite}>
            <UserPlus size={16} /> Einladen
          </button>
          {group.is_owner ? (
            <button type="button" className="sankey-btn sankey-btn-ghost" onClick={onDelete}>
              <Trash2 size={16} /> Löschen
            </button>
          ) : (
            <button type="button" className="sankey-btn sankey-btn-ghost" onClick={onLeave}>
              <LogOut size={16} /> Verlassen
            </button>
          )}
        </div>
      </header>

      <div className="sankey-summary-grid">
        <article className="sankey-summary-card">
          <div className="sankey-summary-icon"><Users size={20} /></div>
          <span className="sankey-summary-label">Teamgröße</span>
          <strong>{activeMembers.length} {activeMembers.length === 1 ? 'Person' : 'Personen'}</strong>
          <p>{group.members.filter((m) => m.status === 'pending').length} offene Einladung(en)</p>
        </article>
        <article className="sankey-summary-card">
          <div className="sankey-summary-icon"><TrendingUp size={20} /></div>
          <span className="sankey-summary-label">Gesamtausgaben</span>
          <strong>{fmtAmount(summary.total)} €</strong>
          <p>{group.expenses.length} Buchung(en) erfasst.</p>
        </article>
        <article className="sankey-summary-card">
          <div className="sankey-summary-icon"><Sparkles size={20} /></div>
          <span className="sankey-summary-label">Top Kategorie</span>
          <strong>{topCategory ? categoryLabel(topCategory[0]) : '—'}</strong>
          <p>{topCategory ? `${fmtAmount(topCategory[1])} € geben den größten Fluss.` : 'Noch keine Ausgaben.'}</p>
        </article>
      </div>

      <section className="sankey-card">
        {group.expenses.length === 0 ? (
          <div className="spending-chart-empty">
            <Receipt size={32} />
            <h4>Noch keine Ausgaben</h4>
            <p>Füge die erste Ausgabe hinzu — der Sankey-Fluss erscheint sofort.</p>
            <button type="button" className="sankey-btn sankey-btn-primary" onClick={onAddExpense}>
              <Plus size={16} /> Ausgabe hinzufügen
            </button>
          </div>
        ) : (
          <div className="sankey-visual">
            <div className="sankey-column sankey-source-column">
              <div className="sankey-column-title">Mitglieder</div>
              {activeMembers.map((m) => (
                <div
                  key={m.id}
                  className="sankey-node-card"
                  style={{ top: sourcePositions[`m-${m.id}`], borderColor: m.color }}
                >
                  <div className="sankey-node-meta">
                    <span className="sankey-node-badge" style={{ background: m.color }} />
                    <strong>{compactName(m.name)}</strong>
                  </div>
                  <span className="sankey-node-sub">{fmtAmount(summary.byMember[m.id] || 0)} €</span>
                </div>
              ))}
            </div>

            <div className="sankey-chart-wrapper">
              <svg className="sankey-chart" viewBox="0 0 960 360" preserveAspectRatio="xMidYMid meet">
                {chartPaths.map((path) => (
                  <path
                    key={path.id}
                    d={path.d}
                    stroke={path.color}
                    strokeWidth={path.width}
                    fill="none"
                    strokeLinecap="round"
                    opacity={0.78}
                  />
                ))}
              </svg>
            </div>

            <div className="sankey-column sankey-target-column">
              <div className="sankey-column-title">Kategorien</div>
              {usedCategories.map((c) => (
                <div
                  key={c.id}
                  className="sankey-node-card"
                  style={{ top: targetPositions[`c-${c.id}`], borderColor: c.color }}
                >
                  <div className="sankey-node-meta">
                    <span className="sankey-node-badge" style={{ background: c.color }} />
                    <strong>{c.label}</strong>
                  </div>
                  <span className="sankey-node-sub">{fmtAmount(summary.byCategory[c.id] || 0)} €</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="spending-twocol">
        <section className="spending-panel">
          <header className="spending-panel-head">
            <h3>Mitglieder</h3>
            <button type="button" className="sankey-btn sankey-btn-secondary" onClick={onInvite}>
              <UserPlus size={14} /> Einladen
            </button>
          </header>
          <ul className="spending-member-list">
            {activeMembers.map((m) => (
              <li key={m.id} className="spending-member-item">
                <span className="spending-avatar" style={{ background: m.color }}>
                  {(m.name || '?').slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{m.name}</strong>
                  <span>{m.isOwner ? 'Owner' : 'Mitglied'} · {fmtAmount(summary.byMember[m.id] || 0)} €</span>
                </div>
                {group.is_owner && !m.isOwner && (
                  <button
                    type="button"
                    className="spending-icon-btn"
                    title="Entfernen"
                    onClick={() => onRemoveMember(m.id)}
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
            {group.members.filter((m) => m.status === 'pending').map((m) => (
              <li key={`p-${m.user_id}`} className="spending-member-item is-pending">
                <span className="spending-avatar" style={{ background: '#8E8E93' }}>
                  {(m.name || '?').slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{m.name}</strong>
                  <span>Einladung ausstehend</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="spending-panel">
          <header className="spending-panel-head">
            <h3>Letzte Ausgaben</h3>
            <button type="button" className="sankey-btn sankey-btn-secondary" onClick={onAddExpense}>
              <Plus size={14} /> Hinzufügen
            </button>
          </header>
          {group.expenses.length === 0 ? (
            <p className="spending-empty">Noch keine Ausgaben.</p>
          ) : (
            <ul className="spending-expense-list">
              {group.expenses.slice(0, 20).map((e) => (
                <li key={e.id} className="spending-expense-item">
                  <span className="spending-expense-dot" style={{ background: categoryColor(e.category) }} />
                  <div className="spending-expense-body">
                    <div className="spending-expense-top">
                      <strong>{e.description || categoryLabel(e.category)}</strong>
                      <span className="spending-expense-amt">{fmtAmount(e.amount)} €</span>
                    </div>
                    <span className="spending-expense-meta">
                      {memberMap[e.user_id]?.name || 'Unbekannt'} · {categoryLabel(e.category)} · {new Date(e.created_at).toLocaleDateString('de-DE')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="spending-icon-btn"
                    title="Löschen"
                    onClick={() => onDeleteExpense(e.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function CreateGroupModal({ onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    await onSubmit(name.trim());
    setSubmitting(false);
  };

  return (
    <div className="spending-modal-backdrop" onClick={onClose}>
      <form className="spending-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header className="spending-modal-head">
          <h3>Neue Ausgaben-Gruppe</h3>
          <button type="button" className="spending-icon-btn" onClick={onClose}><X size={16} /></button>
        </header>
        <label className="spending-field">
          <span>Name der Gruppe</span>
          <input
            type="text"
            value={name}
            autoFocus
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. WG Berlin, Urlaub Italien …"
          />
        </label>
        <footer className="spending-modal-foot">
          <button type="button" className="sankey-btn sankey-btn-ghost" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="sankey-btn sankey-btn-primary" disabled={!name.trim() || submitting}>
            <Plus size={16} /> {submitting ? 'Erstelle…' : 'Erstellen'}
          </button>
        </footer>
      </form>
    </div>
  );
}

function InviteFriendModal({ friends, existingMemberIds, onClose, onSubmit }) {
  const [mode, setMode] = useState('friends');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const availableFriends = useMemo(() => {
    return (friends || [])
      .filter((f) => !existingMemberIds.includes(f.friend_user_id))
      .map((f) => ({
        id: f.friend_user_id,
        name: f.name || f.email,
        email: f.email,
      }));
  }, [friends, existingMemberIds]);

  const submitFriend = async (userId) => {
    setSubmitting(true);
    await onSubmit({ user_id: userId });
    setSubmitting(false);
  };

  const submitEmail = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    await onSubmit({ email: email.trim() });
    setSubmitting(false);
  };

  return (
    <div className="spending-modal-backdrop" onClick={onClose}>
      <div className="spending-modal" onClick={(e) => e.stopPropagation()}>
        <header className="spending-modal-head">
          <h3>Freund einladen</h3>
          <button type="button" className="spending-icon-btn" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="spending-tabs">
          <button
            type="button"
            className={`spending-tab ${mode === 'friends' ? 'is-active' : ''}`}
            onClick={() => setMode('friends')}
          >
            Aus Freundesliste
          </button>
          <button
            type="button"
            className={`spending-tab ${mode === 'email' ? 'is-active' : ''}`}
            onClick={() => setMode('email')}
          >
            Per E-Mail
          </button>
        </div>

        {mode === 'friends' && (
          <div className="spending-friends-pick">
            {availableFriends.length === 0 && (
              <p className="spending-empty">
                Keine Freunde verfügbar. Schließe zuerst Freundschaften unter „Freunde", oder lade per E-Mail ein.
              </p>
            )}
            <ul>
              {availableFriends.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="spending-friend-row"
                    disabled={submitting}
                    onClick={() => submitFriend(f.id)}
                  >
                    <span className="spending-avatar" style={{ background: '#5AC8FA' }}>
                      {(f.name || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <strong>{f.name}</strong>
                      <span>{f.email}</span>
                    </div>
                    <UserPlus size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mode === 'email' && (
          <form onSubmit={submitEmail}>
            <label className="spending-field">
              <span>E-Mail-Adresse</span>
              <input
                type="email"
                value={email}
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
                placeholder="freund@example.com"
              />
            </label>
            <p className="spending-hint">
              Die Person muss bereits in deiner Freundesliste sein. Falls nicht, sende erst eine Freundschaftsanfrage.
            </p>
            <footer className="spending-modal-foot">
              <button type="button" className="sankey-btn sankey-btn-ghost" onClick={onClose}>Abbrechen</button>
              <button type="submit" className="sankey-btn sankey-btn-primary" disabled={!email.trim() || submitting}>
                <UserPlus size={16} /> Einladen
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}

function AddExpenseModal({ onClose, onSubmit }) {
  const [category, setCategory] = useState('food');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const amt = Number((amount || '').replace(',', '.'));
    if (!Number.isFinite(amt) || amt < 0) return;
    setSubmitting(true);
    await onSubmit({ category, amount: amt, description: description.trim() });
    setSubmitting(false);
  };

  return (
    <div className="spending-modal-backdrop" onClick={onClose}>
      <form className="spending-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header className="spending-modal-head">
          <h3>Neue Ausgabe</h3>
          <button type="button" className="spending-icon-btn" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="spending-category-grid">
          {CATEGORY_NODES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`spending-category-btn ${category === c.id ? 'is-active' : ''}`}
              style={{ '--cat-color': c.color }}
              onClick={() => setCategory(c.id)}
            >
              <span className="spending-category-dot" style={{ background: c.color }} />
              {c.label}
            </button>
          ))}
        </div>

        <label className="spending-field">
          <span>Betrag (€)</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            autoFocus
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
            placeholder="0,00"
          />
        </label>

        <label className="spending-field">
          <span>Beschreibung (optional)</span>
          <input
            type="text"
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="z.B. Einkauf REWE"
          />
        </label>

        <footer className="spending-modal-foot">
          <button type="button" className="sankey-btn sankey-btn-ghost" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="sankey-btn sankey-btn-primary" disabled={!amount || submitting}>
            <Plus size={16} /> {submitting ? 'Speichere…' : 'Hinzufügen'}
          </button>
        </footer>
      </form>
    </div>
  );
}
