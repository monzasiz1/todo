/**
 * API für Cashflow Timeline & Financial Projections
 * Wann wird Geld kritisch? Future Projections, Time Machine
 */

const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

async function ensureTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS cashflow_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spending_group_id INTEGER REFERENCES spending_groups(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('income', 'expense', 'goal_milestone', 'bill_due', 'investment')),
    amount NUMERIC(10,2),
    scheduled_date DATE NOT NULL,
    is_recurring BOOLEAN DEFAULT FALSE,
    recurrence_pattern VARCHAR(20),
    estimated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS financial_projections (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    projection_month DATE NOT NULL,
    projected_income NUMERIC(12,2) DEFAULT 0,
    projected_expenses NUMERIC(12,2) DEFAULT 0,
    projected_balance NUMERIC(12,2) DEFAULT 0,
    confidence_level VARCHAR(20) DEFAULT 'medium',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, projection_month)
  )`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cashflow_user ON cashflow_events(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cashflow_date ON cashflow_events(scheduled_date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_projections_user_month ON financial_projections(user_id, projection_month)`);
}

function generateProjections(historicalData, monthsAhead = 3) {
  const projections = [];
  const today = new Date();

  for (let i = 1; i <= monthsAhead; i++) {
    const projMonth = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const monthKey = projMonth.toISOString().split('T')[0].slice(0, 7);

    // Durchschnitt aus historischen Daten
    const avgIncome = historicalData.reduce((s, m) => s + (m.income || 0), 0) / Math.max(1, historicalData.length);
    const avgExpenses = historicalData.reduce((s, m) => s + (m.expenses || 0), 0) / Math.max(1, historicalData.length);

    projections.push({
      month: monthKey,
      projectedIncome: Math.round(avgIncome * 100) / 100,
      projectedExpenses: Math.round(avgExpenses * 100) / 100,
      projectedBalance: Math.round((avgIncome - avgExpenses) * 100) / 100,
    });
  }

  return projections;
}

module.exports = async (req, res) => {
  await cors(req, res);
  const user = await verifyToken(req, res);
  if (!user) return;

  const pool = getPool();
  await ensureTables(pool);

  const segments = (req.url || '/').replace(/^\/api\/cashflow\/?/, '').split('/').filter(Boolean);

  try {
    // GET /api/cashflow/timeline — Timeline für nächste 3 Monate
    if (req.method === 'GET' && segments[0] === 'timeline') {
      const monthsAhead = Number(req.query?.months) || 3;
      const today = new Date();
      const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
      const endDate = new Date(today.getFullYear(), today.getMonth() + monthsAhead, 0);

      // Cashflow Events
      const eventsRes = await pool.query(
        `SELECT id, title, description, event_type, amount, scheduled_date, is_recurring, estimated
         FROM cashflow_events
         WHERE user_id = $1 AND scheduled_date BETWEEN $2 AND $3
         ORDER BY scheduled_date ASC`,
        [user.id, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
      );

      // Spending Expenses als Events
      const expensesRes = await pool.query(
        `SELECT e.id, e.description as title, 'expense' as event_type, e.amount, e.entry_date as scheduled_date
         FROM spending_expenses e
         WHERE e.user_id = $1 AND e.entry_date BETWEEN $2 AND $3 AND e.kind = 'expense'
         ORDER BY e.entry_date ASC`,
        [user.id, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
      );

      const allEvents = [
        ...eventsRes.rows,
        ...expensesRes.rows,
      ].sort((a, b) => new Date(a.scheduled_date) - new Date(b.scheduled_date));

      // Berechne tägliche Balance
      let runningBalance = 0;
      const timeline = allEvents.map((event) => {
        const isIncome = event.event_type === 'income';
        const isExpense = event.event_type === 'expense' || event.event_type === 'bill_due';

        if (isIncome) runningBalance += Number(event.amount) || 0;
        if (isExpense) runningBalance -= Number(event.amount) || 0;

        return {
          id: event.id,
          date: event.scheduled_date,
          title: event.title,
          type: event.event_type,
          amount: Number(event.amount) || 0,
          runningBalance,
          estimated: event.estimated,
          isCritical: runningBalance < 500,
        };
      });

      return res.json({
        timeline,
        summary: {
          lowestPoint: Math.min(...timeline.map((t) => t.runningBalance)),
          highestPoint: Math.max(...timeline.map((t) => t.runningBalance)),
          criticalPoints: timeline.filter((t) => t.isCritical).length,
        },
      });
    }

    // GET /api/cashflow/projections — 3-6 Monate Vorhersage
    if (req.method === 'GET' && segments[0] === 'projections') {
      const monthsAhead = Number(req.query?.months) || 3;

      // Historische Daten (letzte 3 Monate)
      const historicalRes = await pool.query(
        `SELECT 
           DATE_TRUNC('month', entry_date)::date as month,
           SUM(CASE WHEN kind = 'income' THEN amount ELSE 0 END) as income,
           SUM(CASE WHEN kind = 'expense' THEN amount ELSE 0 END) as expenses
         FROM spending_expenses
         WHERE user_id = $1 AND entry_date >= NOW() - INTERVAL '3 months'
         GROUP BY DATE_TRUNC('month', entry_date)`,
        [user.id]
      );

      const historical = historicalRes.rows.map((r) => ({
        income: Number(r.income) || 0,
        expenses: Number(r.expenses) || 0,
      }));

      const projections = generateProjections(historical, monthsAhead);

      // Speichere Projections für spätere Referenz
      for (const proj of projections) {
        await pool.query(
          `INSERT INTO financial_projections
           (user_id, projection_month, projected_income, projected_expenses, projected_balance)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, projection_month) DO UPDATE SET
             projected_income = $3,
             projected_expenses = $4,
             projected_balance = $5,
             updated_at = NOW()`,
          [user.id, proj.month, proj.projectedIncome, proj.projectedExpenses, proj.projectedBalance]
        );
      }

      return res.json({ projections });
    }

    // POST /api/cashflow/events — Neues Cashflow Event
    if (req.method === 'POST' && segments[0] === 'events') {
      const { title, description, event_type, amount, scheduled_date, is_recurring } = req.body || {};
      if (!title?.trim() || !event_type || !scheduled_date) {
        return res.status(400).json({ error: 'Ungültige Eventdaten' });
      }

      const result = await pool.query(
        `INSERT INTO cashflow_events
         (user_id, title, description, event_type, amount, scheduled_date, is_recurring, estimated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
         RETURNING *`,
        [user.id, title.trim().slice(0, 200), description?.slice(0, 500) || null, event_type, amount ? Number(amount) : null, scheduled_date, is_recurring || false]
      );

      return res.status(201).json({ event: result.rows[0] });
    }

    // PUT /api/cashflow/events/:id
    if (req.method === 'PUT' && segments[0] === 'events' && segments.length === 2) {
      const eventId = Number(segments[1]);
      const { title, description, amount, scheduled_date, is_recurring } = req.body || {};

      const checkRes = await pool.query(
        'SELECT 1 FROM cashflow_events WHERE id = $1 AND user_id = $2',
        [eventId, user.id]
      );
      if (checkRes.rows.length === 0) {
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      const result = await pool.query(
        `UPDATE cashflow_events
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             amount = COALESCE($3, amount),
             scheduled_date = COALESCE($4, scheduled_date),
             is_recurring = COALESCE($5, is_recurring),
             updated_at = NOW()
         WHERE id = $6 AND user_id = $7
         RETURNING *`,
        [title?.trim(), description?.slice(0, 500), amount !== undefined ? Number(amount) : null, scheduled_date, is_recurring, eventId, user.id]
      );

      return res.json({ event: result.rows[0] });
    }

    // DELETE /api/cashflow/events/:id
    if (req.method === 'DELETE' && segments[0] === 'events' && segments.length === 2) {
      const eventId = Number(segments[1]);
      await pool.query(
        'DELETE FROM cashflow_events WHERE id = $1 AND user_id = $2',
        [eventId, user.id]
      );
      return res.json({ success: true });
    }

    return res.status(404).json({ error: 'Endpoint nicht gefunden' });
  } catch (err) {
    console.error('Cashflow API Error:', err);
    return res.status(500).json({ error: 'Interner Fehler' });
  }
};
