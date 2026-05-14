// ── Plan definitions ─────────────────────────────────────────────
// Single source of truth for all plan limits and features.
// Keep in sync with server-side checks in api/plans.js.
//
// Strategie:
//   Free ist absichtlich knapp gehalten, damit aktive Nutzer schnell an
//   konkrete Limits stossen (Aufgaben, Kategorien, KI-Geschmacksprobe).
//   Es bleibt aber jederzeit nutzbar — wir blocken keine bezahlte Funktion,
//   wir machen sie nur erlebbar limitiert sichtbar.

export const PLANS = {
  free: {
    id: 'free',
    label: 'Free',
    price: 0,
    priceLabel: 'Kostenlos',
    priceLabelYear: 'Kostenlos',
    tagline: 'Zum Ausprobieren',
    limits: {
      tasks: 30,          // reicht zum Reinschnuppern, geht aktiv zuegig voll
      categories: 2,      // 2 Kategorien zwingen zur Organisation -> spuerbar
      groups: 0,
      aiCalls: 5,         // Geschmacksprobe der KI -> stiftet Wunsch
      notes: 10,
    },
    features: {
      ai: true,           // KI ist aktiv, aber stark limitiert (siehe aiCalls)
      groups: false,
      recurringTasks: false,
      calendarSync: false,
      attachments: false,
      statistics: false,
      prioritySupport: false,
    },
  },

  pro: {
    id: 'pro',
    label: 'Pro',
    price: 4.99,
    priceLabel: '4,99 €/Monat',
    priceLabelYear: '49,99 €/Jahr',
    yearlyMonthly: 4.17,         // 49,99/12
    yearlySaveLabel: '~17% sparen',
    tagline: 'Fuer Vielnutzer',
    limits: {
      tasks: Infinity,
      categories: Infinity,
      groups: 3,
      aiCalls: 200,
      notes: Infinity,
    },
    features: {
      ai: true,
      groups: true,
      recurringTasks: true,
      calendarSync: true,
      attachments: true,
      statistics: true,
      prioritySupport: false,
    },
  },

  team: {
    id: 'team',
    label: 'Team',
    price: 9.99,
    priceLabel: '9,99 €/Monat/Nutzer',
    priceLabelYear: '99,99 €/Jahr/Nutzer',
    yearlyMonthly: 8.33,
    yearlySaveLabel: '~17% sparen',
    tagline: 'Fuer Teams & Familien',
    limits: {
      tasks: Infinity,
      categories: Infinity,
      groups: Infinity,
      aiCalls: 1000,
      notes: Infinity,
    },
    features: {
      ai: true,
      groups: true,
      recurringTasks: true,
      calendarSync: true,
      attachments: true,
      statistics: true,
      prioritySupport: true,
    },
  },
};

export function getPlan(planId) {
  return PLANS[planId] ?? PLANS.free;
}

export function canUseFeature(planId, featureKey) {
  return getPlan(planId).features[featureKey] === true;
}

export function getLimit(planId, limitKey) {
  const limit = getPlan(planId).limits[limitKey];
  return limit === undefined ? 0 : limit;
}
