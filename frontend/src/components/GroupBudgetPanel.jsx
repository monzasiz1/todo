import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, TrendingUp, TrendingDown, ArrowRight, Loader2, Sparkles, Lock, Users, ChevronDown } from 'lucide-react';
import { api } from '../utils/api';
import { useTaskStore } from '../store/taskStore';
import {
  fmtAmount, currentMonthKey, isEntryInMonth, amountForMonth,
} from '../lib/spending';
import './GroupBudgetPanel.css';

function initials(name) {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

/**
 * GroupBudgetPanel — Einstieg ins gemeinsame Budget einer Gruppe.
 * - Nicht aktiviert: Aktivierungs-Karte (Owner/Admin kann aktivieren).
 * - Aktiviert: kompakte Vorschau (Mitglieder + Monats-Saldo) + "Budget oeffnen"
 *   -> volle Budget-Ansicht (SharedSpendingPage, ?group=).
 */
export default function GroupBudgetPanel({ groupId }) {
  const navigate = useNavigate();
  const addToast = useTaskStore((s) => s.addToast);
  const [budget, setBudget] = useState(null);
  const [canActivate, setCanActivate] = useState(false);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [showAccess, setShowAccess] = useState(false);
  const [savingAccessId, setSavingAccessId] = useState(null);

  const load = async () => {
    try {
      const data = await api.getGroupBudget(groupId);
      setBudget(data.group || null);
      setCanActivate(!!data.can_activate);
      setLocked(!!data.locked);
    } catch {
      /* belassen */
    } finally {
      setLoading(false);
    }
  };

  const toggleAccess = async (member) => {
    setSavingAccessId(member.user_id);
    try {
      const data = await api.setGroupBudgetAccess(groupId, member.user_id, !member.budget_allowed);
      if (data.group) setBudget(data.group);
      addToast(member.budget_allowed ? `${member.name} hat keinen Budget-Zugriff mehr` : `${member.name} darf jetzt aufs Budget`);
    } catch (err) {
      addToast(err?.message || 'Änderung fehlgeschlagen', 'error');
    } finally {
      setSavingAccessId(null);
    }
  };
  useEffect(() => { setLoading(true); load(); /* eslint-disable-next-line */ }, [groupId]);

  const activate = async () => {
    setActivating(true);
    try {
      const data = await api.activateGroupBudget(groupId);
      setBudget(data.group);
      addToast('Gruppen-Budget aktiviert');
    } catch (err) {
      addToast(err?.message || 'Aktivierung fehlgeschlagen', 'error');
    } finally {
      setActivating(false);
    }
  };

  const deactivate = async () => {
    if (!window.confirm('Gruppen-Budget deaktivieren? Alle Einträge dieses Budgets werden gelöscht.')) return;
    try {
      await api.deactivateGroupBudget(groupId);
      setBudget(null);
      setCanActivate(true);
      addToast('Gruppen-Budget deaktiviert');
    } catch (err) {
      addToast(err?.message || 'Deaktivieren fehlgeschlagen', 'error');
    }
  };

  const totals = useMemo(() => {
    if (!budget) return { income: 0, expense: 0, balance: 0 };
    const { year, month } = currentMonthKey();
    const ov = budget.overrides || [];
    let income = 0, expense = 0;
    for (const e of [...(budget.incomes || []), ...(budget.expenses || [])]) {
      if (!isEntryInMonth(e, year, month, ov)) continue;
      const amt = amountForMonth(e, year, month, ov);
      if (e.kind === 'income') income += amt; else expense += amt;
    }
    return { income, expense, balance: income - expense };
  }, [budget]);

  const open = () => navigate(`/app/shared-spending?group=${groupId}`);

  if (loading) {
    return <div className="gbud-connect-loading" style={{ padding: 40 }}><Loader2 size={20} className="gbud-spin" /></div>;
  }

  // ── Pro-Nutzer gesperrt: kein Budget-Zugriff ──
  if (locked) {
    return (
      <div className="gbud-activate">
        <div className="gbud-activate-ic"><Lock size={24} /></div>
        <h3 className="gbud-activate-title">Kein Budget-Zugriff</h3>
        <p className="gbud-activate-sub">
          Ein Admin dieser Gruppe hat dir den Zugriff auf das gemeinsame Budget nicht freigegeben.
          Wende dich an eine:n Admin, wenn du Zugriff brauchst.
        </p>
      </div>
    );
  }

  // ── Noch nicht aktiviert: Aktivierungs-Karte ──
  if (!budget) {
    return (
      <div className="gbud-activate">
        <div className="gbud-activate-ic"><Wallet size={26} /></div>
        <h3 className="gbud-activate-title">Gemeinsames Budget</h3>
        <p className="gbud-activate-sub">
          Verwaltet Ein- & Ausgaben dieser Gruppe zusammen – mit Aufteilung, Verlauf
          und Statistiken. Nach der Aktivierung erscheint es auch unter <strong>Budget</strong>.
        </p>
        <ul className="gbud-activate-feats">
          <li><Sparkles size={14} /> KI-Eingabe & Kategorien</li>
          <li><TrendingUp size={14} /> Einnahmen, Ausgaben & Splits</li>
          <li><Wallet size={14} /> Saldo & Monatsverlauf</li>
        </ul>
        {canActivate ? (
          <button className="gbud-activate-btn" onClick={activate} disabled={activating}>
            {activating ? <Loader2 size={17} className="gbud-spin" /> : <Sparkles size={17} />}
            Budget aktivieren
          </button>
        ) : (
          <div className="gbud-activate-locked">
            <Lock size={14} /> Nur ein Gruppen-Admin kann das Budget aktivieren.
          </div>
        )}
      </div>
    );
  }

  // ── Aktiviert: Vorschau-Karte ──
  const members = budget.members || [];
  // Owner/Admins haben immer Zugriff → nur normale Mitglieder sind individuell schaltbar.
  const manageableMembers = members.filter((m) => m.role !== 'owner' && m.role !== 'admin');
  return (
    <div className="gbud-connect">
      <div className="gbud-connect-head">
        <span className="gbud-connect-ic"><Wallet size={20} /></span>
        <div className="gbud-connect-texts">
          <strong>Gemeinsames Budget</strong>
          <span>Ein- & Ausgaben dieser Gruppe – zusammen verwalten</span>
        </div>
        {members.length > 0 && (
          <div className="gbud-connect-members">
            {members.slice(0, 5).map((m) => (
              <span key={m.user_id} className="gbud-avatar" style={{ background: m.avatar_color || '#5856D6' }}>
                {m.avatar_url ? <img src={m.avatar_url} alt={m.name} /> : initials(m.name)}
              </span>
            ))}
            {members.length > 5 && <span className="gbud-avatar gbud-avatar-more">+{members.length - 5}</span>}
          </div>
        )}
      </div>

      <div className="gbud-connect-stats">
        <div className="gbud-connect-stat">
          <span className="gbud-cs-ic income"><TrendingUp size={14} /></span>
          <div>
            <span className="gbud-cs-label">Einnahmen</span>
            <span className="gbud-cs-val income">+{fmtAmount(totals.income)} €</span>
          </div>
        </div>
        <div className="gbud-connect-stat">
          <span className="gbud-cs-ic expense"><TrendingDown size={14} /></span>
          <div>
            <span className="gbud-cs-label">Ausgaben</span>
            <span className="gbud-cs-val expense">−{fmtAmount(totals.expense)} €</span>
          </div>
        </div>
        <div className="gbud-connect-stat">
          <span className={`gbud-cs-ic ${totals.balance >= 0 ? 'bal-pos' : 'expense'}`}><Wallet size={14} /></span>
          <div>
            <span className="gbud-cs-label">Saldo (Monat)</span>
            <span className={`gbud-cs-val ${totals.balance >= 0 ? 'bal-pos' : 'expense'}`}>
              {totals.balance >= 0 ? '+' : '−'}{fmtAmount(Math.abs(totals.balance))} €
            </span>
          </div>
        </div>
      </div>

      <button className="gbud-connect-open" onClick={open}>
        Budget öffnen <ArrowRight size={17} />
      </button>

      {budget.is_owner && manageableMembers.length > 0 && (
        <div className="gbud-access">
          <button className={`gbud-access-toggle ${showAccess ? 'is-open' : ''}`} onClick={() => setShowAccess((v) => !v)}>
            <Users size={15} />
            <span>Budget-Zugriff verwalten</span>
            <ChevronDown size={16} className="gbud-access-chevron" />
          </button>
          {showAccess && (
            <div className="gbud-access-list">
              <p className="gbud-access-hint">
                Lege fest, wer aufs gemeinsame Budget zugreifen darf — unabhängig von der Rolle.
                Admins haben immer Zugriff.
              </p>
              {manageableMembers.map((m) => (
                <div key={m.user_id} className="gbud-access-row">
                  <span className="gbud-avatar" style={{ background: m.avatar_color || '#5856D6' }}>
                    {m.avatar_url ? <img src={m.avatar_url} alt={m.name} /> : initials(m.name)}
                  </span>
                  <span className="gbud-access-name">{m.name}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={m.budget_allowed !== false}
                    className={`gbud-switch ${m.budget_allowed !== false ? 'is-on' : ''}`}
                    disabled={savingAccessId === m.user_id}
                    onClick={() => toggleAccess(m)}
                  >
                    <span className="gbud-switch-knob" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {budget.is_owner && (
        <button className="gbud-connect-deactivate" onClick={deactivate}>
          Budget deaktivieren
        </button>
      )}
    </div>
  );
}
