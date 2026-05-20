// Whiteboard-Strokes Persistenz. Eine Tabelle pro User, in der jede
// gezeichnete Linie als JSON-Polyline gespeichert wird. Bewusst flach
// gehalten (kein Tile-System / kein realtime sync) - das deckt den
// Phase-2 Whiteboard-Use-Case ab (persoenliche Skizzen, schnelle
// Notizen, Brainstorming). Sharing/Collab kann spaeter folgen.

const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

const ENSURE_TTL_MS = 10 * 60 * 1000;
let ensuredAt = 0;

async function ensureTable(pool) {
  const now = Date.now();
  if (now - ensuredAt < ENSURE_TTL_MS) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whiteboard_strokes (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        color       VARCHAR(16) NOT NULL DEFAULT '#1f2937',
        size        REAL NOT NULL DEFAULT 3,
        points      JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_whiteboard_strokes_user_created ON whiteboard_strokes (user_id, created_at ASC)');
    ensuredAt = now;
  } catch (err) {
    console.warn('[whiteboard] ensure table failed:', err?.message || err);
  }
}

// Basis-Validierung fuer Pen-Strokes. Verhindert Riesen-Payloads /
// kaputte Daten in der DB.
const MAX_POINTS = 4000;
function sanitizePoints(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (let i = 0; i < points.length && out.length < MAX_POINTS; i += 1) {
    const p = points[i];
    if (!p || typeof p !== 'object') continue;
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    // 1 Dezimalstelle reicht; spart Storage + JSON-Bytes.
    out.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }
  return out;
}

function sanitizeColor(color) {
  if (typeof color !== 'string') return '#1f2937';
  // erlaubt: #rgb, #rrggbb, named demo set
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) return color;
  return '#1f2937';
}

function sanitizeSize(size) {
  const n = Number(size);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(40, n));
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
  await ensureTable(pool);

  if (req.method === 'GET') {
    try {
      const { rows } = await pool.query(
        'SELECT id, color, size, points, EXTRACT(EPOCH FROM created_at) * 1000 AS created_at FROM whiteboard_strokes WHERE user_id = $1 ORDER BY created_at ASC',
        [userId]
      );
      return res.json({ strokes: rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const action = body.action || 'create';

    if (action === 'create') {
      const id = String(body.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id required' });
      const points = sanitizePoints(body.points);
      if (points.length < 2) return res.status(400).json({ error: 'mindestens 2 Punkte' });
      const color = sanitizeColor(body.color);
      const size = sanitizeSize(body.size);
      try {
        await pool.query(
          `INSERT INTO whiteboard_strokes (id, user_id, color, size, points)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [id, userId, color, size, JSON.stringify(points)]
        );
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (action === 'delete') {
      const id = String(body.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id required' });
      try {
        await pool.query(
          'DELETE FROM whiteboard_strokes WHERE id = $1 AND user_id = $2',
          [id, userId]
        );
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (action === 'clear') {
      try {
        await pool.query(
          'DELETE FROM whiteboard_strokes WHERE user_id = $1',
          [userId]
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
