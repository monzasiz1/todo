// Geteilte, reine Budget-Helfer (Kategorien, Monats-/Recurrence-Mathematik).
// Wird von SharedSpendingPage (standalone) und GroupBudgetPanel (Gruppen)
// genutzt. KEINE React-Abhaengigkeiten — nur reine Funktionen.

export const EXPENSE_CATEGORIES = [
  { id: 'food',   label: 'Essen & Trinken',       color: '#60A5FA' },
  { id: 'home',   label: 'Miete & Haushalt',      color: '#32D583' },
  { id: 'travel', label: 'Reisen & Ausflüge',     color: '#FF9F0A' },
  { id: 'free',   label: 'Freizeit & Erlebnisse', color: '#D14BE2' },
];

export const INCOME_CATEGORIES = [
  { id: 'salary', label: 'Gehalt',         color: '#34D399' },
  { id: 'gift',   label: 'Geschenk',       color: '#F472B6' },
  { id: 'side',   label: 'Nebeneinkommen', color: '#A78BFA' },
  { id: 'other',  label: 'Sonstiges',      color: '#94A3B8' },
];

export const ALL_CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];

export const RECURRENCE_LABELS = {
  none: 'Einmalig',
  monthly: 'Monatlich',
  quarterly: 'Vierteljährlich',
  yearly: 'Jährlich',
};

const MONTH_NAMES_DE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export function categoryLabel(id) {
  return ALL_CATEGORIES.find((c) => c.id === id)?.label || id;
}
export function categoryColor(id) {
  return ALL_CATEGORIES.find((c) => c.id === id)?.color || '#8E8E93';
}
export function getCategoryLabelWithCustom(id, customCategories = []) {
  if (String(id).startsWith('custom:')) {
    const customId = parseInt(String(id).slice(7), 10);
    return customCategories.find((c) => c.id === customId)?.label || 'Gelöschte Kategorie';
  }
  return categoryLabel(id);
}
export function getCategoryColorWithCustom(id, customCategories = []) {
  if (String(id).startsWith('custom:')) {
    const customId = parseInt(String(id).slice(7), 10);
    return customCategories.find((c) => c.id === customId)?.color || '#8E8E93';
  }
  return categoryColor(id);
}

export function fmtAmount(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function monthLabel(year, month1) {
  return `${MONTH_NAMES_DE[month1 - 1]} ${year}`;
}
export function currentMonthKey() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
export function shiftMonth({ year, month }, delta) {
  let y = year;
  let m = month + delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return { year: y, month: m };
}
export function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function findOverride(overrides, entry, year, month) {
  if (!overrides || !entry || !entry.id) return null;
  const mk = monthKey(year, month);
  return overrides.find((o) => o.entry_id === entry.id && o.override_month === mk) || null;
}

/* true, wenn ein Eintrag im angegebenen Monat zaehlt (inkl. Recurrence + skip-Override). */
export function isEntryInMonth(entry, year, month, overrides = null) {
  if (entry.recurrence && entry.recurrence !== 'none') {
    const ov = findOverride(overrides, entry, year, month);
    if (ov && ov.kind === 'skip') return false;
  }
  const rawDate = entry.entry_date || entry.created_at;
  if (!rawDate) return false;
  const entryDate = new Date(rawDate);
  if (Number.isNaN(entryDate.getTime())) return false;

  const eY = entryDate.getUTCFullYear();
  const eM = entryDate.getUTCMonth() + 1;

  if (!entry.recurrence || entry.recurrence === 'none') {
    return eY === year && eM === month;
  }
  const startDelta = (year - eY) * 12 + (month - eM);
  if (startDelta < 0) return false;
  if (entry.recurrence_end) {
    const end = new Date(entry.recurrence_end);
    if (!Number.isNaN(end.getTime())) {
      const endDelta = (year - end.getUTCFullYear()) * 12 + (month - (end.getUTCMonth() + 1));
      if (endDelta > 0) return false;
    }
  }
  if (entry.recurrence === 'monthly') return true;
  if (entry.recurrence === 'quarterly') return startDelta % 3 === 0;
  if (entry.recurrence === 'yearly') return startDelta % 12 === 0;
  return false;
}

/* Effektiver Betrag fuer einen Monat — beachtet 'amount'-Overrides. */
export function amountForMonth(entry, year, month, overrides = null) {
  if (entry.recurrence && entry.recurrence !== 'none') {
    const ov = findOverride(overrides, entry, year, month);
    if (ov && ov.kind === 'amount' && typeof ov.amount === 'number') return ov.amount;
  }
  return Number(entry.amount) || 0;
}
