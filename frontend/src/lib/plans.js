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
      groups: 1,          // 1 Gruppe zum Reinschnuppern (z.B. WG/Familie testen)
      groupMembers: 3,    // max 3 Mitglieder pro Gruppe
      aiCalls: 5,         // Geschmacksprobe der KI -> stiftet Wunsch
      notes: 10,
    },
    features: {
      ai: true,           // KI ist aktiv, aber stark limitiert (siehe aiCalls)
      groups: true,       // 1 Gruppe nutzbar, aber stark begrenzt
      teamChat: false,
      groupAdmin: false,
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
    price: 2.99,
    priceLabel: '2,99 €/Monat',
    priceLabelYear: '35,88 €/Jahr',
    yearlyMonthly: 2.99,         // 35,88/12
    yearlySaveLabel: '~17% sparen',
    tagline: 'Fuer Vielnutzer',
    limits: {
      tasks: Infinity,
      categories: Infinity,
      groups: 2,           // Pro = Einzelnutzer-Power, Gruppen klar gedrosselt
      groupMembers: 5,
      aiCalls: 200,
      notes: Infinity,
    },
    features: {
      ai: true,
      groups: true,
      teamChat: false,     // Team-Chat ist Team-exklusiv
      groupAdmin: false,   // Rollen/Rechte ist Team-exklusiv
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
      groupMembers: Infinity,
      aiCalls: 1000,
      notes: Infinity,
    },
    features: {
      ai: true,
      groups: true,
      teamChat: true,        // Team-exklusiv
      groupAdmin: true,      // Rollen, Rechte, Admin-Tools
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
