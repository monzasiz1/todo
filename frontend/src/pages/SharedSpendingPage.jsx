import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, TrendingUp, TrendingDown, Plus, Trash2, X, Check,
  UserPlus, Receipt, Sparkles, ChevronRight, ChevronLeft, LogOut, AlertCircle,
  Wand2, ArrowDownCircle, ArrowUpCircle, Wallet, Loader2, Repeat, Calendar,
} from 'lucide-react';
import { useSharedSpendingStore } from '../store/sharedSpendingStore';
import { useFriendsStore } from '../store/friendsStore';
import SankeyVisualization from '../components/SankeyVisualization';
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

const MONTH_NAMES_DE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function monthLabel(year, month1) {
  return `${MONTH_NAMES_DE[month1 - 1]} ${year}`;
}

function currentMonthKey() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function shiftMonth({ year, month }, delta) {
  let y = year;
  let m = month + delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return { year: y, month: m };
}

const RECURRENCE_LABELS = {
  none: 'Einmalig',
  monthly: 'Monatlich',
  quarterly: 'Vierteljährlich',
  yearly: 'Jährlich',
};

/* Liefert true, wenn ein Eintrag im angegebenen Monat zaehlt:
 * - einmalig: entry_date faellt in den Monat
 * - monatlich: entry_date <= MonatsEnde && (kein Ende oder Ende >= MonatsAnfang)
 * - vierteljaehrlich: zusaetzlich (Monatsabstand % 3 === 0)
 * - jaehrlich: zusaetzlich (Monatsabstand % 12 === 0) */
function isEntryInMonth(entry, year, month) {
  const rawDate = entry.entry_date || entry.created_at;
  if (!rawDate) return false;
  const entryDate = new Date(rawDate);
  if (Number.isNaN(entryDate.getTime())) return false;

  const eY = entryDate.getUTCFullYear();
  const eM = entryDate.getUTCMonth() + 1;

  // Einmalig: muss exakt im Monat liegen
  if (!entry.recurrence || entry.recurrence === 'none') {
    return eY === year && eM === month;
  }

  // Recurring: Start nicht in der Zukunft (relativ zum aktuellen Monat)
  const startDelta = (year - eY) * 12 + (month - eM);
  if (startDelta < 0) return false;

  // End-Datum darf nicht vor dem Monatsanfang liegen
  if (entry.recurrence_end) {
    const end = new Date(entry.recurrence_end);
    if (!Number.isNaN(end.getTime())) {
      const endY = end.getUTCFullYear();
      const endM = end.getUTCMonth() + 1;
      const endDelta = (year - endY) * 12 + (month - endM);
      if (endDelta > 0) return false;
    }
  }

  if (entry.recurrence === 'monthly') return true;
  if (entry.recurrence === 'quarterly') return startDelta % 3 === 0;
  if (entry.recurrence === 'yearly') return startDelta % 12 === 0;
  return false;
}

/* ─────────────────────────────────────────────────────────────────────
 * Premium UI Layer — Background, Cursor, Counter, Sparkline, AI-Card
 * ─────────────────────────────────────────────────────────────────── */

/* Fixed-position animated mesh + floating orbs + noise grain. */
function PremiumBackground() {
  return (
    <div className="spending-bg" aria-hidden="true">
      <div className="spending-bg-mesh" />
      <div className="spending-bg-orb spending-bg-orb-1" />
      <div className="spending-bg-orb spending-bg-orb-2" />
      <div className="spending-bg-orb spending-bg-orb-3" />
      <div className="spending-bg-noise" />
    </div>
  );
}

/* Subtle spotlight that follows the cursor — pointermove via CSS vars,
 * keine React-State-Updates (Performance). */
function CursorSpotlight() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const handler = (e) => {
      el.style.setProperty('--mx', `${e.clientX}px`);
      el.style.setProperty('--my', `${e.clientY}px`);
    };
    window.addEventListener('pointermove', handler, { passive: true });
    return () => window.removeEventListener('pointermove', handler);
  }, []);
  return <div ref={ref} className="spending-cursor-spotlight" aria-hidden="true" />;
}

/* Animiert eine Zahl smooth von vorigen Wert hoch (ease-out-cubic). */
function AnimatedNumber({ value, decimals = 2 }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    const to = Number(value) || 0;
    if (from === to) {
      setDisplay(to);
      return undefined;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setDisplay(to);
      fromRef.current = to;
      return undefined;
    }
    const dur = 700;
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (to - from) * eased;
      setDisplay(v);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    });
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <>
      {display.toLocaleString('de-DE', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </>
  );
}

/* Mini-Sparkline (area + line) — letzte N Monate als Datenreihe. */
function Sparkline({ data, color }) {
  const safeData = data && data.length > 0 ? data : [0, 0];
  const max = Math.max(...safeData, 1);
  const min = Math.min(...safeData, 0);
  const range = Math.max(max - min, 1);
  const points = safeData.map((v, i) => {
    const x = (i / Math.max(safeData.length - 1, 1)) * 100;
    const y = 28 - ((v - min) / range) * 26;
    return { x, y };
  });
  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');
  const area = `0,30 ${polyline} 100,30`;
  const gid = `spark-${color.replace('#', '')}`;
  return (
    <svg className="spending-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.5" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.length > 0 && (
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r="1.8"
          fill={color}
        />
      )}
    </svg>
  );
}

/* Liefert die Summen pro Monat fuer die letzten N Monate (rueckwaerts). */
function buildMonthlyHistory(entries, months = 6) {
  const today = currentMonthKey();
  const result = [];
  let cur = today;
  for (let i = 0; i < months; i += 1) {
    const total = entries
      .filter((e) => isEntryInMonth(e, cur.year, cur.month))
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
    result.unshift(total);
    cur = shiftMonth(cur, -1);
  }
  return result;
}

/* Computes a few human-friendly insights from current vs previous month. */
function buildInsights({
  summary, prevSummary, topCategory, recurringCount,
}) {
  const insights = [];

  if (prevSummary && prevSummary.totalExpense > 0) {
    const diff = ((summary.totalExpense - prevSummary.totalExpense) / prevSummary.totalExpense) * 100;
    const abs = Math.abs(diff);
    if (abs >= 1) {
      insights.push({
        icon: diff < 0 ? 'down' : 'up',
        color: diff < 0 ? '#34D399' : '#F87171',
        text: `Du gibst diesen Monat ${abs.toFixed(0)}% ${diff < 0 ? 'weniger' : 'mehr'} aus als im Vormonat.`,
      });
    }
  }

  if (topCategory && summary.totalExpense > 0) {
    const share = (topCategory[1] / summary.totalExpense) * 100;
    insights.push({
      icon: 'star',
      color: '#A78BFA',
      text: `${categoryLabel(topCategory[0])} macht ${share.toFixed(0)}% deiner Ausgaben aus.`,
    });
  }

  if (summary.totalIncome > 0) {
    const recommended = Math.round(summary.totalIncome * 0.2);
    insights.push({
      icon: 'sparkle',
      color: '#34D399',
      text: `KI-Empfehlung: Spare ${recommended.toLocaleString('de-DE')}€ (20% deiner Einnahmen) für Notgroschen & Rücklagen.`,
    });
  }

  if (recurringCount > 0) {
    insights.push({
      icon: 'repeat',
      color: '#60A5FA',
      text: `${recurringCount} wiederkehrende Buchung${recurringCount === 1 ? '' : 'en'} läuft im Hintergrund — diese erscheinen automatisch in jedem Monat.`,
    });
  }

  if (summary.balance < 0) {
    insights.push({
      icon: 'alert',
      color: '#F87171',
      text: `Achtung: Deine Ausgaben übersteigen die Einnahmen um ${fmtAmount(Math.abs(summary.balance))}€.`,
    });
  }

  return insights.slice(0, 4);
}

function AIInsightCard({ insights }) {
  if (!insights || insights.length === 0) return null;
  return (
    <article className="spending-ai-card">
      <header className="spending-ai-card-head">
        <div className="spending-ai-card-badge">
          <span className="spending-ai-card-pulse" />
          <Sparkles size={12} /> KI-INSIGHTS
        </div>
        <span className="spending-ai-card-sub">Automatisch erkannt</span>
      </header>
      <ul className="spending-ai-card-list">
        {insights.map((ins, i) => (
          <li key={i} className="spending-ai-card-item">
            <span className="spending-ai-card-dot" style={{ background: ins.color, boxShadow: `0 0 12px ${ins.color}66` }} />
            <span>{ins.text}</span>
          </li>
        ))}
      </ul>
    </article>
  );
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
  // Aktuell gewaehlter Monat — default: heute
  const [viewMonth, setViewMonth] = useState(currentMonthKey);

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
    <div className="shared-spending-page is-premium">
      <PremiumBackground />
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
              viewMonth={viewMonth}
              onChangeMonth={setViewMonth}
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
          viewMonth={viewMonth}
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
  group, detailLoading, viewMonth, onChangeMonth,
  onInvite, onAddExpense, onAddIncome, onAIParse,
  onDelete, onLeave, onRemoveMember, onDeleteEntry,
}) {
  const allIncomes = group.incomes || [];
  const allExpenses = group.expenses || [];

  // Eintraege fuer den aktuellen Monat filtern (inkl. recurring)
  const incomes = useMemo(
    () => allIncomes.filter((e) => isEntryInMonth(e, viewMonth.year, viewMonth.month)),
    [allIncomes, viewMonth]
  );
  const filteredExpenses = useMemo(
    () => allExpenses.filter((e) => isEntryInMonth(e, viewMonth.year, viewMonth.month)),
    [allExpenses, viewMonth]
  );
  // Re-bind group.expenses fuer den restlichen Render
  group = { ...group, expenses: filteredExpenses };
  const memberMap = useMemo(() => {
    const map = {};
    map[group.owner_id] = {
      id: group.owner_id,
      name: group.owner_name,
      isOwner: true,
      color: MEMBER_PALETTE[0],
      avatar_url: group.owner_avatar_url || null,
    };
    group.members
      .filter((m) => m.status === 'accepted')
      .forEach((m, i) => {
        map[m.user_id] = {
          id: m.user_id,
          name: m.name,
          isOwner: false,
          color: MEMBER_PALETTE[(i + 1) % MEMBER_PALETTE.length],
          avatar_url: m.avatar_url || null,
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

  // Previous month summary fuer Vergleichs-Insights
  const prevSummary = useMemo(() => {
    const prev = shiftMonth(viewMonth, -1);
    const prevExp = allExpenses.filter((e) => isEntryInMonth(e, prev.year, prev.month));
    const prevInc = allIncomes.filter((e) => isEntryInMonth(e, prev.year, prev.month));
    const totalExpense = prevExp.reduce((s, e) => s + e.amount, 0);
    const totalIncome = prevInc.reduce((s, e) => s + e.amount, 0);
    return { totalExpense, totalIncome, balance: totalIncome - totalExpense };
  }, [allExpenses, allIncomes, viewMonth]);

  // 6-Monats-Historie fuer Sparklines
  const expenseHistory = useMemo(() => buildMonthlyHistory(allExpenses, 6), [allExpenses]);
  const incomeHistory  = useMemo(() => buildMonthlyHistory(allIncomes, 6), [allIncomes]);
  const balanceHistory = useMemo(
    () => incomeHistory.map((inc, i) => inc - (expenseHistory[i] || 0)),
    [incomeHistory, expenseHistory]
  );

  // Anzahl recurring Eintraege (im aktuellen Monat)
  const recurringCount = useMemo(
    () => [...incomes, ...filteredExpenses].filter((e) => e.recurrence && e.recurrence !== 'none').length,
    [incomes, filteredExpenses]
  );

  const insights = useMemo(
    () => buildInsights({ summary, prevSummary, topCategory, recurringCount }),
    [summary, prevSummary, topCategory, recurringCount]
  );

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

      <MonthNavigator viewMonth={viewMonth} onChange={onChangeMonth} />

      <AIQuickInput onParse={onAIParse} />

      <div className="sankey-summary-grid sankey-summary-grid-4">
        <article className="sankey-summary-card spending-card-income spending-card-premium">
          <div className="spending-card-glow" aria-hidden="true" />
          <div className="sankey-summary-icon"><TrendingUp size={20} /></div>
          <span className="sankey-summary-label">Gesamteinnahmen</span>
          <strong>
            <AnimatedNumber value={summary.totalIncome} /> €
          </strong>
          <p>{incomes.length} Einnahme(n)</p>
          <Sparkline data={incomeHistory} color="#34D399" />
        </article>
        <article className="sankey-summary-card spending-card-expense spending-card-premium">
          <div className="spending-card-glow" aria-hidden="true" />
          <div className="sankey-summary-icon"><TrendingDown size={20} /></div>
          <span className="sankey-summary-label">Gesamtausgaben</span>
          <strong>
            <AnimatedNumber value={summary.totalExpense} /> €
          </strong>
          <p>{group.expenses.length} Buchung(en)</p>
          <Sparkline data={expenseHistory} color="#F87171" />
        </article>
        <article className={`sankey-summary-card spending-card-premium ${summary.balance >= 0 ? 'spending-card-balance-pos' : 'spending-card-balance-neg'}`}>
          <div className="spending-card-glow" aria-hidden="true" />
          <div className="sankey-summary-icon"><Wallet size={20} /></div>
          <span className="sankey-summary-label">Bilanz</span>
          <strong>
            {summary.balance >= 0 ? '+' : '−'}<AnimatedNumber value={Math.abs(summary.balance)} /> €
          </strong>
          <p>{summary.balance >= 0 ? 'Überschuss' : 'Defizit'}</p>
          <Sparkline data={balanceHistory} color={summary.balance >= 0 ? '#34D399' : '#F87171'} />
        </article>
        <article className="sankey-summary-card spending-card-premium spending-card-top">
          <div className="spending-card-glow" aria-hidden="true" />
          <div className="sankey-summary-icon"><Sparkles size={20} /></div>
          <span className="sankey-summary-label">Top Kategorie</span>
          <strong>{topCategory ? categoryLabel(topCategory[0]) : '—'}</strong>
          <p>{topCategory ? `${fmtAmount(topCategory[1])} € im größten Fluss.` : 'Noch keine Ausgaben.'}</p>
        </article>
      </div>

      <AIInsightCard insights={insights} />

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
            <SankeyVisualization
              data={{
                members: activeMembers,
                expenses: group.expenses || [],
                incomes: incomes || [],
                expenseCategories: usedExpenseCategories,
              }}
            />
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
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    (m.name || '?').slice(0, 1).toUpperCase()
                  )}
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
              {allEntries.slice(0, 25).map((e) => {
                const rec = e.recurrence || 'none';
                const isRecurring = rec !== 'none';
                const dateStr = e.entry_date
                  ? new Date(e.entry_date).toLocaleDateString('de-DE')
                  : new Date(e.created_at).toLocaleDateString('de-DE');
                return (
                <li key={`${e.kind}-${e.id}`} className={`spending-expense-item ${e.kind === 'income' ? 'is-income' : ''} ${isRecurring ? 'is-recurring' : ''}`}>
                  <span className="spending-expense-dot" style={{ background: categoryColor(e.category) }} />
                  <div className="spending-expense-body">
                    <div className="spending-expense-top">
                      <strong>
                        {e.description || categoryLabel(e.category)}
                        {isRecurring && (
                          <span className="spending-recurrence-badge" title={RECURRENCE_LABELS[rec]}>
                            <Repeat size={10} /> {RECURRENCE_LABELS[rec]}
                          </span>
                        )}
                      </strong>
                      <span className={`spending-expense-amt ${e.kind === 'income' ? 'is-income' : 'is-expense'}`}>
                        {e.kind === 'income' ? '+' : '−'} {fmtAmount(e.amount)} €
                      </span>
                    </div>
                    <span className="spending-expense-meta">
                      {memberMap[e.user_id]?.name || 'Unbekannt'} · {categoryLabel(e.category)} · {dateStr}
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
                );
              })}
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
/* Monats-Navigator: < Februar 2026 >  +  "Heute" wenn nicht aktueller Monat */
function MonthNavigator({ viewMonth, onChange }) {
  const today = currentMonthKey();
  const isCurrent = today.year === viewMonth.year && today.month === viewMonth.month;
  const labelStr = monthLabel(viewMonth.year, viewMonth.month);

  // Letzte 6 Monate als Quick-Picker (Archiv-Strip)
  const recent = useMemo(() => {
    const arr = [];
    let cur = today;
    for (let i = 0; i < 6; i += 1) {
      arr.push(cur);
      cur = shiftMonth(cur, -1);
    }
    return arr.reverse();
  }, []);

  return (
    <div className="spending-month-nav">
      <div className="spending-month-main">
        <button
          type="button"
          className="spending-month-arrow"
          onClick={() => onChange(shiftMonth(viewMonth, -1))}
          aria-label="Vorheriger Monat"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="spending-month-label">
          <Calendar size={16} />
          <strong>{labelStr}</strong>
        </div>
        <button
          type="button"
          className="spending-month-arrow"
          onClick={() => onChange(shiftMonth(viewMonth, 1))}
          aria-label="Nächster Monat"
        >
          <ChevronRight size={18} />
        </button>
        {!isCurrent && (
          <button type="button" className="spending-month-today" onClick={() => onChange(today)}>
            Heute
          </button>
        )}
      </div>
      <div className="spending-month-strip">
        {recent.map((m) => {
          const active = m.year === viewMonth.year && m.month === viewMonth.month;
          return (
            <button
              key={`${m.year}-${m.month}`}
              type="button"
              className={`spending-month-chip ${active ? 'is-active' : ''}`}
              onClick={() => onChange(m)}
            >
              {MONTH_NAMES_DE[m.month - 1].slice(0, 3)}
              <span>{String(m.year).slice(2)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
        avatar_url: f.avatar_url || null,
        avatar_color: f.avatar_color || '#5AC8FA',
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
                    <span className="spending-avatar" style={{ background: f.avatar_color }}>
                      {f.avatar_url ? (
                        <img src={f.avatar_url} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        (f.name || '?').slice(0, 1).toUpperCase()
                      )}
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
function EntryModal({ mode, prefill, viewMonth, onClose, onSubmit, onSwitch }) {
  const isIncome = mode === 'income';
  const categories = isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const defaultCategory = isIncome ? 'salary' : 'food';

  // Default-Datum: heute, ausser wenn der gewaehlte Monat nicht der aktuelle
  // ist — dann erster Tag des gewaehlten Monats.
  const defaultEntryDate = useMemo(() => {
    const today = new Date();
    const cur = currentMonthKey();
    if (viewMonth && (viewMonth.year !== cur.year || viewMonth.month !== cur.month)) {
      const m = String(viewMonth.month).padStart(2, '0');
      return `${viewMonth.year}-${m}-01`;
    }
    return today.toISOString().slice(0, 10);
  }, [viewMonth]);

  const [category, setCategory] = useState(
    prefill?.category && categories.find((c) => c.id === prefill.category)
      ? prefill.category
      : defaultCategory
  );
  const [amount, setAmount] = useState(prefill?.amount ? String(prefill.amount).replace('.', ',') : '');
  const [description, setDescription] = useState(prefill?.description || '');
  const [recurrence, setRecurrence] = useState(prefill?.recurrence || 'none');
  const [entryDate, setEntryDate] = useState(defaultEntryDate);
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
      if (prefill.recurrence) {
        setRecurrence(prefill.recurrence);
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
    await onSubmit({
      kind: mode,
      category,
      amount: amt,
      description: description.trim(),
      recurrence,
      entry_date: entryDate || null,
    });
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

        <div className="spending-field">
          <span><Repeat size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Wiederholung</span>
          <div className="spending-recurrence-grid">
            {[
              { id: 'none',      label: 'Einmalig' },
              { id: 'monthly',   label: 'Monatlich' },
              { id: 'quarterly', label: 'Alle 3 Monate' },
              { id: 'yearly',    label: 'Jährlich' },
            ].map((r) => (
              <button
                key={r.id}
                type="button"
                className={`spending-recurrence-btn ${recurrence === r.id ? 'is-active' : ''}`}
                onClick={() => setRecurrence(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <label className="spending-field">
          <span>{recurrence === 'none' ? 'Datum' : 'Startet ab'}</span>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
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
/* 4-Tier-Sankey:
 *   T1 (links):       Personen / Einnahmenquellen
 *   T2 (mid-links):   Gemeinsamer Geldpool
 *   T3 (mid-rechts):  Hauptkategorien + Verbleibend
 *   T4 (rechts):      Einzelne Transaktionen (top 12)
 *
 * Hoehe jedes Knotens proportional zu seiner Summe. Skalierung global,
 * damit alle Tiers proportional bleiben (echtes Sankey-Verhalten).
 */
function buildSankeyLayout({
  members, expenseCategories, expenses, incomes,
  memberMap, totalIncome, totalExpense,
}) {
  const empty = (incomes?.length || 0) === 0 && (expenses?.length || 0) === 0;
  const WIDTH = 1320;
  const HEIGHT = 560;
  const NODE_WIDTH = 14;

  if (empty) {
    return { width: WIDTH, height: HEIGHT, columns: [], bands: [], nodeWidth: NODE_WIDTH };
  }

  const PADDING_TOP = 56;
  const PADDING_BOTTOM = 56;
  const NODE_GAP = 6;
  const innerHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  // ── Tier 1: Personen (Einnahmen oder Ausgaben-Fallback) ─────────────
  const memberIncomeTotals = {};
  incomes.forEach((e) => {
    memberIncomeTotals[e.user_id] = (memberIncomeTotals[e.user_id] || 0) + e.amount;
  });
  const memberExpenseTotals = {};
  expenses.forEach((e) => {
    memberExpenseTotals[e.user_id] = (memberExpenseTotals[e.user_id] || 0) + e.amount;
  });
  const useIncomeMode = totalIncome > 0;
  const sourceTotals = useIncomeMode ? memberIncomeTotals : memberExpenseTotals;

  const persons = members
    .map((m) => ({
      id: `p-${m.id}`,
      label: m.name,
      color: m.color,
      total: sourceTotals[m.id] || 0,
    }))
    .filter((n) => n.total > 0);

  if (persons.length === 0) {
    return { width: WIDTH, height: HEIGHT, columns: [], bands: [], nodeWidth: NODE_WIDTH };
  }
  const personsSum = persons.reduce((s, n) => s + n.total, 0);

  // ── Tier 2: Pool ─────────────────────────────────────────────────────
  const poolTotal = useIncomeMode ? totalIncome : totalExpense;
  const poolLabel = useIncomeMode ? 'Gemeinsames Budget' : 'Gesamtausgaben';
  const poolColor = useIncomeMode ? '#34D399' : '#60A5FA';

  // ── Tier 3: Kategorien + Verbleibend ────────────────────────────────
  const catExpenseTotals = {};
  expenses.forEach((e) => {
    catExpenseTotals[e.category] = (catExpenseTotals[e.category] || 0) + e.amount;
  });
  const cats = expenseCategories
    .map((c) => ({
      id: `c-${c.id}`,
      rawId: c.id,
      label: c.label,
      color: c.color,
      total: catExpenseTotals[c.id] || 0,
    }))
    .filter((n) => n.total > 0);

  const remaining = useIncomeMode ? Math.max(0, totalIncome - totalExpense) : 0;
  if (remaining > 0) {
    cats.push({ id: 'c-remaining', rawId: 'remaining', label: 'Verbleibend', color: '#10B981', total: remaining });
  }
  const catsSum = cats.reduce((s, n) => s + n.total, 0);

  // ── Tier 4: Einzelne Transaktionen (max 12, gruppiert nach Kategorie) ─
  const topExpenses = [...expenses].sort((a, b) => b.amount - a.amount).slice(0, 12);
  const txByCat = {};
  topExpenses.forEach((e) => {
    if (!txByCat[e.category]) txByCat[e.category] = [];
    txByCat[e.category].push(e);
  });

  // ── Skalierung ──────────────────────────────────────────────────────
  const refSum = Math.max(personsSum, poolTotal, catsSum);
  // Berechne pro Tier den verfuegbaren Platz (innerHeight minus gaps)
  const personsGaps = Math.max(0, persons.length - 1) * NODE_GAP;
  const catsGaps = Math.max(0, cats.length - 1) * NODE_GAP;
  // Wir nehmen den restriktivsten Tier (mit den meisten Gaps) als Skalierungs-
  // Basis, damit nichts overflowt
  const maxGaps = Math.max(personsGaps, catsGaps);
  const scale = refSum > 0 ? (innerHeight - maxGaps) / refSum : 0;

  // ── X-Koordinaten der 4 Spalten ─────────────────────────────────────
  const colX = [
    160,                    // Tier 1 — Personen (links, Labels gehen nach links)
    Math.round(WIDTH * 0.34), // Tier 2 — Pool
    Math.round(WIDTH * 0.60), // Tier 3 — Kategorien
    Math.round(WIDTH * 0.85), // Tier 4 — Transaktionen (Labels gehen nach rechts)
  ];

  // ── Tier 1 Knoten positionieren (vertikal zentriert) ────────────────
  const personsHTotal = personsSum * scale + personsGaps;
  let cursorP = PADDING_TOP + (innerHeight - personsHTotal) / 2;
  const personNodes = persons.map((n) => {
    const h = n.total * scale;
    const node = { ...n, x: colX[0], y0: cursorP, y1: cursorP + h, height: h };
    cursorP += h + NODE_GAP;
    return node;
  });

  // ── Tier 2 Pool-Knoten (zentriert) ──────────────────────────────────
  const poolH = poolTotal * scale;
  const poolNode = {
    id: 'pool',
    label: poolLabel,
    color: poolColor,
    total: poolTotal,
    x: colX[1],
    y0: PADDING_TOP + (innerHeight - poolH) / 2,
    y1: PADDING_TOP + (innerHeight - poolH) / 2 + poolH,
    height: poolH,
  };

  // ── Tier 3 Kategorien (zentriert) ───────────────────────────────────
  const catsHTotal = catsSum * scale + catsGaps;
  let cursorC = PADDING_TOP + (innerHeight - catsHTotal) / 2;
  const catNodes = cats.map((n) => {
    const h = n.total * scale;
    const node = { ...n, x: colX[2], y0: cursorC, y1: cursorC + h, height: h };
    cursorC += h + NODE_GAP;
    return node;
  });

  // ── Tier 4 Transaktionen — stacken innerhalb ihrer Kategorie ────────
  const txNodes = [];
  catNodes.forEach((catNode) => {
    if (catNode.rawId === 'remaining') return;
    const txs = (txByCat[catNode.rawId] || []).sort((a, b) => b.amount - a.amount);
    const txSum = txs.reduce((s, t) => s + t.amount, 0);
    const remainder = catNode.total - txSum;

    let cursorT = catNode.y0;
    txs.forEach((tx) => {
      const h = tx.amount * scale;
      txNodes.push({
        id: `t-${tx.id}`,
        catId: catNode.id,
        label: tx.description || categoryLabel(tx.category),
        color: catNode.color,
        total: tx.amount,
        x: colX[3],
        y0: cursorT,
        y1: cursorT + h,
        height: h,
      });
      cursorT += h;
    });
    if (remainder > 0.005) {
      const h = remainder * scale;
      txNodes.push({
        id: `t-other-${catNode.id}`,
        catId: catNode.id,
        label: `Weitere ${catNode.label}`,
        color: catNode.color,
        total: remainder,
        x: colX[3],
        y0: cursorT,
        y1: cursorT + h,
        height: h,
        isOther: true,
      });
    }
  });

  // ── Baender T1 → T2 (Person → Pool) ─────────────────────────────────
  let cursorIn = poolNode.y0;
  const bands12 = personNodes.map((p, i) => {
    const tY0 = cursorIn;
    const tY1 = cursorIn + p.height;
    cursorIn += p.height;
    return {
      id: `b12-${i}`,
      sX: p.x + NODE_WIDTH,
      tX: poolNode.x,
      sY0: p.y0, sY1: p.y1,
      tY0, tY1,
      value: p.total,
      sourceColor: p.color,
      targetColor: poolNode.color,
    };
  });

  // ── Baender T2 → T3 (Pool → Kategorie) ──────────────────────────────
  let cursorOut = poolNode.y0;
  const bands23 = catNodes.map((c, i) => {
    const sY0 = cursorOut;
    const sY1 = cursorOut + c.height;
    cursorOut += c.height;
    return {
      id: `b23-${i}`,
      sX: poolNode.x + NODE_WIDTH,
      tX: c.x,
      sY0, sY1,
      tY0: c.y0, tY1: c.y1,
      value: c.total,
      sourceColor: poolNode.color,
      targetColor: c.color,
    };
  });

  // ── Baender T3 → T4 (Kategorie → Transaktion) ──────────────────────
  const bands34 = txNodes.map((tx, i) => {
    // Quelle: Kategorie-Knoten rechte Kante an gleichen y-Positionen wie tx
    return {
      id: `b34-${i}`,
      sX: colX[2] + NODE_WIDTH,
      tX: tx.x,
      sY0: tx.y0, sY1: tx.y1,
      tY0: tx.y0, tY1: tx.y1,
      value: tx.total,
      sourceColor: tx.color,
      targetColor: tx.color,
    };
  });

  return {
    width: WIDTH,
    height: HEIGHT,
    columns: [
      { nodes: personNodes, side: 'persons' },
      { nodes: [poolNode],  side: 'pool' },
      { nodes: catNodes,    side: 'cats' },
      { nodes: txNodes,     side: 'tx' },
    ],
    bands: [...bands12, ...bands23, ...bands34],
    nodeWidth: NODE_WIDTH,
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
              <stop offset="0%" stopColor={b.sourceColor} stopOpacity="0.95" />
              <stop offset="100%" stopColor={b.targetColor} stopOpacity="0.95" />
            </linearGradient>
          ))}
          {/* Subtiler Glow um Knoten-Balken */}
          <filter id="sankey-node-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Proportionale Baender mit Farbverlauf */}
        <g className="sankey-bands">
          {bands.map((b) => (
            <path
              key={b.id}
              d={bandPath(b)}
              fill={`url(#grad-${b.id})`}
              opacity={0.55}
            >
              <title>{fmtAmount(b.value)} €</title>
            </path>
          ))}
        </g>

        {/* Spalten — pro Tier eigener Label-Stil */}
        {(columns || []).map((col, ci) => (
          <g key={`col-${ci}`} className={`sankey-col sankey-col-${col.side}`}>
            {col.nodes.map((n) => (
              <SankeyNodeLabel key={n.id} node={n} side={col.side} nodeWidth={nodeWidth} />
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

function SankeyNodeLabel({ node, side, nodeWidth }) {
  const cy = node.y0 + node.height / 2;
  // Mindesthoehe fuer 2-Zeilen-Label (Name + Wert)
  const showSub = node.height >= 28;

  const rect = (
    <rect
      x={node.x}
      y={node.y0}
      width={nodeWidth}
      height={Math.max(2, node.height)}
      fill={node.color}
      rx={5}
      filter={side === 'pool' ? 'url(#sankey-node-glow)' : undefined}
    />
  );

  // Tier 2: Pool — Label oben + Wert unten zentriert
  if (side === 'pool') {
    return (
      <g>
        {rect}
        <text
          x={node.x + nodeWidth / 2}
          y={node.y0 - 22}
          textAnchor="middle"
          className="sankey-label sankey-label-pool"
        >
          {node.label}
        </text>
        <text
          x={node.x + nodeWidth / 2}
          y={node.y1 + 36}
          textAnchor="middle"
          className="sankey-label sankey-label-pool sankey-label-value"
        >
          {fmtAmount(node.total)} €
        </text>
      </g>
    );
  }

  // Tier 1: Personen — Labels nach LINKS vom Knoten
  if (side === 'persons') {
    const labelX = node.x - 12;
    const nameText = compactName(node.label);
    if (!showSub) {
      return (
        <g>
          {rect}
          <text
            x={labelX} y={cy}
            dominantBaseline="middle"
            textAnchor="end"
            className="sankey-label sankey-label-persons"
          >
            {nameText} · {fmtAmount(node.total)} €
          </text>
        </g>
      );
    }
    return (
      <g>
        {rect}
        <text
          x={labelX} y={cy - 8}
          dominantBaseline="middle"
          textAnchor="end"
          className="sankey-label sankey-label-persons"
        >
          {nameText}
        </text>
        <text
          x={labelX} y={cy + 9}
          dominantBaseline="middle"
          textAnchor="end"
          className="sankey-label sankey-label-persons sankey-label-sub"
        >
          {fmtAmount(node.total)} €
        </text>
      </g>
    );
  }

  // Tier 3: Kategorien — Labels INNERHALB der Band-Area, rechts vom Knoten
  if (side === 'cats') {
    const labelX = node.x + nodeWidth + 8;
    if (!showSub) {
      // Nur Name + Wert in einer Zeile, wenn Knoten zu klein
      return (
        <g>
          {rect}
          <text
            x={labelX} y={cy}
            dominantBaseline="middle"
            textAnchor="start"
            className="sankey-label sankey-label-cats"
          >
            {node.label} · {fmtAmount(node.total)} €
          </text>
        </g>
      );
    }
    return (
      <g>
        {rect}
        <text
          x={labelX} y={cy - 8}
          dominantBaseline="middle"
          textAnchor="start"
          className="sankey-label sankey-label-cats"
        >
          {node.label}
        </text>
        <text
          x={labelX} y={cy + 9}
          dominantBaseline="middle"
          textAnchor="start"
          className="sankey-label sankey-label-cats sankey-label-sub"
        >
          {fmtAmount(node.total)} €
        </text>
      </g>
    );
  }

  // Tier 4: Transaktionen — Labels nach RECHTS vom Knoten
  if (side === 'tx') {
    // Skip label entirely fuer sehr kleine Baender
    if (node.height < 8) {
      return rect;
    }
    const labelX = node.x + nodeWidth + 10;
    if (node.height < 24) {
      // Eine Zeile: Name + Betrag kompakt
      return (
        <g>
          {rect}
          <text
            x={labelX} y={cy}
            dominantBaseline="middle"
            textAnchor="start"
            className="sankey-label sankey-label-tx"
          >
            {node.label} · {fmtAmount(node.total)} €
          </text>
        </g>
      );
    }
    return (
      <g>
        {rect}
        <text
          x={labelX} y={cy - 8}
          dominantBaseline="middle"
          textAnchor="start"
          className="sankey-label sankey-label-tx"
        >
          {node.label}
        </text>
        <text
          x={labelX} y={cy + 9}
          dominantBaseline="middle"
          textAnchor="start"
          className="sankey-label sankey-label-tx sankey-label-sub"
        >
          {fmtAmount(node.total)} €
        </text>
      </g>
    );
  }

  return rect;
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
