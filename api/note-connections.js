/**
 * api/note-connections.js
 *
 * Mindmap-Verbindungen zwischen Notes.
 * Eigener Endpunkt zusätzlich zu api/notes.js, damit die bestehende Notes-API
 * unangetastet bleibt.
 *
 * Routen:
 *   GET    /api/note-connections                → Alle Connections des Users
 *   POST   /api/note-connections   { note_id_1, note_id_2, relationship_type? }
 *   DELETE /api/note-connections?id=123
 *   DELETE /api/note-connections   { note_id_1, note_id_2 }
 */

const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

function toPositiveInt(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function userOwnsOrSharesNote(pool, noteId, userId) {
  const userIdText = String(userId);
  const result = await pool.query(
    `SELECT 1
       FROM notes n
       LEFT JOIN note_shares ns ON ns.note_id = n.id AND ns.friend_id::text = $2
      WHERE n.id = $1
        AND (
              n.user_id::text = $2
           OR ns.id IS NOT NULL
           OR $3 = ANY(COALESCE(n.participant_ids, '{}'::integer[]))
           OR n.responsible_user_id = $3
        )
      LIMIT 1`,
    [noteId, userIdText, userId]
  );
  return result.rows.length > 0;
}

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Nicht authentifiziert' });
  }

  const userId = user.id;
  const userIdText = String(userId);
  const pool = getPool();

  try {
    // ============================================================
    // GET — Alle Connections, die Notes des Users betreffen
    // ============================================================
    if (req.method === 'GET') {
      const result = await pool.query(
        `SELECT nc.*
           FROM note_connections nc
           JOIN notes n1 ON n1.id = nc.note_id_1
           JOIN notes n2 ON n2.id = nc.note_id_2
          WHERE (
                  n1.user_id::text = $1
               OR n2.user_id::text = $1
               OR EXISTS (SELECT 1 FROM note_shares ns WHERE ns.note_id = n1.id AND ns.friend_id::text = $1)
               OR EXISTS (SELECT 1 FROM note_shares ns WHERE ns.note_id = n2.id AND ns.friend_id::text = $1)
               OR $2 = ANY(COALESCE(n1.participant_ids, '{}'::integer[]))
               OR $2 = ANY(COALESCE(n2.participant_ids, '{}'::integer[]))
          )
          ORDER BY nc.created_at DESC`,
        [userIdText, userId]
      );
      return res.status(200).json({ connections: result.rows });
    }

    // ============================================================
    // POST — neue Verbindung anlegen
    // ============================================================
    if (req.method === 'POST') {
      const rawA = req.body?.note_id_1 ?? req.body?.source_note_id ?? req.body?.note_id;
      const rawB = req.body?.note_id_2 ?? req.body?.target_note_id ?? req.body?.other_note_id;
      const relType = String(req.body?.relationship_type || 'related').substring(0, 20);

      const a = toPositiveInt(rawA);
      const b = toPositiveInt(rawB);

      if (!a || !b || a === b) {
        return res.status(400).json({ error: 'Ungueltige Note-IDs' });
      }

      const [hasA, hasB] = await Promise.all([
        userOwnsOrSharesNote(pool, a, userId),
        userOwnsOrSharesNote(pool, b, userId),
      ]);

      if (!hasA || !hasB) {
        return res.status(403).json({ error: 'Keine Berechtigung fuer eine der Notes' });
      }

      const [n1, n2] = a < b ? [a, b] : [b, a];

      const insert = await pool.query(
        `INSERT INTO note_connections (note_id_1, note_id_2, relationship_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (note_id_1, note_id_2) DO NOTHING
         RETURNING *`,
        [n1, n2, relType]
      );

      if (insert.rows.length > 0) {
        return res.status(201).json({ connection: insert.rows[0] });
      }

      // Bereits vorhanden -> zurueckgeben
      const existing = await pool.query(
        `SELECT * FROM note_connections WHERE note_id_1 = $1 AND note_id_2 = $2 LIMIT 1`,
        [n1, n2]
      );
      return res.status(200).json({ connection: existing.rows[0] || null });
    }

    // ============================================================
    // DELETE — Verbindung entfernen
    // ============================================================
    if (req.method === 'DELETE') {
      const idFromQuery = toPositiveInt(req.query?.id);

      if (idFromQuery) {
        const removed = await pool.query(
          `DELETE FROM note_connections nc
            USING notes n1, notes n2
            WHERE nc.id = $1
              AND n1.id = nc.note_id_1
              AND n2.id = nc.note_id_2
              AND (n1.user_id::text = $2 OR n2.user_id::text = $2)
           RETURNING nc.*`,
          [idFromQuery, userIdText]
        );
        return res.status(200).json({
          removed: removed.rows.length > 0,
          connection: removed.rows[0] || null,
        });
      }

      const rawA = req.body?.note_id_1 ?? req.body?.source_note_id;
      const rawB = req.body?.note_id_2 ?? req.body?.target_note_id;
      const a = toPositiveInt(rawA);
      const b = toPositiveInt(rawB);

      if (!a || !b) {
        return res.status(400).json({ error: 'Note-IDs fehlen' });
      }

      const [hasA, hasB] = await Promise.all([
        userOwnsOrSharesNote(pool, a, userId),
        userOwnsOrSharesNote(pool, b, userId),
      ]);
      if (!hasA || !hasB) {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }

      const [n1, n2] = a < b ? [a, b] : [b, a];
      const removed = await pool.query(
        `DELETE FROM note_connections
          WHERE note_id_1 = $1 AND note_id_2 = $2
         RETURNING *`,
        [n1, n2]
      );

      return res.status(200).json({
        removed: removed.rows.length > 0,
        connection: removed.rows[0] || null,
      });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (error) {
    console.error('[note-connections] error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error',
      detail: error.code || null,
    });
  }
};
