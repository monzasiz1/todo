const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

let linkedTaskColumnTypeCache = null;
let linkedTaskColumnTypeCacheAt = 0;
const LINKED_TASK_TYPE_CACHE_TTL_MS = 60 * 1000;

function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function isMissingPositionColumnError(error) {
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  return error.code === '42703' && (msg.includes('"x"') || msg.includes('"y"'));
}

function isLinkedTaskTypeError(error) {
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  return (
    error.code === '22P02' ||
    error.code === '42804' ||
    msg.includes('linked_task_id') ||
    msg.includes('uuid') ||
    msg.includes('integer')
  );
}

async function getLinkedTaskColumnType(pool) {
  const now = Date.now();
  if (linkedTaskColumnTypeCache && now - linkedTaskColumnTypeCacheAt < LINKED_TASK_TYPE_CACHE_TTL_MS) {
    return linkedTaskColumnTypeCache;
  }

  const result = await pool.query(
    `SELECT data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'notes'
        AND column_name = 'linked_task_id'
      LIMIT 1`
  );

  const row = result.rows[0] || null;
  let type = 'unknown';
  if (row) {
    const dataType = String(row.data_type || '').toLowerCase();
    const udtName = String(row.udt_name || '').toLowerCase();
    if (dataType.includes('uuid') || udtName === 'uuid') type = 'uuid';
    else if (dataType.includes('int') || ['int2', 'int4', 'int8'].includes(udtName)) type = 'integer';
  }

  linkedTaskColumnTypeCache = type;
  linkedTaskColumnTypeCacheAt = now;
  return type;
}

async function resolveAccessibleTaskId(pool, rawTaskId, userId) {
  if (rawTaskId === null || rawTaskId === undefined || String(rawTaskId).trim() === '') return null;

  const input = String(rawTaskId).trim();

  const taskAccess = await pool.query(
    `SELECT id
       FROM tasks
      WHERE id::text = $1
        AND (
          user_id = $2
          OR EXISTS (
            SELECT 1
              FROM task_permissions tp
             WHERE tp.task_id = tasks.id
               AND tp.user_id = $2
               AND tp.can_view = true
          )
        )
      LIMIT 1`,
    [input, userId]
  );

  if (taskAccess.rows.length === 0) return null;
  return taskAccess.rows[0].id;
}

async function normalizeLinkedTaskForDb(pool, rawTaskId, userId) {
  const accessibleId = await resolveAccessibleTaskId(pool, rawTaskId, userId);
  if (accessibleId === null) return { value: null, hasInput: false, allowed: false };

  const colType = await getLinkedTaskColumnType(pool);
  const asText = String(accessibleId);

  if (colType === 'uuid') {
    if (isUuid(asText)) return { value: asText, hasInput: true, allowed: true };
    return { value: null, hasInput: true, allowed: true };
  }

  if (colType === 'integer') {
    const n = Number(asText);
    if (Number.isInteger(n) && n > 0) return { value: n, hasInput: true, allowed: true };
    return { value: null, hasInput: true, allowed: true };
  }

  return { value: null, hasInput: true, allowed: true };
}

async function resolveFriendUserId(pool, rawFriendId, userId) {
  if (rawFriendId === null || rawFriendId === undefined) return null;

  const numeric = Number(rawFriendId);
  if (!(Number.isInteger(numeric) && numeric > 0)) return null;

  const userExists = await pool.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [numeric]);
  if (userExists.rows.length > 0 && numeric !== userId) {
    // Ensure there is an accepted friendship in either direction.
    const accepted = await pool.query(
      `SELECT id
         FROM friends
        WHERE status = 'accepted'
          AND ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
        LIMIT 1`,
      [userId, numeric]
    );
    return accepted.rows.length > 0 ? numeric : null;
  }

  const friendship = await pool.query(
    `SELECT user_id, friend_id
       FROM friends
      WHERE id = $1
        AND status = 'accepted'
        AND (user_id = $2 OR friend_id = $2)
      LIMIT 1`,
    [numeric, userId]
  );

  if (friendship.rows.length === 0) return null;
  const row = friendship.rows[0];
  return row.user_id === userId ? row.friend_id : row.user_id;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

    const userIdText = String(user.id);
    const userId = Number(user.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Ungueltiger Nutzer im Token' });
    }

    const pool = getPool();
    const subPath = req.query.__path || '';
    const segments = subPath.split('/').filter(Boolean);

    // GET /api/notes
    if (segments.length === 0 && req.method === 'GET') {
      try {
        const result = await pool.query(
          `SELECT n.*, t.title AS linked_task_title
             FROM notes n
             LEFT JOIN tasks t ON t.id::text = n.linked_task_id::text
            WHERE n.user_id::text = $1
            ORDER BY n.updated_at DESC, n.created_at DESC`,
          [userIdText]
        );
        return res.status(200).json({ notes: result.rows });
      } catch {
        try {
          const resultNoJoin = await pool.query(
            `SELECT n.*
               FROM notes n
              WHERE n.user_id::text = $1
              ORDER BY n.updated_at DESC, n.created_at DESC`,
            [userIdText]
          );
          return res.status(200).json({ notes: resultNoJoin.rows });
        } catch {
          const resultLegacy = await pool.query(
            `SELECT n.*
               FROM notes n
              WHERE n.user_id::text = $1
              ORDER BY n.created_at DESC`,
            [userIdText]
          );
          return res.status(200).json({ notes: resultLegacy.rows });
        }
      }
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
      const hasLinkedTaskInput = !(linked_task_id === null || linked_task_id === undefined || String(linked_task_id).trim() === '');
      const normalizedTask = await normalizeLinkedTaskForDb(pool, linked_task_id, userId);

      if (hasLinkedTaskInput && !normalizedTask.allowed) {
        return res.status(403).json({ error: 'Keine Berechtigung fuer verknuepfte Aufgabe' });
      }

      let insert;
      try {
        insert = await pool.query(
          `INSERT INTO notes (user_id, title, content, importance, date, linked_task_id, x, y)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            userId,
            String(title).trim(),
            String(content || ''),
            validImportance,
            date || null,
            normalizedTask.value,
            x === null || x === undefined ? null : Number(x),
            y === null || y === undefined ? null : Number(y),
          ]
        );
      } catch (err) {
        if (!isMissingPositionColumnError(err) && !isLinkedTaskTypeError(err)) throw err;

        insert = await pool.query(
          `INSERT INTO notes (user_id, title, content, importance, date, linked_task_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            userId,
            String(title).trim(),
            String(content || ''),
            validImportance,
            date || null,
            isLinkedTaskTypeError(err) ? null : normalizedTask.value,
          ]
        );
      }

      return res.status(201).json({ note: insert.rows[0] });
    }

    // GET /api/notes/shared
    if (segments.length === 1 && segments[0] === 'shared' && req.method === 'GET') {
      try {
        const shared = await pool.query(
          `SELECT n.*, ns.permission,
                  u.name AS owner_name,
                  t.title AS linked_task_title
             FROM note_shares ns
             JOIN notes n ON n.id = ns.note_id
             JOIN users u ON u.id = n.user_id
             LEFT JOIN tasks t ON t.id::text = n.linked_task_id::text
            WHERE ns.friend_id::text = $1
            ORDER BY n.updated_at DESC, n.created_at DESC`,
          [userIdText]
        );
        return res.status(200).json({ notes: shared.rows });
      } catch {
        const sharedNoJoin = await pool.query(
          `SELECT n.*, ns.permission,
                  u.name AS owner_name
             FROM note_shares ns
             JOIN notes n ON n.id = ns.note_id
             JOIN users u ON u.id = n.user_id
            WHERE ns.friend_id::text = $1
            ORDER BY n.created_at DESC`,
          [userIdText]
        );
        return res.status(200).json({ notes: sharedNoJoin.rows });
      }
    }

    const noteId = segments[0];
    if (!noteId || !isUuid(noteId)) {
      return res.status(404).json({ error: 'Route nicht gefunden' });
    }

    const noteAccess = await pool.query(
      `SELECT n.*, ns.permission AS shared_permission
         FROM notes n
         LEFT JOIN note_shares ns ON ns.note_id = n.id AND ns.friend_id::text = $2
        WHERE n.id = $1
          AND (n.user_id::text = $2 OR ns.friend_id::text = $2)
        LIMIT 1`,
      [noteId, userIdText]
    );

    if (noteAccess.rows.length === 0) {
      return res.status(404).json({ error: 'Note nicht gefunden' });
    }

    const note = noteAccess.rows[0];
    const isOwner = String(note.user_id) === userIdText;

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
        const hasInput = !(updates.linked_task_id === null || updates.linked_task_id === '' || updates.linked_task_id === undefined);
        const normalizedTask = await normalizeLinkedTaskForDb(pool, updates.linked_task_id, userId);
        if (hasInput && !normalizedTask.allowed) {
          return res.status(403).json({ error: 'Keine Berechtigung fuer verknuepfte Aufgabe' });
        }
        fields.push(`linked_task_id = $${idx++}`);
        values.push(normalizedTask.value);
      }
      if (updates.x !== undefined) {
        fields.push(`x = $${idx++}`);
        values.push(updates.x === null ? null : Number(updates.x));
      }
      if (updates.y !== undefined) {
        fields.push(`y = $${idx++}`);
        values.push(updates.y === null ? null : Number(updates.y));
      }

      fields.push('updated_at = NOW()');

      if (fields.length === 1) {
        return res.status(400).json({ error: 'Keine gueltigen Felder zum Updaten' });
      }

      values.push(noteId);
      let update;
      try {
        update = await pool.query(
          `UPDATE notes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
          values
        );
      } catch (err) {
        if (isLinkedTaskTypeError(err)) {
          const safeFields = fields.filter((f) => !f.startsWith('linked_task_id ='));
          const safeValues = values.slice(0, values.length - 1); // all except noteId

          // remove linked_task_id value from params by rebuilding array safely
          const rebuiltFields = [];
          const rebuiltValues = [];
          let paramIdx = 1;

          if (updates.title !== undefined) {
            rebuiltFields.push(`title = $${paramIdx++}`);
            rebuiltValues.push(String(updates.title || '').trim());
          }
          if (updates.content !== undefined) {
            rebuiltFields.push(`content = $${paramIdx++}`);
            rebuiltValues.push(String(updates.content || ''));
          }
          if (updates.importance !== undefined) {
            const validImportance = ['low', 'medium', 'high'].includes(updates.importance)
              ? updates.importance
              : 'medium';
            rebuiltFields.push(`importance = $${paramIdx++}`);
            rebuiltValues.push(validImportance);
          }
          if (updates.date !== undefined) {
            rebuiltFields.push(`date = $${paramIdx++}`);
            rebuiltValues.push(updates.date || null);
          }
          if (updates.x !== undefined) {
            rebuiltFields.push(`x = $${paramIdx++}`);
            rebuiltValues.push(updates.x === null ? null : Number(updates.x));
          }
          if (updates.y !== undefined) {
            rebuiltFields.push(`y = $${paramIdx++}`);
            rebuiltValues.push(updates.y === null ? null : Number(updates.y));
          }
          rebuiltFields.push('updated_at = NOW()');

          rebuiltValues.push(noteId);
          update = await pool.query(
            `UPDATE notes SET ${rebuiltFields.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
            rebuiltValues
          );
          return res.status(200).json({ note: update.rows[0] });
        }

        if (!isMissingPositionColumnError(err)) throw err;

        const noPosFields = fields.filter((f) => !f.startsWith('x =') && !f.startsWith('y ='));
        const rebuiltValues = [];
        let paramIdx = 1;
        const rebuiltFields = [];

        if (updates.title !== undefined) {
          rebuiltFields.push(`title = $${paramIdx++}`);
          rebuiltValues.push(String(updates.title || '').trim());
        }
        if (updates.content !== undefined) {
          rebuiltFields.push(`content = $${paramIdx++}`);
          rebuiltValues.push(String(updates.content || ''));
        }
        if (updates.importance !== undefined) {
          const validImportance = ['low', 'medium', 'high'].includes(updates.importance)
            ? updates.importance
            : 'medium';
          rebuiltFields.push(`importance = $${paramIdx++}`);
          rebuiltValues.push(validImportance);
        }
        if (updates.date !== undefined) {
          rebuiltFields.push(`date = $${paramIdx++}`);
          rebuiltValues.push(updates.date || null);
        }
        if (updates.linked_task_id !== undefined) {
          const hasInput = !(updates.linked_task_id === null || updates.linked_task_id === '' || updates.linked_task_id === undefined);
          const normalizedTask = await normalizeLinkedTaskForDb(pool, updates.linked_task_id, userId);
          if (hasInput && !normalizedTask.allowed) {
            return res.status(403).json({ error: 'Keine Berechtigung fuer verknuepfte Aufgabe' });
          }
          rebuiltFields.push(`linked_task_id = $${paramIdx++}`);
          rebuiltValues.push(normalizedTask.value);
        }
        rebuiltFields.push('updated_at = NOW()');

        if (rebuiltFields.length === 1) {
          return res.status(200).json({ note });
        }

        rebuiltValues.push(noteId);
        update = await pool.query(
          `UPDATE notes SET ${rebuiltFields.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
          rebuiltValues
        );
      }

      return res.status(200).json({ note: update.rows[0] });
    }

    // DELETE /api/notes/:id
    if (segments.length === 1 && req.method === 'DELETE') {
      if (!isOwner) {
        return res.status(403).json({ error: 'Nur Eigentuemer kann loeschen' });
      }

      await pool.query('DELETE FROM note_shares WHERE note_id = $1', [noteId]);
      await pool.query('DELETE FROM note_connections WHERE note_id_1 = $1 OR note_id_2 = $1', [noteId]);
      await pool.query('DELETE FROM notes WHERE id = $1 AND user_id::text = $2', [noteId, userIdText]);

      return res.status(200).json({ success: true });
    }

    // POST /api/notes/:id/link-task
    if (segments.length === 2 && segments[1] === 'link-task' && req.method === 'POST') {
      if (!isOwner && note.shared_permission !== 'edit') {
        return res.status(403).json({ error: 'Keine Berechtigung zum Bearbeiten' });
      }

      const hasInput = !(req.body?.task_id === null || req.body?.task_id === undefined || String(req.body?.task_id).trim() === '');
      const normalizedTask = await normalizeLinkedTaskForDb(pool, req.body?.task_id, userId);
      if (hasInput && !normalizedTask.allowed) {
        return res.status(403).json({ error: 'Keine Berechtigung fuer verknuepfte Aufgabe' });
      }

      let updated;
      try {
        updated = await pool.query(
          'UPDATE notes SET linked_task_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
          [normalizedTask.value, noteId]
        );
      } catch (err) {
        if (!isLinkedTaskTypeError(err)) throw err;
        updated = await pool.query(
          'UPDATE notes SET linked_task_id = NULL, updated_at = NOW() WHERE id = $1 RETURNING *',
          [noteId]
        );
      }

      return res.status(200).json({ note: updated.rows[0] });
    }

    // POST /api/notes/:id/share
    if (segments.length === 2 && segments[1] === 'share' && req.method === 'POST') {
      if (!isOwner) {
        return res.status(403).json({ error: 'Nur Eigentuemer kann teilen' });
      }

      const { friend_id, permission = 'view' } = req.body || {};
      const targetUserId = await resolveFriendUserId(pool, friend_id, userId);

      if (!targetUserId) {
        return res.status(400).json({ error: 'friend_id ist ungueltig oder keine bestaetigte Freundschaft' });
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
        `SELECT nc.*, n1.title AS note_1_title, n2.title AS note_2_title
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
        return res.status(400).json({ error: 'Ungueltige Ziel-Note' });
      }

      const otherAccess = await pool.query(
        `SELECT id
           FROM notes
          WHERE id = $1
            AND (
              user_id = $2
              OR EXISTS (
                SELECT 1 FROM note_shares ns WHERE ns.note_id = notes.id AND ns.friend_id = $2
              )
            )
          LIMIT 1`,
        [otherNoteId, userId]
      );

      if (otherAccess.rows.length === 0) {
        return res.status(404).json({ error: 'Ziel-Note nicht gefunden oder kein Zugriff' });
      }

      const pair = noteId < otherNoteId ? [noteId, otherNoteId] : [otherNoteId, noteId];

      const connected = await pool.query(
        `INSERT INTO note_connections (note_id_1, note_id_2, relationship_type)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [pair[0], pair[1], String(relationshipType).substring(0, 20)]
      );

      if (connected.rows.length === 0) {
        const existing = await pool.query(
          'SELECT * FROM note_connections WHERE note_id_1 = $1 AND note_id_2 = $2 LIMIT 1',
          [pair[0], pair[1]]
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
