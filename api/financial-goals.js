/**
 * API für Financial Goals
 * Sparziele mit Fortschritt, Prognose, automatische Sparrate
 */

const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

async function ensureTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS financial_goals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    target_amount NUMERIC(12,2) NOT NULL,
    current_amount NUMERIC(12,2) DEFAULT 0,
    category VARCHAR(50) DEFAULT 'other',
    emoji VARCHAR(10),
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    target_date DATE,
    auto_save_monthly NUMERIC(10,2),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_goals_user ON financial_goals(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_goals_status ON financial_goals(user_id, status)`);
}

function calculateProgress(goal) {
  const progress = (Number(goal.current_amount) || 0) / (Number(goal.target_amount) || 1);
  const daysRemaining = goal.target_date ? Math.ceil((new Date(goal.target_date) - new Date()) / (1000 * 60 * 60 * 24)) : null;
  const monthsRemaining = daysRemaining ? Math.ceil(daysRemaining / 30) : null;
  const monthlyNeeded = goal.target_amount && monthsRemaining ? (Number(goal.target_amount) - Number(goal.current_amount)) / monthsRemaining : 0;

  return {
    percentComplete: Math.min(100, Math.round(progress * 100)),
    progressAmount: Number(goal.current_amount) || 0,
    remainingAmount: Math.max(0, Number(goal.target_amount) - Number(goal.current_amount)),
    daysRemaining,
    monthsRemaining,
    monthlyNeeded: Math.max(0, monthlyNeeded),
    isOnTrack: goal.auto_save_monthly ? Number(goal.auto_save_monthly) >= monthlyNeeded : false,
  };
}

module.exports = async (req, res) => {
  await cors(req, res);
  const user = await verifyToken(req, res);
  if (!user) return;

  const pool = getPool();
  await ensureTables(pool);

  const segments = (req.url || '/').replace(/^\/api\/goals\/?/, '').split('/').filter(Boolean);

  try {
    // GET /api/goals — Alle Ziele mit Fortschritt
    if (req.method === 'GET' && segments.length === 0) {
      const result = await pool.query(
        `SELECT * FROM financial_goals
         WHERE user_id = $1
         ORDER BY priority DESC, target_date ASC`,
        [user.id]
      );

      const goals = result.rows.map((g) => ({
        ...g,
        progress: calculateProgress(g),
      }));

      const summary = {
        totalGoals: goals.length,
        activeGoals: goals.filter((g) => g.status === 'active').length,
        completedGoals: goals.filter((g) => g.status === 'completed').length,
        totalTargetAmount: goals.reduce((s, g) => s + Number(g.target_amount), 0),
        totalSavedAmount: goals.reduce((s, g) => s + Number(g.current_amount), 0),
      };

      return res.json({ goals, summary });
    }

    // POST /api/goals — Neues Ziel
    if (req.method === 'POST' && segments.length === 0) {
      const { title, description, target_amount, category, emoji, priority, target_date, auto_save_monthly } = req.body || {};
      if (!title?.trim() || !target_amount || target_amount <= 0) {
        return res.status(400).json({ error: 'Ungültige Zieldaten' });
      }

      const result = await pool.query(
        `INSERT INTO financial_goals
         (user_id, title, description, target_amount, category, emoji, priority, target_date, auto_save_monthly, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
         RETURNING *`,
        [user.id, title.trim().slice(0, 200), description?.slice(0, 1000) || null, Number(target_amount), category || 'other', emoji?.slice(0, 10) || '🎯', priority || 'medium', target_date || null, auto_save_monthly ? Number(auto_save_monthly) : null]
      );

      const goal = result.rows[0];
      return res.status(201).json({
        goal: {
          ...goal,
          progress: calculateProgress(goal),
        },
      });
    }

    // PUT /api/goals/:id — Ziel aktualisieren
    if (req.method === 'PUT' && segments.length === 1) {
      const goalId = Number(segments[0]);
      const { title, description, target_amount, current_amount, category, emoji, priority, target_date, auto_save_monthly, status } = req.body || {};

      const checkRes = await pool.query(
        'SELECT * FROM financial_goals WHERE id = $1 AND user_id = $2',
        [goalId, user.id]
      );
      if (checkRes.rows.length === 0) {
        return res.status(404).json({ error: 'Ziel nicht gefunden' });
      }

      const result = await pool.query(
        `UPDATE financial_goals
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             target_amount = COALESCE($3, target_amount),
             current_amount = COALESCE($4, current_amount),
             category = COALESCE($5, category),
             emoji = COALESCE($6, emoji),
             priority = COALESCE($7, priority),
             target_date = COALESCE($8, target_date),
             auto_save_monthly = COALESCE($9, auto_save_monthly),
             status = COALESCE($10, status),
             updated_at = NOW()
         WHERE id = $11 AND user_id = $12
         RETURNING *`,
        [title?.trim(), description?.slice(0, 1000), target_amount !== undefined ? Number(target_amount) : null, current_amount !== undefined ? Number(current_amount) : null, category, emoji?.slice(0, 10), priority, target_date, auto_save_monthly !== undefined ? Number(auto_save_monthly) : null, status, goalId, user.id]
      );

      const goal = result.rows[0];
      return res.json({
        goal: {
          ...goal,
          progress: calculateProgress(goal),
        },
      });
    }

    // POST /api/goals/:id/contribute — Beitrag zum Ziel
    if (req.method === 'POST' && segments.length === 2 && segments[1] === 'contribute') {
      const goalId = Number(segments[0]);
      const { amount } = req.body || {};
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Ungültiger Betrag' });
      }

      const checkRes = await pool.query(
        'SELECT current_amount FROM financial_goals WHERE id = $1 AND user_id = $2',
        [goalId, user.id]
      );
      if (checkRes.rows.length === 0) {
        return res.status(404).json({ error: 'Ziel nicht gefunden' });
      }

      const newAmount = Number(checkRes.rows[0].current_amount) + Number(amount);
      const result = await pool.query(
        `UPDATE financial_goals
         SET current_amount = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3
         RETURNING *`,
        [newAmount, goalId, user.id]
      );

      const goal = result.rows[0];
      return res.json({
        goal: {
          ...goal,
          progress: calculateProgress(goal),
        },
      });
    }

    // DELETE /api/goals/:id
    if (req.method === 'DELETE' && segments.length === 1) {
      const goalId = Number(segments[0]);
      await pool.query(
        'DELETE FROM financial_goals WHERE id = $1 AND user_id = $2',
        [goalId, user.id]
      );
      return res.json({ success: true });
    }

    return res.status(404).json({ error: 'Endpoint nicht gefunden' });
  } catch (err) {
    console.error('Goals API Error:', err);
    return res.status(500).json({ error: 'Interner Fehler' });
  }
};
