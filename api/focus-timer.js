const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

let schemaReady = false;
async function ensureSchema(pool) {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS focus_timers (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      duration_sec INTEGER NOT NULL,
      label TEXT,
      fired BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_focus_timers_user ON focus_timers(user_id);
    CREATE INDEX IF NOT EXISTS idx_focus_timers_due  ON focus_timers(ends_at) WHERE fired = FALSE;
  `);
  schemaReady = true;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const pool = getPool();
  try {
    await ensureSchema(pool);
  } catch (err) {
    console.error('[focus-timer] ensureSchema failed:', err.message);
    return res.status(500).json({ error: 'Datenbank nicht verfuegbar' });
  }

  // GET /api/focus-timer -> aktiver (jüngster, nicht-gefeuerter) Timer
  if (req.method === 'GET') {
    try {
      const { rows } = await pool.query(
        `SELECT id, ends_at, duration_sec, label, fired, created_at
         FROM focus_timers
         WHERE user_id = $1 AND fired = FALSE
         ORDER BY ends_at DESC
         LIMIT 1`,
        [user.id]
      );
      return res.json({ timer: rows[0] || null });
    } catch (err) {
      console.error('[focus-timer] GET error:', err);
      return res.status(500).json({ error: 'Lesen fehlgeschlagen' });
    }
  }

  // POST /api/focus-timer { durationSec, label? } -> startet/ersetzt aktiven Timer
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const durationSec = Math.round(Number(body.durationSec));
      const label = typeof body.label === 'string' ? body.label.slice(0, 100) : null;
      if (!Number.isFinite(durationSec) || durationSec < 30 || durationSec > 4 * 60 * 60) {
        return res.status(400).json({ error: 'Ungueltige Dauer (30s - 4h)' });
      }

      // Alte unverbrauchte Timer des Nutzers verwerfen (nur einer aktiv)
      await pool.query(
        `DELETE FROM focus_timers WHERE user_id = $1 AND fired = FALSE`,
        [user.id]
      );

      const { rows } = await pool.query(
        `INSERT INTO focus_timers (user_id, ends_at, duration_sec, label)
         VALUES ($1, NOW() + ($2 || ' seconds')::interval, $2, $3)
         RETURNING id, ends_at, duration_sec, label, fired, created_at`,
        [user.id, durationSec, label]
      );
      return res.json({ timer: rows[0] });
    } catch (err) {
      console.error('[focus-timer] POST error:', err);
      return res.status(500).json({ error: 'Start fehlgeschlagen' });
    }
  }

  // DELETE /api/focus-timer -> aktiven Timer canceln
  if (req.method === 'DELETE') {
    try {
      await pool.query(
        `DELETE FROM focus_timers WHERE user_id = $1 AND fired = FALSE`,
        [user.id]
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('[focus-timer] DELETE error:', err);
      return res.status(500).json({ error: 'Cancel fehlgeschlagen' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
