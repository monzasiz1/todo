import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, TrendingUp, TrendingDown, ArrowRight, Loader2 } from 'lucide-react';
import { api } from '../utils/api';
import {
  fmtAmount, currentMonthKey, isEntryInMonth, amountForMonth,
} from '../lib/spending';

function initials(name) {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

/**
 * GroupBudgetPanel — Verbindung zur echten Budget-Funktion.
 * Zeigt eine kompakte Vorschau (Mitglieder + Saldo dieses Monats) und oeffnet
 * das vollwertige gemeinsame Budget der Gruppe (SharedSpendingPage, ?group=).
 */
export default function GroupBudgetPanel({ groupId }) {
  const navigate = useNavigate();
  const [budget, setBudget] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getGroupBudget(groupId)
      .then((data) => { if (!cancelled) setBudget(data.group); })
      .catch(() => { /* still let user open it */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [groupId]);

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
  const members = budget?.members || [];

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

      {loading ? (
        <div className="gbud-connect-stats gbud-connect-loading"><Loader2 size={18} className="gbud-spin" /></div>
      ) : (
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
      )}

      <button className="gbud-connect-open" onClick={open}>
        Budget öffnen <ArrowRight size={17} />
      </button>
    </div>
  );
}
