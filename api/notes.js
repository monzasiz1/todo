const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolveFriendUserId(pool, rawFriendId, userId) {
  if (rawFriendId === null || rawFriendId === undefined) return null;

  const numeric = Number(rawFriendId);
  if (Number.isInteger(numeric) && numeric > 0) {
    // Case 1: frontend sends users.id directly
    const userExists = await pool.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [numeric]);
    if (userExists.rows.length > 0) return numeric;

    // Case 2: frontend sends friends.id -> map to the opposite user
    const friendship = await pool.query(
      `SELECT user_id, friend_id
         FROM friends
        WHERE id = $1
          AND status = 'accepted'
          AND (user_id = $2 OR friend_id = $2)
        LIMIT 1`,
      [numeric, userId]
    );

    if (friendship.rows.length > 0) {
      const row = friendship.rows[0];
      return row.user_id === userId ? row.friend_id : row.user_id;
    }
  }

  return null;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

    const userId = Number(user.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Ungültiger Nutzer im Token' });
    }

    const pool = getPool();
    const subPath = req.query.__path || '';
    const segments = subPath.split('/').filter(Boolean);

    // GET /api/notes
    if (segments.length === 0 && req.method === 'GET') {
      const result = await pool.query(
        `SELECT n.*, t.title AS linked_task_title
           FROM notes n
           LEFT JOIN tasks t ON t.id = n.linked_task_id
          WHERE n.user_id = $1
          ORDER BY n.updated_at DESC, n.created_at DESC`,
        [userId]
      );

      return res.status(200).json({ notes: result.rows });
    }

    // POST /api/notes
    if (segments.length === 0 && req.method === 'POST') {
      const {
        title,
        content = '',
        importance = 'medium',
        date = null,
        linked_task_id = null,
        x = null,
        y = null,
      } = req.body || {};

      if (!title || !String(title).trim()) {
        return res.status(400).json({ error: 'Titel ist erforderlich' });
      }

      const validImportance = ['low', 'medium', 'high'].includes(importance) ? importance : 'medium';
      const taskId = linked_task_id !== null && linked_task_id !== undefined && linked_task_id !== ''
        ? Number(linked_task_id)
        : null;

      if (taskId !== null && (!Number.isInteger(taskId) || taskId <= 0)) {
        return res.status(400).json({ error: 'linked_task_id ist ungültig' });
      }

      if (taskId !== null) {
        const taskAccess = await pool.query(
          `SELECT id FROM tasks
            WHERE id = $1
              AND (
                user_id = $2
                OR EXISTS (
                  SELECT 1 FROM task_permissions tp
                   WHERE tp.task_id = tasks.id AND tp.user_id = $2 AND tp.can_view = true
                )
              )
            LIMIT 1`,
          [taskId, userId]
        );
        if (taskAccess.rows.length === 0) {
          return res.status(403).json({ error: 'Keine Berechtigung für verknüpfte Aufgabe' });
        }
      }

      const insert = await pool.query(
        `INSERT INTO notes (user_id, title, content, importance, date, linked_task_id, x, y)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          userId,
          String(title).trim(),
          String(content || ''),
          validImportance,
          date || null,
          taskId,
          x === null || x === undefined ? null : Number(x),
          y === null || y === undefined ? null : Number(y),
        ]
      );

      return res.status(201).json({ note: insert.rows[0] });
    }

    // GET /api/notes/shared
    if (segments.length === 1 && segments[0] === 'shared' && req.method === 'GET') {
      const shared = await pool.query(
        `SELECT n.*, ns.permission,
                u.name AS owner_name,
                t.title AS linked_task_title
           FROM note_shares ns
           JOIN notes n ON n.id = ns.note_id
           JOIN users u ON u.id = n.user_id
           LEFT JOIN tasks t ON t.id = n.linked_task_id
          WHERE ns.friend_id = $1
          ORDER BY n.updated_at DESC, n.created_at DESC`,
        [userId]
      );

      return res.status(200).json({ notes: shared.rows });
    }

    // Below this line, first segment must be a note id (UUID)
    const noteId = segments[0];
    if (!noteId || !isUuid(noteId)) {
      return res.status(404).json({ error: 'Route nicht gefunden' });
    }

    // Ensure note is accessible (owner OR shared)
    const noteAccess = await pool.query(
      `SELECT n.*, ns.permission AS shared_permission
         FROM notes n
         LEFT JOIN note_shares ns ON ns.note_id = n.id AND ns.friend_id = $2
        WHERE n.id = $1
          AND (n.user_id = $2 OR ns.friend_id = $2)
        LIMIT 1`,
      [noteId, userId]
    );

    if (noteAccess.rows.length === 0) {
      return res.status(404).json({ error: 'Note nicht gefunden' });
    }

    const note = noteAccess.rows[0];
    const isOwner = Number(note.user_id) === userId;

    // PATCH /api/notes/:id
    if (segments.length === 1 && req.method === 'PATCH') {
      if (!isOwner && note.shared_permission !== 'edit') {
        return res.status(403).json({ error: 'Keine Berechtigung zum Bearbeiten' });
      }

      const updates = req.body || {};
      const fields = [];
      const values = [];
      let idx = 1;

      if (updates.title !== undefined) {
        fields.push(`title = $${idx++}`);
        values.push(String(updates.title || '').trim());
      }
      if (updates.content !== undefined) {
        fields.push(`content = $${idx++}`);
        values.push(String(updates.content || ''));
      }
      if (updates.importance !== undefined) {
        const validImportance = ['low', 'medium', 'high'].includes(updates.importance)
          ? updates.importance
          : 'medium';
        fields.push(`importance = $${idx++}`);
        values.push(validImportance);
      }
      if (updates.date !== undefined) {
        fields.push(`date = $${idx++}`);
        values.push(updates.date || null);
      }
      if (updates.linked_task_id !== undefined) {
        const taskId = updates.linked_task_id === null || updates.linked_task_id === ''
          ? null
          : Number(updates.linked_task_id);

        if (taskId !== null && (!Number.isInteger(taskId) || taskId <= 0)) {
          return res.status(400).json({ error: 'linked_task_id ist ungültig' });
        }

        fields.push(`linked_task_id = $${idx++}`);
        values.push(taskId);
      }
      if (updates.x !== undefined) {
        fields.push(`x = $${idx++}`);
        values.push(updates.x === null ? null : Number(updates.x));
      }
      if (updates.y !== undefined) {
        fields.push(`y = $${idx++}`);
        values.push(updates.y === null ? null : Number(updates.y));
      }

      fields.push(`updated_at = NOW()`);

      if (fields.length === 1) {
        return res.status(400).json({ error: 'Keine gültigen Felder zum Updaten' });
      }

      values.push(noteId);
      const update = await pool.query(
        `UPDATE notes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );

      return res.status(200).json({ note: update.rows[0] });
    }

    // DELETE /api/notes/:id
    if (segments.length === 1 && req.method === 'DELETE') {
      if (!isOwner) {
        return res.status(403).json({ error: 'Nur Eigentümer kann löschen' });
      }

      await pool.query('DELETE FROM note_shares WHERE note_id = $1', [noteId]);
      await pool.query('DELETE FROM note_connections WHERE note_id_1 = $1 OR note_id_2 = $1', [noteId]);
      await pool.query('DELETE FROM notes WHERE id = $1 AND user_id = $2', [noteId, userId]);

      return res.status(200).json({ success: true });
    }

    // POST /api/notes/:id/link-task
    if (segments.length === 2 && segments[1] === 'link-task' && req.method === 'POST') {
      if (!isOwner && note.shared_permission !== 'edit') {
        return res.status(403).json({ error: 'Keine Berechtigung zum Bearbeiten' });
      }

      const taskIdRaw = req.body?.task_id;
      const taskId = taskIdRaw === null || taskIdRaw === undefined || taskIdRaw === ''
        ? null
        : Number(taskIdRaw);

      if (taskId !== null && (!Number.isInteger(taskId) || taskId <= 0)) {
        return res.status(400).json({ error: 'task_id ist ungültig' });
      }

      const updated = await pool.query(
        'UPDATE notes SET linked_task_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [taskId, noteId]
      );

      return res.status(200).json({ note: updated.rows[0] });
    }

    // POST /api/notes/:id/share
    if (segments.length === 2 && segments[1] === 'share' && req.method === 'POST') {
      if (!isOwner) {
        return res.status(403).json({ error: 'Nur Eigentümer kann teilen' });
      }

      const { friend_id, permission = 'view' } = req.body || {};
      const targetUserId = await resolveFriendUserId(pool, friend_id, userId);

      if (!targetUserId) {
        return res.status(400).json({ error: 'friend_id ist ungültig oder keine bestätigte Freundschaft' });
      }

      if (targetUserId === userId) {
        return res.status(400).json({ error: 'Eigene Note kann nicht mit dir selbst geteilt werden' });
      }

      const validPermission = ['view', 'comment', 'edit'].includes(permission) ? permission : 'view';

      const shared = await pool.query(
        `INSERT INTO note_shares (note_id, friend_id, permission)
         VALUES ($1, $2, $3)
         ON CONFLICT (note_id, friend_id)
         DO UPDATE SET permission = EXCLUDED.permission
         RETURNING *`,
        [noteId, targetUserId, validPermission]
      );

      return res.status(201).json({ share: shared.rows[0] });
    }

    // GET /api/notes/:id/connections
    if (segments.length === 2 && segments[1] === 'connections' && req.method === 'GET') {
      const connections = await pool.query(
        `SELECT nc.*,
                n1.title AS note_1_title,
                n2.title AS note_2_title
           FROM note_connections nc
           JOIN notes n1 ON n1.id = nc.note_id_1
           JOIN notes n2 ON n2.id = nc.note_id_2
          WHERE nc.note_id_1 = $1 OR nc.note_id_2 = $1
          ORDER BY nc.created_at DESC`,
        [noteId]
      );

      return res.status(200).json({ connections: connections.rows });
    }

    // POST /api/notes/:id/connect
    if (segments.length === 2 && segments[1] === 'connect' && req.method === 'POST') {
      if (!isOwner && note.shared_permission !== 'edit') {
        return res.status(403).json({ error: 'Keine Berechtigung zum Bearbeiten' });
      }

      const otherNoteId = req.body?.other_note_id || req.body?.note_id;
      const relationshipType = req.body?.relationship_type || 'related';

      if (!isUuid(otherNoteId) || otherNoteId === noteId) {
        return res.status(400).json({ error: 'Ungültige Ziel-Note' });
      }

      const otherAccess = await pool.query(
        `SELECT id FROM notes
          WHERE id = $1
            AND (
              user_id = $2
              OR EXISTS (SELECT 1 FROM note_shares ns WHERE ns.note_id = notes.id AND ns.friend_id = $2)
            )
          LIMIT 1`,
        [otherNoteId, userId]
      );

      if (otherAccess.rows.length === 0) {
        return res.status(404).json({ error: 'Ziel-Note nicht gefunden oder kein Zugriff' });
      }

      // normalize direction so (A,B) and (B,A) are considered identical
      const [a, b] = noteId < otherNoteId ? [noteId, otherNoteId] : [otherNoteId, noteId];

      const connected = await pool.query(
        `INSERT INTO note_connections (note_id_1, note_id_2, relationship_type)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [a, b, String(relationshipType).substring(0, 20)]
      );

      if (connected.rows.length === 0) {
        const existing = await pool.query(
          `SELECT * FROM note_connections WHERE note_id_1 = $1 AND note_id_2 = $2 LIMIT 1`,
          [a, b]
        );
        return res.status(200).json({ connection: existing.rows[0] || null });
      }

      return res.status(201).json({ connection: connected.rows[0] });
    }

    return res.status(404).json({ error: 'Route nicht gefunden' });
  } catch (error) {
    console.error('Notes endpoint error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error',
      detail: error.code || error.detail || null,
    });
  }
};
