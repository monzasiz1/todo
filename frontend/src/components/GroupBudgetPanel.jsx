import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, Plus, Trash2, TrendingUp, TrendingDown, ChevronLeft, ChevronRight,
  Loader2, X, ArrowDownCircle, ArrowUpCircle, Repeat,
} from 'lucide-react';
import { api } from '../utils/api';
import { useTaskStore } from '../store/taskStore';
import {
  EXPENSE_CATEGORIES, INCOME_CATEGORIES, RECURRENCE_LABELS,
  fmtAmount, monthLabel, currentMonthKey, shiftMonth,
  isEntryInMonth, amountForMonth, getCategoryLabelWithCustom, getCategoryColorWithCustom,
} from '../lib/spending';

function initials(name) {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

/**
 * GroupBudgetPanel — gemeinsames Budget einer echten Gruppe.
 * Mitglieder = Gruppen-Mitglieder; Ein-/Ausgaben werden zusammen verwaltet.
 *
 * Props:
 *   groupId  – ID der echten Gruppe (groups)
 *   isAdmin  – Gruppen-Owner/Admin (darf fremde Eintraege loeschen)
 *   userId   – aktueller Nutzer (eigene Eintraege loeschbar)
 */
export default function GroupBudgetPanel({ groupId, isAdmin = false, userId = null }) {
  const addToast = useTaskStore((s) => s.addToast);
  const [budget, setBudget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(currentMonthKey);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const emptyForm = { kind: 'expense', amount: '', category: 'food', description: '', entry_date: new Date().toISOString().slice(0, 10), recurrence: 'none' };
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    try {
      const data = await api.getGroupBudget(groupId);
      setBudget(data.group);
    } catch (err) {
      addToast(err?.message || 'Budget konnte nicht geladen werden', 'error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { setLoading(true); load(); /* eslint-disable-next-line */ }, [groupId]);

  const spendingId = budget?.id;
  const overrides = budget?.overrides || [];
  const customCats = budget?.custom_categories || [];
  const allEntries = useMemo(
    () => [...(budget?.incomes || []), ...(budget?.expenses || [])],
    [budget]
  );

  const monthEntries = useMemo(() => {
    return allEntries
      .filter((e) => isEntryInMonth(e, month.year, month.month, overrides))
      .sort((a, b) => new Date(b.entry_date || b.created_at) - new Date(a.entry_date || a.created_at));
  }, [allEntries, month, overrides]);

  const totals = useMemo(() => {
    let income = 0, expense = 0;
    for (const e of monthEntries) {
      const amt = amountForMonth(e, month.year, month.month, overrides);
      if (e.kind === 'income') income += amt; else expense += amt;
    }
    return { income, expense, balance: income - expense };
  }, [monthEntries, month, overrides]);

  const categoryOptions = useMemo(() => {
    const base = form.kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    const custom = customCats
      .filter((c) => c.kind === form.kind)
      .map((c) => ({ id: `custom:${c.id}`, label: c.label, color: c.color }));
    return [...base, ...custom];
  }, [form.kind, customCats]);

  const switchKind = (kind) => {
    const firstCat = (kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)[0].id;
    setForm((f) => ({ ...f, kind, category: firstCat }));
  };

  const submit = async () => {
    const amount = Number(String(form.amount).replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) { addToast('Bitte einen gültigen Betrag eingeben', 'error'); return; }
    setSaving(true);
    try {
      await api.addSpendingEntry(spendingId, {
        kind: form.kind,
        category: form.category,
        amount,
        description: form.description.trim().slice(0, 500),
        recurrence: form.recurrence,
        entry_date: form.entry_date,
        recurrence_end: null,
      });
      setShowAdd(false);
      setForm(emptyForm);
      await load();
      addToast(form.kind === 'income' ? 'Einnahme hinzugefügt' : 'Ausgabe hinzugefügt');
    } catch (err) {
      // 402 (Budget-Limit) wird global als UpgradeModal angezeigt
      if (err?.status !== 402) addToast(err?.message || 'Speichern fehlgeschlagen', 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async (entry) => {
    setDeletingId(entry.id);
    try {
      await api.deleteSpendingEntry(spendingId, entry.id);
      await load();
    } catch (err) {
      addToast(err?.message || 'Löschen fehlgeschlagen', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return <div className="gbud-loading"><Loader2 size={22} className="gbud-spin" /></div>;
  }
  if (!budget) {
    return <div className="gbud-empty">Budget konnte nicht geladen werden.</div>;
  }

  const members = budget.members || [];
  const isCurrentMonth = month.year === currentMonthKey().year && month.month === currentMonthKey().month;

  return (
    <div className="gbud">
      {/* Kopf: Monat + Mitglieder */}
      <div className="gbud-head">
        <div className="gbud-monthnav">
          <button className="gbud-monthbtn" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Vorheriger Monat"><ChevronLeft size={17} /></button>
          <span className="gbud-month">{monthLabel(month.year, month.month)}</span>
          <button className="gbud-monthbtn" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Nächster Monat"><ChevronRight size={17} /></button>
          {!isCurrentMonth && (
            <button className="gbud-today" onClick={() => setMonth(currentMonthKey())}>Heute</button>
          )}
        </div>
        <div className="gbud-members" title={`${members.length} Mitglieder verwalten dieses Budget`}>
          {members.slice(0, 5).map((m) => (
            <span key={m.user_id} className="gbud-avatar" style={{ background: m.avatar_color || '#5856D6' }}>
              {m.avatar_url ? <img src={m.avatar_url} alt={m.name} /> : initials(m.name)}
            </span>
          ))}
          {members.length > 5 && <span className="gbud-avatar gbud-avatar-more">+{members.length - 5}</span>}
        </div>
      </div>

      {/* Summen */}
      <div className="gbud-stats">
        <div className="gbud-stat gbud-stat-income">
          <div className="gbud-stat-ic"><TrendingUp size={15} /></div>
          <div className="gbud-stat-txt">
            <span className="gbud-stat-label">Einnahmen</span>
            <span className="gbud-stat-val">+{fmtAmount(totals.income)} €</span>
          </div>
        </div>
        <div className="gbud-stat gbud-stat-expense">
          <div className="gbud-stat-ic"><TrendingDown size={15} /></div>
          <div className="gbud-stat-txt">
            <span className="gbud-stat-label">Ausgaben</span>
            <span className="gbud-stat-val">−{fmtAmount(totals.expense)} €</span>
          </div>
        </div>
        <div className={`gbud-stat gbud-stat-balance ${totals.balance >= 0 ? 'pos' : 'neg'}`}>
          <div className="gbud-stat-ic"><Wallet size={15} /></div>
          <div className="gbud-stat-txt">
            <span className="gbud-stat-label">Saldo</span>
            <span className="gbud-stat-val">{totals.balance >= 0 ? '+' : '−'}{fmtAmount(Math.abs(totals.balance))} €</span>
          </div>
        </div>
      </div>

      {/* Hinzufuegen */}
      {!showAdd ? (
        <button className="gbud-add-btn" onClick={() => { setForm(emptyForm); setShowAdd(true); }}>
          <Plus size={17} /> Eintrag hinzufügen
        </button>
      ) : (
        <motion.div className="gbud-form" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
          <div className="gbud-form-head">
            <div className="gbud-kind-toggle">
              <button className={`gbud-kind ${form.kind === 'expense' ? 'active expense' : ''}`} onClick={() => switchKind('expense')}>
                <ArrowDownCircle size={15} /> Ausgabe
              </button>
              <button className={`gbud-kind ${form.kind === 'income' ? 'active income' : ''}`} onClick={() => switchKind('income')}>
                <ArrowUpCircle size={15} /> Einnahme
              </button>
            </div>
            <button className="gbud-form-close" onClick={() => setShowAdd(false)}><X size={16} /></button>
          </div>

          <div className="gbud-form-row">
            <div className="gbud-amount-wrap">
              <input
                type="text" inputMode="decimal" autoFocus
                className="gbud-amount" placeholder="0,00"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^0-9.,]/g, '') }))}
              />
              <span className="gbud-amount-cur">€</span>
            </div>
            <input
              type="date" className="gbud-date"
              value={form.entry_date}
              onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
            />
          </div>

          <div className="gbud-cats">
            {categoryOptions.map((c) => (
              <button
                key={c.id}
                className={`gbud-cat ${form.category === c.id ? 'active' : ''}`}
                style={form.category === c.id ? { borderColor: c.color, color: c.color, background: `${c.color}1A` } : undefined}
                onClick={() => setForm((f) => ({ ...f, category: c.id }))}
              >
                <span className="gbud-cat-dot" style={{ background: c.color }} />
                {c.label}
              </button>
            ))}
          </div>

          <input
            type="text" className="gbud-desc" placeholder="Beschreibung (optional)"
            value={form.description} maxLength={120}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />

          <div className="gbud-form-foot">
            <div className="gbud-recur">
              <Repeat size={14} />
              <select value={form.recurrence} onChange={(e) => setForm((f) => ({ ...f, recurrence: e.target.value }))}>
                {Object.entries(RECURRENCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <button className="gbud-save" onClick={submit} disabled={saving}>
              {saving ? <Loader2 size={15} className="gbud-spin" /> : <Plus size={15} />}
              {form.kind === 'income' ? 'Einnahme' : 'Ausgabe'} speichern
            </button>
          </div>
        </motion.div>
      )}

      {/* Liste */}
      <div className="gbud-list">
        {monthEntries.length === 0 ? (
          <div className="gbud-empty">Keine Einträge in {monthLabel(month.year, month.month)}.</div>
        ) : (
          <AnimatePresence initial={false}>
            {monthEntries.map((e) => {
              const color = getCategoryColorWithCustom(e.category, customCats);
              const amt = amountForMonth(e, month.year, month.month, overrides);
              const canDelete = isAdmin || Number(e.user_id) === Number(userId);
              return (
                <motion.div key={e.id} className="gbud-row" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} layout>
                  <span className="gbud-row-dot" style={{ background: color }} />
                  <div className="gbud-row-main">
                    <span className="gbud-row-cat">
                      {getCategoryLabelWithCustom(e.category, customCats)}
                      {e.recurrence && e.recurrence !== 'none' && <Repeat size={11} className="gbud-row-recur" />}
                    </span>
                    {e.description && <span className="gbud-row-desc">{e.description}</span>}
                    <span className="gbud-row-meta">
                      {e.user_name || 'Mitglied'} · {new Date(e.entry_date || e.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}
                    </span>
                  </div>
                  <span className={`gbud-row-amt ${e.kind === 'income' ? 'income' : 'expense'}`}>
                    {e.kind === 'income' ? '+' : '−'}{fmtAmount(amt)} €
                  </span>
                  {canDelete && (
                    <button className="gbud-row-del" onClick={() => removeEntry(e)} disabled={deletingId === e.id} aria-label="Löschen">
                      {deletingId === e.id ? <Loader2 size={14} className="gbud-spin" /> : <Trash2 size={14} />}
                    </button>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
