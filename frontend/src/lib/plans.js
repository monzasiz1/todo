// ── Plan definitions ─────────────────────────────────────────────
// Single source of truth for all plan limits and features.
// Keep in sync with server-side checks in api/plans.js.

export const PLANS = {
  free: {
    id: 'free',
    label: 'Free',
    price: 0,
    priceLabel: 'Kostenlos',
    limits: {
      tasks: 50,
      categories: 3,
      groups: 0,
      aiCalls: 0,      // per month
    },
    features: {
      ai: false,
      groups: false,
      recurringTasks: false,
      calendarSync: false,
      attachments: false,
      statistics: false,
    },
  },

  pro: {
    id: 'pro',
    label: 'Pro',
    price: 4.99,
    priceLabel: '4,99 €/Monat',
    limits: {
      tasks: Infinity,
      categories: Infinity,
      groups: 3,
      aiCalls: 200,
    },
    features: {
      ai: true,
      groups: true,
      recurringTasks: true,
      calendarSync: true,
      attachments: true,
      statistics: true,
    },
  },

  team: {
    id: 'team',
    label: 'Team',
    price: 9.99,
    priceLabel: '9,99 €/Monat/Nutzer',
    limits: {
      tasks: Infinity,
      categories: Infinity,
      groups: Infinity,
      aiCalls: 1000,
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
