/**
 * api/plans.js
 *
 * GET  /api/plans        – public: list all plans
 * GET  /api/plans/me     – auth: current user's plan
 * POST /api/plans/upgrade – auth: simulate plan upgrade (dev/test)
 *   body: { plan: 'pro' | 'team' | 'free' }
 *
 * In production replace the upgrade handler with a real
 * payment provider webhook (Stripe, LemonSqueezy, etc.).
 */

const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

const VALID_PLANS = ['free', 'pro', 'team'];

const PLAN_DEFS = {
  free:  { id: 'free',  label: 'Free',  price: 0,    priceLabel: 'Kostenlos' },
  pro:   { id: 'pro',   label: 'Pro',   price: 4.99, priceLabel: '4,99 €/Monat' },
  team:  { id: 'team',  label: 'Team',  price: 9.99, priceLabel: '9,99 €/Monat/Nutzer' },
};

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const subPath = req.query.__path || '';
  const segments = subPath.split('/').filter(Boolean);
  const action = segments[0] || '';

  // ── GET /api/plans  (public list) ─────────────────────────────
  if (req.method === 'GET' && !action) {
    return res.json({ plans: Object.values(PLAN_DEFS) });
  }

  // ── GET /api/plans/me ─────────────────────────────────────────
  if (req.method === 'GET' && action === 'me') {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

    const pool = getPool();
    const result = await pool.query(
      'SELECT plan, plan_expires_at FROM users WHERE id = $1',
      [user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Nutzer nicht gefunden' });

    const row = result.rows[0];
    return res.json({ plan: row.plan ?? 'free', expires_at: row.plan_expires_at ?? null });
  }

  // ── POST /api/plans/upgrade  (dev/test – swap for Stripe webhook in prod) ──
  if (req.method === 'POST' && action === 'upgrade') {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

    const { plan } = req.body ?? {};
    if (!plan || !VALID_PLANS.includes(plan)) {
      return res.status(400).json({ error: 'Ungültiger Plan' });
    }

    const pool = getPool();

    // Calculate expiry: free = null, paid = +1 month
    const expiresAt = plan === 'free'
      ? null
      : new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE users
         SET plan = $1, plan_expires_at = $2, plan_updated_at = NOW()
       WHERE id = $3`,
      [plan, expiresAt, user.id]
    );

    return res.json({ ok: true, plan, expires_at: expiresAt });
  }

  return res.status(404).json({ error: 'Nicht gefunden' });
};
