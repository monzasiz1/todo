/**
 * API für Net Worth System
 * Konten, Assets, Liabilities, Vermögensübersicht
 */

const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

async function ensureTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS user_accounts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('checking', 'savings', 'investment', 'crypto', 'cash')),
    balance NUMERIC(12,2) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'EUR',
    color VARCHAR(7) DEFAULT '#007AFF',
    icon VARCHAR(50) DEFAULT 'wallet',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS user_liabilities (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('credit_card', 'loan', 'mortgage', 'other')),
    amount_owed NUMERIC(12,2) DEFAULT 0,
    interest_rate NUMERIC(5,2) DEFAULT 0,
    monthly_payment NUMERIC(10,2) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'EUR',
    due_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_accounts_user ON user_accounts(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_liabilities_user ON user_liabilities(user_id)`);
}

module.exports = async (req, res) => {
  await cors(req, res);
  const user = await verifyToken(req, res);
  if (!user) return;

  const pool = getPool();
  await ensureTables(pool);

  const segments = (req.url || '/').replace(/^\/api\/net-worth\/?/, '').split('/').filter(Boolean);

  try {
    // GET /api/net-worth — Gesamtvermögen + Übersicht
    if (req.method === 'GET' && segments.length === 0) {
      const accountsRes = await pool.query(
        `SELECT id, name, type, balance, currency, color, icon, is_active, created_at
         FROM user_accounts
         WHERE user_id = $1 AND is_active = TRUE
         ORDER BY created_at ASC`,
        [user.id]
      );

      const liabilitiesRes = await pool.query(
        `SELECT id, name, type, amount_owed, interest_rate, monthly_payment, currency, due_date
         FROM user_liabilities
         WHERE user_id = $1
         ORDER BY due_date ASC`,
        [user.id]
      );

      const accounts = accountsRes.rows;
      const liabilities = liabilitiesRes.rows;

      const totalAssets = accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
      const totalLiabilities = liabilities.reduce((s, l) => s + (Number(l.amount_owed) || 0), 0);
      const netWorth = totalAssets - totalLiabilities;

      return res.json({
        accounts,
        liabilities,
        summary: {
          totalAssets,
          totalLiabilities,
          netWorth,
          accountCount: accounts.length,
          liabilityCount: liabilities.length,
        },
      });
    }

    // POST /api/net-worth/accounts — Neues Konto
    if (req.method === 'POST' && segments.length === 1 && segments[0] === 'accounts') {
      const { name, type, balance, color, icon } = req.body || {};
      if (!name?.trim() || !['checking', 'savings', 'investment', 'crypto', 'cash'].includes(type)) {
        return res.status(400).json({ error: 'Ungültige Kontodaten' });
      }

      const result = await pool.query(
        `INSERT INTO user_accounts (user_id, name, type, balance, color, icon)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [user.id, name.trim().slice(0, 120), type, Number(balance) || 0, color || '#007AFF', icon || 'wallet']
      );

      return res.status(201).json({ account: result.rows[0] });
    }

    // PUT /api/net-worth/accounts/:id — Konto aktualisieren
    if (req.method === 'PUT' && segments.length === 2 && segments[0] === 'accounts') {
      const accountId = Number(segments[1]);
      const { name, balance, color, icon, is_active } = req.body || {};

      const checkRes = await pool.query(
        'SELECT 1 FROM user_accounts WHERE id = $1 AND user_id = $2',
        [accountId, user.id]
      );
      if (checkRes.rows.length === 0) {
        return res.status(404).json({ error: 'Konto nicht gefunden' });
      }

      const result = await pool.query(
        `UPDATE user_accounts
         SET name = COALESCE($1, name),
             balance = COALESCE($2, balance),
             color = COALESCE($3, color),
             icon = COALESCE($4, icon),
             is_active = COALESCE($5, is_active),
             updated_at = NOW()
         WHERE id = $6 AND user_id = $7
         RETURNING *`,
        [name?.trim(), balance !== undefined ? Number(balance) : null, color, icon, is_active, accountId, user.id]
      );

      return res.json({ account: result.rows[0] });
    }

    // DELETE /api/net-worth/accounts/:id
    if (req.method === 'DELETE' && segments.length === 2 && segments[0] === 'accounts') {
      const accountId = Number(segments[1]);
      await pool.query(
        'DELETE FROM user_accounts WHERE id = $1 AND user_id = $2',
        [accountId, user.id]
      );
      return res.json({ success: true });
    }

    // POST /api/net-worth/liabilities — Neue Schuld
    if (req.method === 'POST' && segments.length === 1 && segments[0] === 'liabilities') {
      const { name, type, amount_owed, interest_rate, monthly_payment, due_date } = req.body || {};
      if (!name?.trim() || !['credit_card', 'loan', 'mortgage', 'other'].includes(type)) {
        return res.status(400).json({ error: 'Ungültige Schuldendaten' });
      }

      const result = await pool.query(
        `INSERT INTO user_liabilities (user_id, name, type, amount_owed, interest_rate, monthly_payment, due_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [user.id, name.trim().slice(0, 120), type, Number(amount_owed) || 0, Number(interest_rate) || 0, Number(monthly_payment) || 0, due_date || null]
      );

      return res.status(201).json({ liability: result.rows[0] });
    }

    // PUT /api/net-worth/liabilities/:id
    if (req.method === 'PUT' && segments.length === 2 && segments[0] === 'liabilities') {
      const liabilityId = Number(segments[1]);
      const { name, amount_owed, interest_rate, monthly_payment, due_date } = req.body || {};

      const checkRes = await pool.query(
        'SELECT 1 FROM user_liabilities WHERE id = $1 AND user_id = $2',
        [liabilityId, user.id]
      );
      if (checkRes.rows.length === 0) {
        return res.status(404).json({ error: 'Schuld nicht gefunden' });
      }

      const result = await pool.query(
        `UPDATE user_liabilities
         SET name = COALESCE($1, name),
             amount_owed = COALESCE($2, amount_owed),
             interest_rate = COALESCE($3, interest_rate),
             monthly_payment = COALESCE($4, monthly_payment),
             due_date = COALESCE($5, due_date),
             updated_at = NOW()
         WHERE id = $6 AND user_id = $7
         RETURNING *`,
        [name?.trim(), amount_owed !== undefined ? Number(amount_owed) : null, interest_rate !== undefined ? Number(interest_rate) : null, monthly_payment !== undefined ? Number(monthly_payment) : null, due_date, liabilityId, user.id]
      );

      return res.json({ liability: result.rows[0] });
    }

    // DELETE /api/net-worth/liabilities/:id
    if (req.method === 'DELETE' && segments.length === 2 && segments[0] === 'liabilities') {
      const liabilityId = Number(segments[1]);
      await pool.query(
        'DELETE FROM user_liabilities WHERE id = $1 AND user_id = $2',
        [liabilityId, user.id]
      );
      return res.json({ success: true });
    }

    return res.status(404).json({ error: 'Endpoint nicht gefunden' });
  } catch (err) {
    console.error('Net Worth API Error:', err);
    return res.status(500).json({ error: 'Interner Fehler' });
  }
};
