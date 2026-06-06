// api/_lib/plans.js
// ── Server-side plan enforcement ─────────────────────────────────────
// Authoritative mirror of frontend/src/lib/plans.js. The frontend gating
// is only UX — these checks are the ones that actually protect paid
// features against direct API calls. KEEP IN SYNC with the frontend file.

const PLANS = {
  free: {
    id: 'free',
    limits: { tasks: 30, categories: 2, groups: 1, groupMembers: 3, aiCalls: 5, notes: 10, budgetEntries: 20 },
    features: {
      ai: true, groups: true, teamChat: false, groupAdmin: false,
      recurringTasks: false, calendarSync: false, attachments: false,
      statistics: false, prioritySupport: false,
    },
  },
  pro: {
    id: 'pro',
    limits: { tasks: Infinity, categories: Infinity, groups: 2, groupMembers: 5, aiCalls: 200, notes: Infinity, budgetEntries: Infinity },
    features: {
      ai: true, groups: true, teamChat: false, groupAdmin: false,
      recurringTasks: true, calendarSync: true, attachments: true,
      statistics: true, prioritySupport: false,
    },
  },
  team: {
    id: 'team',
    limits: { tasks: Infinity, categories: Infinity, groups: Infinity, groupMembers: Infinity, aiCalls: 1000, notes: Infinity, budgetEntries: Infinity },
    features: {
      ai: true, groups: true, teamChat: true, groupAdmin: true,
      recurringTasks: true, calendarSync: true, attachments: true,
      statistics: true, prioritySupport: true,
    },
  },
};

function getPlan(planId) {
  return PLANS[planId] || PLANS.free;
}

function canUseFeature(planId, featureKey) {
  return getPlan(planId).features[featureKey] === true;
}

function getLimit(planId, limitKey) {
  const limit = getPlan(planId).limits[limitKey];
  return limit === undefined ? 0 : limit;
}

// Liest den effektiven Plan eines Users aus der DB. Abgelaufene bezahlte
// Plaene (plan_expires_at in der Vergangenheit) zaehlen wieder als 'free'.
async function getUserPlan(pool, userId) {
  try {
    const { rows } = await pool.query(
      'SELECT plan, plan_expires_at FROM users WHERE id = $1',
      [userId]
    );
    if (!rows.length) return 'free';
    const planId = rows[0].plan || 'free';
    if (planId !== 'free' && rows[0].plan_expires_at) {
      const exp = new Date(rows[0].plan_expires_at);
      if (!isNaN(exp.getTime()) && exp.getTime() < Date.now()) return 'free';
    }
    return PLANS[planId] ? planId : 'free';
  } catch {
    // Im Zweifel restriktiv: free.
    return 'free';
  }
}

// Standard-402-Antwort fuer gesperrte Features/Limits.
function paymentRequired(res, { feature, recommendPlan = 'pro', message }) {
  return res.status(402).json({
    error: message || 'Dieses Feature ist in deinem Plan nicht enthalten.',
    upgrade_required: true,
    feature: feature || null,
    recommend_plan: recommendPlan,
  });
}

// ── KI-Nutzungszaehler (monatlich) ───────────────────────────────────
let aiColsEnsured = false;
async function ensureAiUsageColumns(pool) {
  if (aiColsEnsured) return;
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_calls_used INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_calls_period VARCHAR(7)`);
  aiColsEnsured = true;
}

function currentPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Versucht atomar einen KI-Call zu "verbrauchen".
// Reset bei Monatswechsel ist in das UPDATE eingebaut.
// Rueckgabe: { ok, used, limit, period }
async function consumeAiCall(pool, userId, planId) {
  await ensureAiUsageColumns(pool);
  const limit = getLimit(planId, 'aiCalls');
  const period = currentPeriod();
  // Increment + Reset in einem atomaren Statement. Die WHERE-Klausel
  // laesst das Update nur durch, solange im aktuellen Monat noch Budget
  // frei ist (oder der Monat gewechselt hat -> Reset auf 1).
  const { rows } = await pool.query(
    `UPDATE users
        SET ai_calls_used = CASE WHEN ai_calls_period = $2 THEN ai_calls_used + 1 ELSE 1 END,
            ai_calls_period = $2
      WHERE id = $1
        AND (ai_calls_period IS DISTINCT FROM $2 OR ai_calls_used < $3)
      RETURNING ai_calls_used`,
    [userId, period, limit]
  );
  if (!rows.length) {
    return { ok: false, used: limit, limit, period };
  }
  return { ok: true, used: rows[0].ai_calls_used, limit, period };
}

// Liest die aktuelle KI-Nutzung ohne zu verbrauchen.
async function getAiUsage(pool, userId, planId) {
  await ensureAiUsageColumns(pool);
  const limit = getLimit(planId, 'aiCalls');
  const period = currentPeriod();
  const { rows } = await pool.query(
    'SELECT ai_calls_used, ai_calls_period FROM users WHERE id = $1',
    [userId]
  );
  const row = rows[0] || {};
  const used = row.ai_calls_period === period ? (row.ai_calls_used || 0) : 0;
  return { used, limit, period, remaining: Math.max(0, limit - used) };
}

module.exports = {
  PLANS,
  getPlan,
  canUseFeature,
  getLimit,
  getUserPlan,
  paymentRequired,
  ensureAiUsageColumns,
  consumeAiCall,
  getAiUsage,
};
