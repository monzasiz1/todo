import { useEffect, useMemo, useState } from 'react';
import {
  Users, TrendingUp, TrendingDown, Plus, Trash2, X, Check,
  UserPlus, Receipt, Sparkles, ChevronRight, LogOut, AlertCircle,
  Wand2, ArrowDownCircle, ArrowUpCircle, Wallet, Loader2,
} from 'lucide-react';
import { useSharedSpendingStore } from '../store/sharedSpendingStore';
import { useFriendsStore } from '../store/friendsStore';
import '../styles/shared-spending.css';

const EXPENSE_CATEGORIES = [
  { id: 'food',   label: 'Essen & Trinken',       color: '#60A5FA' },
  { id: 'home',   label: 'Miete & Haushalt',      color: '#32D583' },
  { id: 'travel', label: 'Reisen & Ausflüge',     color: '#FF9F0A' },
  { id: 'free',   label: 'Freizeit & Erlebnisse', color: '#D14BE2' },
];

const INCOME_CATEGORIES = [
  { id: 'salary', label: 'Gehalt',         color: '#34D399' },
  { id: 'gift',   label: 'Geschenk',       color: '#F472B6' },
  { id: 'side',   label: 'Nebeneinkommen', color: '#A78BFA' },
  { id: 'other',  label: 'Sonstiges',      color: '#94A3B8' },
];

// Rueckwaerts-kompatibler Alias fuer ggf. noch verbliebene Referenzen.
const CATEGORY_NODES = EXPENSE_CATEGORIES;

const MEMBER_PALETTE = ['#5AC8FA', '#FF9F0A', '#AF52DE', '#32D583', '#FF6B6B', '#FFD60A'];

function compactName(name) {
  if (!name) return 'Freund';
  return name.split(' ').slice(0, 2).join(' ');
}

const ALL_CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];

function categoryLabel(id) {
  return ALL_CATEGORIES.find((c) => c.id === id)?.label || id;
}

function categoryColor(id) {
  return ALL_CATEGORIES.find((c) => c.id === id)?.color || '#8E8E93';
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
    addEntry, deleteEntry, parseWithAI,
  } = useSharedSpendingStore();
  const { friends, fetchFriends } = useFriendsStore();

  const [toast, setToast] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  // Entry-Modal: { kind: 'income'|'expense', prefill?: parsed }
  const [entryModal, setEntryModal] = useState(null);

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

  const handleAddEntry = async (payload) => {
    if (!activeGroup) return;
    const res = await addEntry(activeGroup.id, payload);
    if (res.success) {
      setEntryModal(null);
      showToast(payload.kind === 'income' ? 'Einnahme hinzugefügt' : 'Ausgabe hinzugefügt');
    } else {
      showToast(res.error || 'Fehler', 'error');
    }
  };

  const handleDeleteEntry = async (entryId, kind) => {
    if (!activeGroup) return;
    const label = kind === 'income' ? 'Einnahme' : 'Ausgabe';
    if (!window.confirm(`${label} löschen?`)) return;
    const res = await deleteEntry(activeGroup.id, entryId);
    if (res.success) showToast(`${label} gelöscht`);
  };

  const handleAIParse = async (input) => {
    const res = await parseWithAI(input);
    if (res.success) {
      setEntryModal({ kind: res.parsed.kind, prefill: res.parsed });
    } else {
      showToast(res.error || 'KI konnte nichts erkennen', 'error');
    }
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
              onAddExpense={() => setEntryModal({ kind: 'expense' })}
              onAddIncome={() => setEntryModal({ kind: 'income' })}
              onAIParse={handleAIParse}
              onDelete={handleDelete}
              onLeave={handleLeave}
              onRemoveMember={handleRemoveMember}
              onDeleteEntry={handleDeleteEntry}
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

      {entryModal && activeGroup && (
        <EntryModal
          mode={entryModal.kind}
          prefill={entryModal.prefill}
          onClose={() => setEntryModal(null)}
          onSubmit={handleAddEntry}
          onSwitch={(k) => setEntryModal((m) => ({ ...(m || {}), kind: k, prefill: undefined }))}
        />
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
  group, detailLoading, onInvite, onAddExpense, onAddIncome, onAIParse,
  onDelete, onLeave, onRemoveMember, onDeleteEntry,
}) {
  const incomes = group.incomes || [];
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
    const byMemberIncome = {};
    const byCategory = {};
    const byIncomeCategory = {};
    let totalExpense = 0;
    let totalIncome = 0;
    group.expenses.forEach((e) => {
      byMember[e.user_id] = (byMember[e.user_id] || 0) + e.amount;
      byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
      totalExpense += e.amount;
    });
    incomes.forEach((e) => {
      byMemberIncome[e.user_id] = (byMemberIncome[e.user_id] || 0) + e.amount;
      byIncomeCategory[e.category] = (byIncomeCategory[e.category] || 0) + e.amount;
      totalIncome += e.amount;
    });
    return {
      byMember, byCategory, byMemberIncome, byIncomeCategory,
      totalExpense, totalIncome, balance: totalIncome - totalExpense,
    };
  }, [group.expenses, incomes]);

  const allEntries = useMemo(() => {
    return [
      ...incomes.map((e) => ({ ...e, kind: 'income' })),
      ...group.expenses.map((e) => ({ ...e, kind: 'expense' })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [group.expenses, incomes]);

  const activeMembers = useMemo(
    () => Object.values(memberMap),
    [memberMap]
  );

  const usedExpenseCategories = useMemo(() => {
    const ids = new Set(group.expenses.map((e) => e.category));
    return EXPENSE_CATEGORIES.filter((c) => ids.has(c.id));
  }, [group.expenses]);

  const usedIncomeCategories = useMemo(() => {
    const ids = new Set(incomes.map((e) => e.category));
    return INCOME_CATEGORIES.filter((c) => ids.has(c.id));
  }, [incomes]);

  const sankeyLayout = useMemo(
    () => buildSankeyLayout({
      members: activeMembers,
      expenseCategories: usedExpenseCategories,
      expenses: group.expenses,
      incomes,
      memberMap,
      totalIncome: summary.totalIncome,
      totalExpense: summary.totalExpense,
    }),
    [activeMembers, usedExpenseCategories, group.expenses, incomes, memberMap, summary]
  );

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
          <button type="button" className="sankey-btn sankey-btn-income" onClick={onAddIncome}>
            <ArrowDownCircle size={16} /> Einnahme
          </button>
          <button type="button" className="sankey-btn sankey-btn-primary" onClick={onAddExpense}>
            <ArrowUpCircle size={16} /> Ausgabe
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

      <AIQuickInput onParse={onAIParse} />

      <div className="sankey-summary-grid sankey-summary-grid-4">
        <article className="sankey-summary-card spending-card-income">
          <div className="sankey-summary-icon"><TrendingUp size={20} /></div>
          <span className="sankey-summary-label">Gesamteinnahmen</span>
          <strong>{fmtAmount(summary.totalIncome)} €</strong>
          <p>{incomes.length} Einnahme(n)</p>
        </article>
        <article className="sankey-summary-card spending-card-expense">
          <div className="sankey-summary-icon"><TrendingDown size={20} /></div>
          <span className="sankey-summary-label">Gesamtausgaben</span>
          <strong>{fmtAmount(summary.totalExpense)} €</strong>
          <p>{group.expenses.length} Buchung(en)</p>
        </article>
        <article className={`sankey-summary-card ${summary.balance >= 0 ? 'spending-card-balance-pos' : 'spending-card-balance-neg'}`}>
          <div className="sankey-summary-icon"><Wallet size={20} /></div>
          <span className="sankey-summary-label">Bilanz</span>
          <strong>{summary.balance >= 0 ? '+' : ''}{fmtAmount(summary.balance)} €</strong>
          <p>{summary.balance >= 0 ? 'Überschuss' : 'Defizit'}</p>
        </article>
        <article className="sankey-summary-card">
          <div className="sankey-summary-icon"><Sparkles size={20} /></div>
          <span className="sankey-summary-label">Top Kategorie</span>
          <strong>{topCategory ? categoryLabel(topCategory[0]) : '—'}</strong>
          <p>{topCategory ? `${fmtAmount(topCategory[1])} € im größten Fluss.` : 'Noch keine Ausgaben.'}</p>
        </article>
      </div>

      <section className="sankey-card">
        {(group.expenses.length === 0 && incomes.length === 0) ? (
          <div className="spending-chart-empty">
            <Receipt size={32} />
            <h4>Noch keine Buchungen</h4>
            <p>Erfasse deine erste Einnahme oder Ausgabe — der Geldfluss erscheint sofort.</p>
            <div className="spending-chart-empty-actions">
              <button type="button" className="sankey-btn sankey-btn-income" onClick={onAddIncome}>
                <ArrowDownCircle size={16} /> Einnahme
              </button>
              <button type="button" className="sankey-btn sankey-btn-primary" onClick={onAddExpense}>
                <ArrowUpCircle size={16} /> Ausgabe
              </button>
            </div>
          </div>
        ) : (
          <>
            <SankeyDiagram layout={sankeyLayout} />
            <MobileFlowView
              members={activeMembers}
              expenseCategories={usedExpenseCategories}
              summary={summary}
            />
          </>
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
            <h3>Letzte Buchungen</h3>
            <div className="spending-panel-head-actions">
              <button type="button" className="sankey-btn sankey-btn-income spending-mini-btn" onClick={onAddIncome}>
                <ArrowDownCircle size={14} />
              </button>
              <button type="button" className="sankey-btn sankey-btn-primary spending-mini-btn" onClick={onAddExpense}>
                <ArrowUpCircle size={14} />
              </button>
            </div>
          </header>
          {allEntries.length === 0 ? (
            <p className="spending-empty">Noch keine Buchungen.</p>
          ) : (
            <ul className="spending-expense-list">
              {allEntries.slice(0, 25).map((e) => (
                <li key={`${e.kind}-${e.id}`} className={`spending-expense-item ${e.kind === 'income' ? 'is-income' : ''}`}>
                  <span className="spending-expense-dot" style={{ background: categoryColor(e.category) }} />
                  <div className="spending-expense-body">
                    <div className="spending-expense-top">
                      <strong>{e.description || categoryLabel(e.category)}</strong>
                      <span className={`spending-expense-amt ${e.kind === 'income' ? 'is-income' : 'is-expense'}`}>
                        {e.kind === 'income' ? '+' : '−'} {fmtAmount(e.amount)} €
                      </span>
                    </div>
                    <span className="spending-expense-meta">
                      {memberMap[e.user_id]?.name || 'Unbekannt'} · {categoryLabel(e.category)} · {new Date(e.created_at).toLocaleDateString('de-DE')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="spending-icon-btn"
                    title="Löschen"
                    onClick={() => onDeleteEntry(e.id, e.kind)}
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

/* ── AI Quick-Input ────────────────────────────────────────────────────
 * Freitext-Feld: User tippt "Pizza 25€ heute", Mistral parst → Modal
 * oeffnet sich mit Vorbelegung. Auch sichtbar wenn Sankey noch leer ist.
 * ──────────────────────────────────────────────────────────────────── */
function AIQuickInput({ onParse }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    await onParse(text.trim());
    setBusy(false);
    setText('');
  };

  return (
    <form className="spending-ai-input" onSubmit={submit}>
      <span className="spending-ai-icon"><Wand2 size={16} /></span>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='z.B. "Pizza 25€" oder "Gehalt 2400" — KI erkennt automatisch'
        disabled={busy}
        maxLength={200}
      />
      <button
        type="submit"
        className="sankey-btn sankey-btn-primary spending-ai-submit"
        disabled={!text.trim() || busy}
      >
        {busy ? <Loader2 size={16} className="spending-spin" /> : <Sparkles size={16} />}
        {busy ? 'KI denkt…' : 'Erkennen'}
      </button>
    </form>
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

/* Unified Entry-Modal: Toggle zwischen Einnahme und Ausgabe oben.
 * Akzeptiert prefill aus KI-Parser (Kategorie, Betrag, Beschreibung). */
function EntryModal({ mode, prefill, onClose, onSubmit, onSwitch }) {
  const isIncome = mode === 'income';
  const categories = isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const defaultCategory = isIncome ? 'salary' : 'food';

  const [category, setCategory] = useState(
    prefill?.category && categories.find((c) => c.id === prefill.category)
      ? prefill.category
      : defaultCategory
  );
  const [amount, setAmount] = useState(prefill?.amount ? String(prefill.amount).replace('.', ',') : '');
  const [description, setDescription] = useState(prefill?.description || '');
  const [submitting, setSubmitting] = useState(false);

  // Wenn prefill nach KI-Parse aktualisiert wird, Felder uebernehmen.
  useEffect(() => {
    if (prefill) {
      if (prefill.category && categories.find((c) => c.id === prefill.category)) {
        setCategory(prefill.category);
      }
      if (typeof prefill.amount === 'number') {
        setAmount(String(prefill.amount).replace('.', ','));
      }
      if (typeof prefill.description === 'string') {
        setDescription(prefill.description);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, mode]);

  // Wenn der Modus per Switch geaendert wird, default-Kategorie setzen.
  useEffect(() => {
    if (!prefill || prefill.kind !== mode) {
      setCategory(defaultCategory);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const submit = async (e) => {
    e.preventDefault();
    const amt = Number((amount || '').replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) return;
    setSubmitting(true);
    await onSubmit({ kind: mode, category, amount: amt, description: description.trim() });
    setSubmitting(false);
  };

  return (
    <div className="spending-modal-backdrop" onClick={onClose}>
      <form className="spending-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header className="spending-modal-head">
          <h3>{isIncome ? 'Neue Einnahme' : 'Neue Ausgabe'}</h3>
          <button type="button" className="spending-icon-btn" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="spending-tabs spending-tabs-kind">
          <button
            type="button"
            className={`spending-tab ${isIncome ? 'is-active' : ''}`}
            onClick={() => onSwitch('income')}
          >
            <ArrowDownCircle size={14} /> Einnahme
          </button>
          <button
            type="button"
            className={`spending-tab ${!isIncome ? 'is-active' : ''}`}
            onClick={() => onSwitch('expense')}
          >
            <ArrowUpCircle size={14} /> Ausgabe
          </button>
        </div>

        {prefill && (
          <div className="spending-ai-hint">
            <Sparkles size={14} /> KI-Vorschlag — bei Bedarf anpassen
          </div>
        )}

        <div className="spending-category-grid">
          {categories.map((c) => (
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
            placeholder={isIncome ? 'z.B. Gehalt Mai' : 'z.B. Einkauf REWE'}
          />
        </label>

        <footer className="spending-modal-foot">
          <button type="button" className="sankey-btn sankey-btn-ghost" onClick={onClose}>Abbrechen</button>
          <button
            type="submit"
            className={`sankey-btn ${isIncome ? 'sankey-btn-income' : 'sankey-btn-primary'}`}
            disabled={!amount || submitting}
          >
            <Plus size={16} /> {submitting ? 'Speichere…' : 'Hinzufügen'}
          </button>
        </footer>
      </form>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Sankey-Layout: berechnet stacked, proportionale Baender zwischen
 * Mitgliedern (source) und Kategorien (target). Jeder Knoten ist so hoch
 * wie die Summe seiner Fluesse. Innerhalb eines Knotens stapeln sich die
 * Baender luekenlos uebereinander — wie in echten Sankey-Charts.
 * ─────────────────────────────────────────────────────────────────────── */
/* 3-Spalten-Sankey:
 *   Spalte 1 (links): Mitglieder mit ihren Einnahmen (Source)
 *   Spalte 2 (Mitte): "Gesamteinnahmen" Pool-Knoten
 *   Spalte 3 (rechts): Ausgaben-Kategorien + optional "Verbleibend" (Spar-Knoten)
 *
 * Hoehe jedes Knotens proportional zu seiner Summe — wie auf dem
 * Referenzbild (Salary -> Income -> Spending categories -> Savings).
 */
function buildSankeyLayout({
  members, expenseCategories, expenses, incomes,
  memberMap, totalIncome, totalExpense,
}) {
  const empty = (incomes?.length || 0) === 0 && (expenses?.length || 0) === 0;
  const WIDTH = 1000;
  const HEIGHT = 380;
  if (empty) {
    return { width: WIDTH, height: HEIGHT, columns: [], bands: [], nodeWidth: 12 };
  }

  const PADDING_TOP = 16;
  const PADDING_BOTTOM = 16;
  const NODE_WIDTH = 12;
  const NODE_GAP = 6;
  const innerHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  // Mitglieder-Einnahmen aggregieren
  const memberIncomeTotals = {};
  incomes.forEach((e) => {
    memberIncomeTotals[e.user_id] = (memberIncomeTotals[e.user_id] || 0) + e.amount;
  });

  // Mitglieder-Ausgaben aggregieren (fuer Source-Tier wenn keine Einnahmen)
  const memberExpenseTotals = {};
  expenses.forEach((e) => {
    memberExpenseTotals[e.user_id] = (memberExpenseTotals[e.user_id] || 0) + e.amount;
  });

  // Wenn Einnahmen erfasst: Source = Mitglieder mit Einnahmen
  // Wenn KEINE Einnahmen: Fallback = Mitglieder mit Ausgaben (so funktioniert
  // die Seite auch ohne Einnahmen-Buchungen weiter).
  const useIncomeMode = totalIncome > 0;
  const sourceTotals = useIncomeMode ? memberIncomeTotals : memberExpenseTotals;

  const sourceMembers = members
    .map((m) => ({
      id: `m-${m.id}`,
      label: m.name,
      color: m.color,
      total: sourceTotals[m.id] || 0,
    }))
    .filter((n) => n.total > 0);

  if (sourceMembers.length === 0) {
    return { width: WIDTH, height: HEIGHT, columns: [], bands: [], nodeWidth: NODE_WIDTH };
  }

  const sourceSum = sourceMembers.reduce((s, n) => s + n.total, 0);

  // Ausgaben-Kategorien als Targets
  const catExpenseTotals = {};
  expenses.forEach((e) => {
    catExpenseTotals[e.category] = (catExpenseTotals[e.category] || 0) + e.amount;
  });
  const targetCategories = expenseCategories.map((c) => ({
    id: `c-${c.id}`,
    label: c.label,
    color: c.color,
    total: catExpenseTotals[c.id] || 0,
  })).filter((n) => n.total > 0);

  // Optional: Verbleibend-Knoten wenn Einnahmen > Ausgaben
  const remaining = useIncomeMode ? Math.max(0, totalIncome - totalExpense) : 0;
  if (remaining > 0) {
    targetCategories.push({ id: 'remaining', label: 'Verbleibend', color: '#10B981', total: remaining });
  }

  const targetSum = targetCategories.reduce((s, n) => s + n.total, 0);

  // Skalierung: groessere der beiden Summen bestimmt die Pixel-pro-Euro
  const refSum = Math.max(sourceSum, targetSum);
  const totalGapsSrc = Math.max(0, sourceMembers.length - 1) * NODE_GAP;
  const totalGapsTgt = Math.max(0, targetCategories.length - 1) * NODE_GAP;
  const scaleSrc = refSum > 0 ? (innerHeight - totalGapsSrc) / refSum : 0;
  const scaleTgt = refSum > 0 ? (innerHeight - totalGapsTgt) / refSum : 0;

  // Drei Spalten: Mitglieder, Total-Knoten, Kategorien
  const colX = [0, WIDTH / 2 - NODE_WIDTH / 2, WIDTH - NODE_WIDTH];

  // Source-Knoten (Mitglieder) — zentriert auf Spalte 1
  const sourceHeightTotal = sourceSum * scaleSrc + totalGapsSrc;
  let cursorSrc = PADDING_TOP + (innerHeight - sourceHeightTotal) / 2;
  const sourceNodes = sourceMembers.map((n) => {
    const h = n.total * scaleSrc;
    const node = { ...n, x: colX[0], y0: cursorSrc, y1: cursorSrc + h, height: h };
    cursorSrc += h + NODE_GAP;
    return node;
  });

  // Mittel-Knoten (Pool): "Gesamteinnahmen" wenn Income-Mode, sonst "Gesamtausgaben"
  const middleTotal = useIncomeMode ? totalIncome : totalExpense;
  const middleHeight = middleTotal * scaleSrc;
  const middleNode = {
    id: 'pool',
    label: useIncomeMode ? 'Gesamteinnahmen' : 'Gesamtausgaben',
    color: useIncomeMode ? '#34D399' : '#60A5FA',
    total: middleTotal,
    x: colX[1],
    y0: PADDING_TOP + (innerHeight - middleHeight) / 2,
    y1: PADDING_TOP + (innerHeight - middleHeight) / 2 + middleHeight,
    height: middleHeight,
  };

  // Target-Knoten (Kategorien) — zentriert auf Spalte 3
  const targetHeightTotal = targetSum * scaleTgt + totalGapsTgt;
  let cursorTgt = PADDING_TOP + (innerHeight - targetHeightTotal) / 2;
  const targetNodes = targetCategories.map((n) => {
    const h = n.total * scaleTgt;
    const node = { ...n, x: colX[2], y0: cursorTgt, y1: cursorTgt + h, height: h };
    cursorTgt += h + NODE_GAP;
    return node;
  });

  // Baender Spalte 1 -> Spalte 2 (Mitglied -> Pool)
  // Innerhalb des Pool-Knotens stacken die Mitglieder von oben nach unten,
  // genauso in der Reihenfolge wie in Spalte 1.
  let cursorMidIn = middleNode.y0;
  const bandsLeft = sourceNodes.map((sNode, i) => {
    const sH = sNode.height;
    const sY0 = sNode.y0;
    const sY1 = sNode.y1;
    const tY0 = cursorMidIn;
    const tY1 = cursorMidIn + sH;
    cursorMidIn += sH;
    return {
      id: `band-l-${i}`,
      sX: sNode.x + NODE_WIDTH,
      tX: middleNode.x,
      sY0, sY1, tY0, tY1,
      value: sNode.total,
      sourceColor: sNode.color,
      targetColor: middleNode.color,
    };
  });

  // Baender Spalte 2 -> Spalte 3 (Pool -> Kategorie)
  let cursorMidOut = middleNode.y0;
  const bandsRight = targetNodes.map((tNode, i) => {
    const tH = tNode.height;
    const sY0 = cursorMidOut;
    const sY1 = cursorMidOut + tH;
    cursorMidOut += tH;
    return {
      id: `band-r-${i}`,
      sX: middleNode.x + NODE_WIDTH,
      tX: tNode.x,
      sY0, sY1,
      tY0: tNode.y0,
      tY1: tNode.y1,
      value: tNode.total,
      sourceColor: middleNode.color,
      targetColor: tNode.color,
    };
  });

  return {
    width: WIDTH,
    height: HEIGHT,
    columns: [
      { nodes: sourceNodes, side: 'left' },
      { nodes: [middleNode], side: 'middle' },
      { nodes: targetNodes, side: 'right' },
    ],
    bands: [...bandsLeft, ...bandsRight],
    nodeWidth: NODE_WIDTH,
    sourceNodes, // alias fuer Rueckwaerts-Kompatibilitaet
    targetNodes,
    middleNode,
  };
}

function bandPath(b) {
  // Filled cubic bezier zwischen 4 Punkten — wie in d3-sankey.
  const midX = (b.sX + b.tX) / 2;
  return [
    `M ${b.sX} ${b.sY0}`,
    `C ${midX} ${b.sY0}, ${midX} ${b.tY0}, ${b.tX} ${b.tY0}`,
    `L ${b.tX} ${b.tY1}`,
    `C ${midX} ${b.tY1}, ${midX} ${b.sY1}, ${b.sX} ${b.sY1}`,
    'Z',
  ].join(' ');
}

function SankeyDiagram({ layout }) {
  const { width, height, columns, bands, nodeWidth } = layout;
  if (!bands || bands.length === 0) return null;

  return (
    <div className="sankey-diagram-wrap">
      <svg
        className="sankey-diagram"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Sankey-Diagramm der gemeinsamen Finanzen"
      >
        <defs>
          {bands.map((b) => (
            <linearGradient key={`grad-${b.id}`} id={`grad-${b.id}`} x1="0%" x2="100%" y1="0%" y2="0%">
              <stop offset="0%" stopColor={b.sourceColor} stopOpacity="0.9" />
              <stop offset="100%" stopColor={b.targetColor} stopOpacity="0.9" />
            </linearGradient>
          ))}
        </defs>

        {/* Proportionale Baender mit Farbverlauf */}
        <g className="sankey-bands">
          {bands.map((b) => (
            <path
              key={b.id}
              d={bandPath(b)}
              fill={`url(#grad-${b.id})`}
              opacity={0.5}
            >
              <title>{fmtAmount(b.value)} €</title>
            </path>
          ))}
        </g>

        {/* Spalten */}
        {(columns || []).map((col, ci) => (
          <g key={`col-${ci}`} className={`sankey-col sankey-col-${col.side}`}>
            {col.nodes.map((n) => {
              const isLeft = col.side === 'left';
              const isMiddle = col.side === 'middle';

              if (isMiddle) {
                return (
                  <g key={n.id}>
                    <rect
                      x={n.x}
                      y={n.y0}
                      width={nodeWidth}
                      height={Math.max(2, n.height)}
                      fill={n.color}
                      rx={3}
                    />
                    <text
                      x={n.x + nodeWidth / 2}
                      y={n.y0 - 8}
                      textAnchor="middle"
                      className="sankey-label sankey-label-middle"
                    >
                      {n.label}
                    </text>
                    <text
                      x={n.x + nodeWidth / 2}
                      y={n.y1 + 18}
                      textAnchor="middle"
                      className="sankey-label sankey-label-middle sankey-label-value"
                    >
                      {fmtAmount(n.total)} €
                    </text>
                  </g>
                );
              }

              const labelX = isLeft ? n.x + nodeWidth + 8 : n.x - 8;
              const anchor = isLeft ? 'start' : 'end';
              return (
                <g key={n.id}>
                  <rect
                    x={n.x}
                    y={n.y0}
                    width={nodeWidth}
                    height={Math.max(2, n.height)}
                    fill={n.color}
                    rx={3}
                  />
                  <text
                    x={labelX}
                    y={n.y0 + n.height / 2}
                    dominantBaseline="middle"
                    textAnchor={anchor}
                    className={`sankey-label sankey-label-${col.side}`}
                  >
                    {isLeft ? compactName(n.label) : n.label} · {fmtAmount(n.total)} €
                  </text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}

/* Mobile: statt unleserlichem Mini-Sankey horizontale Balken
 * fuer Einnahmen, Ausgaben pro Mitglied und Kategorien. */
function MobileFlowView({ members, expenseCategories, summary }) {
  const incomeByMember = summary.byMemberIncome || {};
  const memberIncomeMax = Math.max(...members.map((m) => incomeByMember[m.id] || 0), 1);
  const memberMax = Math.max(...members.map((m) => summary.byMember[m.id] || 0), 1);
  const catMax = Math.max(...expenseCategories.map((c) => summary.byCategory[c.id] || 0), 1);
  const hasIncome = (summary.totalIncome || 0) > 0;
  const hasExpense = (summary.totalExpense || 0) > 0;

  return (
    <div className="spending-mobile-flow">
      {hasIncome && (
        <div className="spending-mobile-block">
          <h4 className="spending-mobile-title">
            <ArrowDownCircle size={14} /> Einnahmen pro Person
          </h4>
          <ul className="spending-bar-list">
            {members.filter((m) => (incomeByMember[m.id] || 0) > 0).map((m) => {
              const value = incomeByMember[m.id] || 0;
              const pct = (value / memberIncomeMax) * 100;
              return (
                <li key={`i-${m.id}`} className="spending-bar-row">
                  <div className="spending-bar-meta">
                    <span className="spending-bar-name">
                      <span className="spending-bar-dot" style={{ background: '#34D399' }} />
                      {compactName(m.name)}
                    </span>
                    <span className="spending-bar-value is-income">+ {fmtAmount(value)} €</span>
                  </div>
                  <div className="spending-bar-track">
                    <span
                      className="spending-bar-fill"
                      style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #34D399, #10B981)' }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {hasExpense && (
        <div className="spending-mobile-block">
          <h4 className="spending-mobile-title">
            <ArrowUpCircle size={14} /> Ausgaben pro Person
          </h4>
          <ul className="spending-bar-list">
            {members.filter((m) => (summary.byMember[m.id] || 0) > 0).map((m) => {
              const value = summary.byMember[m.id] || 0;
              const pct = (value / memberMax) * 100;
              return (
                <li key={m.id} className="spending-bar-row">
                  <div className="spending-bar-meta">
                    <span className="spending-bar-name">
                      <span className="spending-bar-dot" style={{ background: m.color }} />
                      {compactName(m.name)}
                    </span>
                    <span className="spending-bar-value">− {fmtAmount(value)} €</span>
                  </div>
                  <div className="spending-bar-track">
                    <span
                      className="spending-bar-fill"
                      style={{ width: `${pct}%`, background: m.color }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {hasExpense && (
        <div className="spending-mobile-block">
          <h4 className="spending-mobile-title">Wofür ausgegeben</h4>
          <ul className="spending-bar-list">
            {expenseCategories.map((c) => {
              const value = summary.byCategory[c.id] || 0;
              const pct = (value / catMax) * 100;
              return (
                <li key={c.id} className="spending-bar-row">
                  <div className="spending-bar-meta">
                    <span className="spending-bar-name">
                      <span className="spending-bar-dot" style={{ background: c.color }} />
                      {c.label}
                    </span>
                    <span className="spending-bar-value">{fmtAmount(value)} €</span>
                  </div>
                  <div className="spending-bar-track">
                    <span
                      className="spending-bar-fill"
                      style={{ width: `${pct}%`, background: c.color }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
