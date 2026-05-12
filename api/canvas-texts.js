const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

async function ensureTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS note_canvas_texts (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      text         TEXT NOT NULL DEFAULT '',
      x            FLOAT NOT NULL DEFAULT 100,
      y            FLOAT NOT NULL DEFAULT 100,
      font_family  TEXT NOT NULL DEFAULT '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif',
      font_size    FLOAT NOT NULL DEFAULT 32,
      font_weight  INTEGER NOT NULL DEFAULT 600,
      font_color   TEXT NOT NULL DEFAULT '',
      attached_note_id TEXT DEFAULT NULL,
      offset_x     FLOAT NOT NULL DEFAULT 0,
      offset_y     FLOAT NOT NULL DEFAULT 0,
      created_at   BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_note_canvas_texts_user_id ON note_canvas_texts(user_id);
  `);
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let userId;
  try {
    const decoded = verifyToken(req);
    userId = String(decoded.userId || decoded.id || decoded.sub || '');
    if (!userId) throw new Error('no userId');
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const pool = getPool();

  try {
    await ensureTable(pool);
  } catch {
    // ignore DDL errors if table already exists
  }

  // GET — list all canvas texts for user
  if (req.method === 'GET') {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM note_canvas_texts WHERE user_id = $1 ORDER BY created_at ASC`,
        [userId]
      );
      return res.json({ canvasTexts: rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const action = body.action || 'upsert';

    // DELETE
    if (action === 'delete') {
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      try {
        await pool.query(
          `DELETE FROM note_canvas_texts WHERE id = $1 AND user_id = $2`,
          [String(id), userId]
        );
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // UPSERT (create or update)
    if (action === 'upsert') {
      const { id, text, x, y, font_family, font_size, font_weight, font_color, attached_note_id, offset_x, offset_y, created_at } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      try {
        await pool.query(
          `INSERT INTO note_canvas_texts (id, user_id, text, x, y, font_family, font_size, font_weight, font_color, attached_note_id, offset_x, offset_y, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (id) DO UPDATE SET
             text = EXCLUDED.text,
             x = EXCLUDED.x,
             y = EXCLUDED.y,
             font_family = EXCLUDED.font_family,
             font_size = EXCLUDED.font_size,
             font_weight = EXCLUDED.font_weight,
             font_color = EXCLUDED.font_color,
             attached_note_id = EXCLUDED.attached_note_id,
             offset_x = EXCLUDED.offset_x,
             offset_y = EXCLUDED.offset_y`,
          [
            String(id),
            userId,
            String(text || ''),
            Number(x) || 100,
            Number(y) || 100,
            String(font_family || '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif'),
            Number(font_size) || 32,
            Number(font_weight) || 600,
            String(font_color || ''),
            attached_note_id ? String(attached_note_id) : null,
            Number(offset_x) || 0,
            Number(offset_y) || 0,
            Number(created_at) || Date.now(),
          ]
        );
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    return res.status(400).json({ error: 'unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
