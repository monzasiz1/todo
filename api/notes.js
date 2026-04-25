const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

let linkedTaskColumnTypeCache = null;
let linkedTaskColumnTypeCacheAt = 0;
const LINKED_TASK_TYPE_CACHE_TTL_MS = 60 * 1000;
let notesUserIdTypeCache = null;
let notesUserIdTypeCacheAt = 0;
const NOTES_USER_TYPE_CACHE_TTL_MS = 60 * 1000;

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

async function getNotesUserIdColumnType(pool) {
  const now = Date.now();
  if (notesUserIdTypeCache && now - notesUserIdTypeCacheAt < NOTES_USER_TYPE_CACHE_TTL_MS) {
    return notesUserIdTypeCache;
  }

  const result = await pool.query(
    `SELECT data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'notes'
        AND column_name = 'user_id'
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

  notesUserIdTypeCache = type;
  notesUserIdTypeCacheAt = now;
  return type;
}

async function tryAutoRepairNotesUserIdType(pool) {
  const userType = await getNotesUserIdColumnType(pool);
  if (userType !== 'uuid') return false;

  const countRes = await pool.query('SELECT COUNT(*)::int AS c FROM notes');
  const count = Number(countRes.rows?.[0]?.c || 0);
  if (count > 0) return false;

  try {
    await pool.query('ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_user_id_fkey');
    await pool.query('ALTER TABLE notes ALTER COLUMN user_id DROP NOT NULL');
    await pool.query('ALTER TABLE notes ALTER COLUMN user_id TYPE INTEGER USING NULL');
    await pool.query('ALTER TABLE notes ALTER COLUMN user_id SET NOT NULL');
    await pool.query('ALTER TABLE notes ADD CONSTRAINT notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');

    notesUserIdTypeCache = 'integer';
    notesUserIdTypeCacheAt = Date.now();
    return true;
  } catch {
    return false;
  }
}

async function normalizeNotesOwnerIdForDb(pool, rawUserId) {
  const userType = await getNotesUserIdColumnType(pool);
  const asText = String(rawUserId);

  if (userType === 'integer') {
    const n = Number(rawUserId);
    if (Number.isInteger(n) && n > 0) return { value: n, valid: true };
    return { value: null, valid: false };
  }

  if (userType === 'uuid') {
    if (isUuid(asText)) return { value: asText, valid: true };
    return { value: null, valid: false };
  }

  return { value: null, valid: false };
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

  const currentUserIdText = String(userId || '').trim();
  const friendIdText = String(rawFriendId || '').trim();
  if (!currentUserIdText || !friendIdText) return null;

  const userExists = await pool.query('SELECT id FROM users WHERE id::text = $1 LIMIT 1', [friendIdText]);
  if (userExists.rows.length > 0 && String(userExists.rows[0].id) !== currentUserIdText) {
    // Ensure there is an accepted friendship in either direction.
    const accepted = await pool.query(
      `SELECT id
         FROM friends
        WHERE status = 'accepted'
          AND ((user_id::text = $1 AND friend_id::text = $2) OR (user_id::text = $2 AND friend_id::text = $1))
        LIMIT 1`,
      [currentUserIdText, friendIdText]
    );
    return accepted.rows.length > 0 ? userExists.rows[0].id : null;
  }

  const friendship = await pool.query(
    `SELECT user_id, friend_id
       FROM friends
      WHERE id::text = $1
        AND status = 'accepted'
        AND (user_id::text = $2 OR friend_id::text = $2)
      LIMIT 1`,
    [friendIdText, currentUserIdText]
  );

  if (friendship.rows.length === 0) return null;
  const row = friendship.rows[0];
  return String(row.user_id) === currentUserIdText ? row.friend_id : row.user_id;
}

async function resolveParticipantUserId(pool, rawParticipantId, userId) {
  if (rawParticipantId === null || rawParticipantId === undefined) return null;

  const participantIdText = String(rawParticipantId || '').trim();
  if (!participantIdText) return null;

  const directUser = await pool.query(
    'SELECT id FROM users WHERE id::text = $1 LIMIT 1',
    [participantIdText]
  );
  if (directUser.rows.length > 0) {
    return Number(directUser.rows[0].id) || null;
  }

  const resolvedFriendUserId = await resolveFriendUserId(pool, participantIdText, userId);
  return resolvedFriendUserId ? Number(resolvedFriendUserId) || null : null;
}

async function normalizeParticipantIdsForDb(pool, participantIds, userId) {
  const resolvedIds = [];
  const seen = new Set();

  for (const rawId of Array.isArray(participantIds) ? participantIds : []) {
    const resolvedId = await resolveParticipantUserId(pool, rawId, userId);
    if (!resolvedId) continue;
    const key = String(resolvedId);
    if (seen.has(key)) continue;
    seen.add(key);
    resolvedIds.push(resolvedId);
  }

  return resolvedIds;
}

/**
 * Synchronise note_shares with participant_ids.
 * - Adds shares for newly added participant IDs.
 * - Removes shares for participant IDs that were removed.
 * ownerIdText must be excluded from shares.
 */
async function syncParticipantShares(pool, noteId, ownerIdText, prevParticipantIds, nextParticipantIds) {
  const prevSet = new Set((prevParticipantIds || []).map(String));
  const nextSet = new Set((nextParticipantIds || []).map(String));

  const added = [...nextSet].filter((id) => !prevSet.has(id) && id !== ownerIdText);
  const removed = [...prevSet].filter((id) => !nextSet.has(id) && id !== ownerIdText);

  for (const id of added) {
    await pool.query(
      `INSERT INTO note_shares (note_id, friend_id, permission)
       VALUES ($1, $2, 'view')
       ON CONFLICT (note_id, friend_id) DO NOTHING`,
      [noteId, Number(id)]
    ).catch(() => null);
  }
  for (const id of removed) {
    await pool.query(
      `DELETE FROM note_shares WHERE note_id = $1 AND friend_id::text = $2`,
      [noteId, id]
    ).catch(() => null);
  }
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

    const userIdText = String(user.id);
    const userId = Number(user.id);

    const pool = getPool();
    const subPath = req.query.__path || '';
    const segments = subPath.split('/').filter(Boolean);
    const legacyMethod = String(
      Array.isArray(req.query.method) ? req.query.method[0] : (req.query.method || '')
    ).toLowerCase();
    const legacyNoteId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    const requestedView = String(
      Array.isArray(req.query.view) ? req.query.view[0] : (req.query.view || '')
    ).toLowerCase();
    const rootAction = String(req.body?.action || '').toLowerCase();
    const rootActionNoteId = req.body?.id || req.body?.noteId || null;

    // GET /api/notes
    if (segments.length === 0 && req.method === 'GET' && !requestedView) {
      let ownNotes = [];
      try {
        const result = await pool.query(
          `SELECT n.*, t.title AS linked_task_title
             FROM notes n
             LEFT JOIN tasks t ON t.id::text = n.linked_task_id::text
            WHERE n.user_id::text = $1
            ORDER BY n.updated_at DESC, n.created_at DESC`,
          [userIdText]
        );
        ownNotes = result.rows;
      } catch {
        try {
          const resultNoJoin = await pool.query(
            `SELECT n.*
               FROM notes n
              WHERE n.user_id::text = $1
              ORDER BY n.updated_at DESC, n.created_at DESC`,
            [userIdText]
          );
          ownNotes = resultNoJoin.rows;
        } catch {
          const resultLegacy = await pool.query(
            `SELECT n.*
               FROM notes n
              WHERE n.user_id::text = $1
              ORDER BY n.created_at DESC`,
            [userIdText]
          );
          ownNotes = resultLegacy.rows;
        }
      }

      // Backfill and repair participant IDs for notes created before the frontend used real user IDs.
      for (const note of ownNotes) {
        const rawParticipantIds = Array.isArray(note.participant_ids) ? note.participant_ids.filter(Boolean) : [];
        const normalizedParticipantIds = await normalizeParticipantIdsForDb(pool, rawParticipantIds, userId);
        const normalizedResponsibleId = note.responsible_user_id
          ? await resolveParticipantUserId(pool, note.responsible_user_id, userId)
          : null;
        const participantIdsChanged = JSON.stringify(rawParticipantIds.map(String)) !== JSON.stringify(normalizedParticipantIds.map(String));
        const responsibleChanged = String(note.responsible_user_id || '') !== String(normalizedResponsibleId || '');

        if (participantIdsChanged || responsibleChanged) {
          const repaired = await pool.query(
            `UPDATE notes
                SET participant_ids = $1,
                    responsible_user_id = $2,
                    updated_at = NOW()
              WHERE id = $3
              RETURNING *`,
            [normalizedParticipantIds, normalizedResponsibleId, note.id]
          ).catch(() => null);

          if (repaired?.rows?.[0]) {
            Object.assign(note, repaired.rows[0]);
          } else {
            note.participant_ids = normalizedParticipantIds;
            note.responsible_user_id = normalizedResponsibleId;
          }
        }

        if (normalizedParticipantIds.length === 0) continue;
        await syncParticipantShares(pool, note.id, userIdText, [], normalizedParticipantIds).catch(() => null);
      }

      return res.status(200).json({ notes: ownNotes });
    }

    // POST /api/notes
    if (segments.length === 0 && req.method === 'POST' && !legacyMethod && !rootAction) {
      const {
        title,
        content = '',
        importance = 'medium',
        date = null,
        linked_task_id = null,
        x = null,
        y = null,
        participant_ids = [],
        responsible_user_id = null,
      } = req.body || {};

      if (!title || !String(title).trim()) {
        return res.status(400).json({ error: 'Titel ist erforderlich' });
      }

      const validImportance = ['low', 'medium', 'high'].includes(importance) ? importance : 'medium';
      const hasLinkedTaskInput = !(linked_task_id === null || linked_task_id === undefined || String(linked_task_id).trim() === '');
      const normalizedTask = await normalizeLinkedTaskForDb(pool, linked_task_id, userId);
      let ownerId = await normalizeNotesOwnerIdForDb(pool, user.id);

      if (!ownerId.valid) {
        const repaired = await tryAutoRepairNotesUserIdType(pool);
        if (repaired) {
          ownerId = await normalizeNotesOwnerIdForDb(pool, user.id);
        }
      }

      if (!ownerId.valid) {
        return res.status(500).json({
          error: 'Schema-Mismatch: notes.user_id passt nicht zur User-ID. Bitte Notes-Migration ausfuehren.',
          detail: 'notes.user_id type incompatible',
        });
      }

      if (hasLinkedTaskInput && !normalizedTask.allowed) {
        return res.status(403).json({ error: 'Keine Berechtigung fuer verknuepfte Aufgabe' });
      }

      const safeParticipantIds = await normalizeParticipantIdsForDb(pool, participant_ids, userId);
      const safeResponsibleId = responsible_user_id
        ? await resolveParticipantUserId(pool, responsible_user_id, userId)
        : null;

      let insert;
      // Try with participant columns first; fall back gracefully if columns don't exist yet
      try {
        insert = await pool.query(
          `INSERT INTO notes (user_id, title, content, importance, date, linked_task_id, x, y, participant_ids, responsible_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            ownerId.value,
            String(title).trim(),
            String(content || ''),
            validImportance,
            date || null,
            normalizedTask.value,
            x === null || x === undefined ? null : Number(x),
            y === null || y === undefined ? null : Number(y),
            safeParticipantIds,
            safeResponsibleId,
          ]
        );
      } catch (err) {
        // 42703 = undefined column; also catch position / linked_task type errors
        const isMissingColumn = err.code === '42703';
        if (!isMissingColumn && !isMissingPositionColumnError(err) && !isLinkedTaskTypeError(err)) throw err;

        // Fallback: insert without participant columns (and without position if needed)
        try {
          insert = await pool.query(
            `INSERT INTO notes (user_id, title, content, importance, date, linked_task_id, x, y)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
              ownerId.value,
              String(title).trim(),
              String(content || ''),
              validImportance,
              date || null,
              isLinkedTaskTypeError(err) ? null : normalizedTask.value,
              x === null || x === undefined ? null : Number(x),
              y === null || y === undefined ? null : Number(y),
            ]
          );
        } catch (err2) {
          if (!isMissingPositionColumnError(err2) && !isLinkedTaskTypeError(err2)) throw err2;
          insert = await pool.query(
            `INSERT INTO notes (user_id, title, content, importance, date, linked_task_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [
              ownerId.value,
              String(title).trim(),
              String(content || ''),
              validImportance,
              date || null,
              isLinkedTaskTypeError(err2) ? null : normalizedTask.value,
            ]
          );
        }
      }

      const createdNote = insert.rows[0];
      // Always sync shares via note_shares table (works even without participant_ids column)
      if (safeParticipantIds.length > 0) {
        await syncParticipantShares(pool, createdNote.id, userIdText, [], safeParticipantIds);
      }

      return res.status(201).json({ note: createdNote });
    }

    // GET /api/notes/shared
    if (
      (segments.length === 1 && segments[0] === 'shared' && req.method === 'GET') ||
      (segments.length === 0 && req.method === 'GET' && requestedView === 'shared')
    ) {
      try {
        const shared = await pool.query(
          `SELECT n.*, ns.permission,
                  u.name AS owner_name,
                  t.title AS linked_task_title
             FROM notes n
             LEFT JOIN note_shares ns ON ns.note_id = n.id AND ns.friend_id::text = $1
             JOIN users u ON u.id = n.user_id
             LEFT JOIN tasks t ON t.id::text = n.linked_task_id::text
            WHERE (
                ns.friend_id::text = $1
               OR (n.user_id::text <> $1 AND ($2 = ANY(COALESCE(n.participant_ids, '{}'::integer[])) OR n.responsible_user_id = $2))
            )
            ORDER BY n.updated_at DESC, n.created_at DESC`,
          [userIdText, userId]
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

    const noteId = segments[0] || legacyNoteId || rootActionNoteId;
    const isLegacyNoteAction = segments.length === 0 && !!legacyMethod && !!legacyNoteId;
    const isRootAction = segments.length === 0 && req.method === 'POST' && !!rootAction && !!noteId;
    const isRootConnectionsView = segments.length === 0 && req.method === 'GET' && requestedView === 'connections' && !!noteId;

    if (!noteId || !isUuid(noteId)) {
      return res.status(404).json({ error: 'Route nicht gefunden' });
    }

    const noteAccess = await pool.query(
      `SELECT n.*, ns.permission AS shared_permission
         FROM notes n
         LEFT JOIN note_shares ns ON ns.note_id = n.id AND ns.friend_id::text = $2
        WHERE n.id = $1
          AND (
            n.user_id::text = $2
            OR ns.friend_id::text = $2
            OR $3 = ANY(COALESCE(n.participant_ids, '{}'::integer[]))
            OR n.responsible_user_id = $3
          )
        LIMIT 1`,
      [noteId, userIdText, userId]
    );

    if (noteAccess.rows.length === 0) {
      return res.status(404).json({ error: 'Note nicht gefunden' });
    }

    const note = noteAccess.rows[0];
    const isOwner = String(note.user_id) === userIdText;

    // PATCH /api/notes/:id
    if (
      (segments.length === 1 && (req.method === 'PATCH' || req.method === 'PUT')) ||
      (isLegacyNoteAction && req.method === 'POST' && ['update', 'edit'].includes(legacyMethod)) ||
      (isRootAction && ['update', 'edit'].includes(rootAction))
    ) {
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

      // participant_ids and responsible_user_id – owner-only
      // Read previous participants from note row (may be null if column doesn't exist)
      let prevParticipantIds = Array.isArray(note.participant_ids) ? note.participant_ids : [];
      let nextParticipantIds = prevParticipantIds;
      let participantsChanged = false;
      let participantFieldsToAdd = [];
      let participantValuesToAdd = [];

      if (isOwner && updates.participant_ids !== undefined) {
        nextParticipantIds = await normalizeParticipantIdsForDb(pool, updates.participant_ids, userId);
        participantFieldsToAdd.push({ field: `participant_ids = $${idx}`, value: nextParticipantIds });
        idx++;
        participantsChanged = true;
      }
      if (isOwner && updates.responsible_user_id !== undefined) {
        const safeResponsible = updates.responsible_user_id
          ? await resolveParticipantUserId(pool, updates.responsible_user_id, userId)
          : null;
        participantFieldsToAdd.push({ field: `responsible_user_id = $${idx}`, value: safeResponsible });
        idx++;
      }
      // Add participant fields to main query (may fail if columns don't exist – handled below)
      participantFieldsToAdd.forEach(({ field, value }) => {
        fields.push(field);
        values.push(value);
      });

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
        // 42703 = undefined column (e.g. participant_ids or responsible_user_id not yet migrated)
        const isMissingColumn = err.code === '42703';
        if (!isMissingColumn && !isLinkedTaskTypeError(err) && !isMissingPositionColumnError(err)) throw err;

        // Rebuild query without problematic fields
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
          const validImportance = ['low', 'medium', 'high'].includes(updates.importance) ? updates.importance : 'medium';
          rebuiltFields.push(`importance = $${paramIdx++}`);
          rebuiltValues.push(validImportance);
        }
        if (updates.date !== undefined) {
          rebuiltFields.push(`date = $${paramIdx++}`);
          rebuiltValues.push(updates.date || null);
        }
        if (!isLinkedTaskTypeError(err) && updates.linked_task_id !== undefined) {
          const hasInput = !(updates.linked_task_id === null || updates.linked_task_id === '' || updates.linked_task_id === undefined);
          const normalizedTask = await normalizeLinkedTaskForDb(pool, updates.linked_task_id, userId);
          if (hasInput && !normalizedTask.allowed) {
            return res.status(403).json({ error: 'Keine Berechtigung fuer verknuepfte Aufgabe' });
          }
          rebuiltFields.push(`linked_task_id = $${paramIdx++}`);
          rebuiltValues.push(normalizedTask.value);
        }
        if (!isMissingPositionColumnError(err)) {
          if (updates.x !== undefined) {
            rebuiltFields.push(`x = $${paramIdx++}`);
            rebuiltValues.push(updates.x === null ? null : Number(updates.x));
          }
          if (updates.y !== undefined) {
            rebuiltFields.push(`y = $${paramIdx++}`);
            rebuiltValues.push(updates.y === null ? null : Number(updates.y));
          }
        }
        rebuiltFields.push('updated_at = NOW()');

        if (rebuiltFields.length === 1) {
          // Only updated_at – still sync shares then return existing note
          if (participantsChanged) {
            await syncParticipantShares(pool, noteId, userIdText, prevParticipantIds, nextParticipantIds);
          }
          return res.status(200).json({ note });
        }

        rebuiltValues.push(noteId);
        update = await pool.query(
          `UPDATE notes SET ${rebuiltFields.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
          rebuiltValues
        );
      }

      const finalNote = update.rows[0];
      // Sync shares after update
      if (participantsChanged) {
        await syncParticipantShares(pool, noteId, userIdText, prevParticipantIds, nextParticipantIds);
      }
      return res.status(200).json({ note: finalNote });
    }

    if (
      (segments.length === 1 && req.method === 'DELETE') ||
      (isLegacyNoteAction && req.method === 'POST' && ['delete', 'remove'].includes(legacyMethod)) ||
      (isRootAction && ['delete', 'remove'].includes(rootAction))
    ) {
      if (!isOwner) {
        return res.status(403).json({ error: 'Nur Eigentuemer kann loeschen' });
      }

      await pool.query('DELETE FROM note_shares WHERE note_id = $1', [noteId]);
      await pool.query('DELETE FROM note_connections WHERE note_id_1 = $1 OR note_id_2 = $1', [noteId]);
      await pool.query('DELETE FROM notes WHERE id = $1 AND user_id::text = $2', [noteId, userIdText]);

      return res.status(200).json({ success: true });
    }

    // POST /api/notes/:id/link-task
    if (
      (segments.length === 2 && segments[1] === 'link-task' && req.method === 'POST') ||
      (isLegacyNoteAction && req.method === 'POST' && ['link-task', 'link_task', 'linktask'].includes(legacyMethod)) ||
      (isRootAction && ['link-task', 'link_task', 'linktask'].includes(rootAction))
    ) {
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
    if (
      (segments.length === 2 && segments[1] === 'share' && req.method === 'POST') ||
      (isLegacyNoteAction && req.method === 'POST' && legacyMethod === 'share') ||
      (isRootAction && rootAction === 'share')
    ) {
      if (!isOwner) {
        return res.status(403).json({ error: 'Nur Eigentuemer kann teilen' });
      }

      const { friend_id, permission = 'view' } = req.body || {};
      const friendIdStr = String(friend_id || '').trim();
      if (!friendIdStr) {
        return res.status(400).json({ error: 'friend_id ist erforderlich' });
      }

      // First try direct user lookup (participants may not be friends with owner)
      let targetUserId = null;
      const directUser = await pool.query(
        'SELECT id FROM users WHERE id::text = $1 LIMIT 1',
        [friendIdStr]
      );
      if (directUser.rows.length > 0 && String(directUser.rows[0].id) !== userIdText) {
        targetUserId = directUser.rows[0].id;
      } else if (!targetUserId) {
        // Fallback: legacy friendship-id resolution
        targetUserId = await resolveFriendUserId(pool, friend_id, user.id);
      }

      if (!targetUserId) {
        return res.status(400).json({ error: 'Ziel-Nutzer nicht gefunden' });
      }

      if (String(targetUserId) === userIdText) {
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

    // POST /api/notes/:id/unshare
    if (
      (segments.length === 2 && ['unshare', 'remove-share', 'unshare-friend'].includes(segments[1]) && req.method === 'POST') ||
      (isLegacyNoteAction && req.method === 'POST' && ['unshare', 'remove-share'].includes(legacyMethod)) ||
      (isRootAction && ['unshare', 'remove-share'].includes(rootAction))
    ) {
      if (!isOwner) {
        return res.status(403).json({ error: 'Nur Eigentuemer kann Freigaben entfernen' });
      }

      const { friend_id } = req.body || {};
      const friendIdText = String(friend_id || '').trim();
      if (!friendIdText) {
        return res.status(400).json({ error: 'friend_id ist erforderlich' });
      }

      const existingTarget = await pool.query(
        `SELECT friend_id
           FROM note_shares
          WHERE note_id = $1
            AND friend_id::text = $2
          LIMIT 1`,
        [noteId, friendIdText]
      );

      let targetUserId = existingTarget.rows[0]?.friend_id || null;
      if (!targetUserId) {
        // Try direct user lookup first
        const directUser = await pool.query(
          'SELECT id FROM users WHERE id::text = $1 LIMIT 1',
          [friendIdText]
        );
        if (directUser.rows.length > 0) {
          targetUserId = directUser.rows[0].id;
        } else {
          targetUserId = await resolveFriendUserId(pool, friend_id, user.id);
        }
      }

      if (!targetUserId) {
        return res.status(400).json({ error: 'friend_id ist ungueltig' });
      }

      const removed = await pool.query(
        `DELETE FROM note_shares
          WHERE note_id = $1
            AND friend_id = $2
          RETURNING *`,
        [noteId, targetUserId]
      );

      return res.status(200).json({
        removed: removed.rows.length > 0,
        share: removed.rows[0] || null,
      });
    }

    // GET /api/notes/:id/connections
    if (
      (segments.length === 2 && segments[1] === 'connections' && req.method === 'GET') ||
      (isLegacyNoteAction && ['GET', 'POST'].includes(req.method) && legacyMethod === 'connections') ||
      isRootConnectionsView
    ) {
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
    if (
      (segments.length === 2 && segments[1] === 'connect' && req.method === 'POST') ||
      (isLegacyNoteAction && req.method === 'POST' && ['connect', 'connections'].includes(legacyMethod)) ||
      (isRootAction && ['connect', 'connections'].includes(rootAction))
    ) {
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
              user_id::text = $2
              OR EXISTS (
                SELECT 1 FROM note_shares ns WHERE ns.note_id = notes.id AND ns.friend_id::text = $2
              )
            )
          LIMIT 1`,
        [otherNoteId, userIdText]
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

    // POST /api/notes/:id/disconnect
    if (
      (segments.length === 2 && ['disconnect', 'unlink'].includes(segments[1]) && req.method === 'POST') ||
      (isLegacyNoteAction && req.method === 'POST' && ['disconnect', 'unlink'].includes(legacyMethod)) ||
      (isRootAction && ['disconnect', 'unlink'].includes(rootAction))
    ) {
      if (!isOwner && note.shared_permission !== 'edit') {
        return res.status(403).json({ error: 'Keine Berechtigung zum Bearbeiten' });
      }

      const otherNoteId = req.body?.other_note_id || req.body?.note_id;

      if (!isUuid(otherNoteId) || otherNoteId === noteId) {
        return res.status(400).json({ error: 'Ungueltige Ziel-Note' });
      }

      const otherAccess = await pool.query(
        `SELECT id
           FROM notes
          WHERE id = $1
            AND (
              user_id::text = $2
              OR EXISTS (
                SELECT 1 FROM note_shares ns WHERE ns.note_id = notes.id AND ns.friend_id::text = $2
              )
            )
          LIMIT 1`,
        [otherNoteId, userIdText]
      );

      if (otherAccess.rows.length === 0) {
        return res.status(404).json({ error: 'Ziel-Note nicht gefunden oder kein Zugriff' });
      }

      const pair = noteId < otherNoteId ? [noteId, otherNoteId] : [otherNoteId, noteId];

      const removed = await pool.query(
        `DELETE FROM note_connections
          WHERE note_id_1 = $1 AND note_id_2 = $2
          RETURNING *`,
        [pair[0], pair[1]]
      );

      return res.status(200).json({
        removed: removed.rows.length > 0,
        connection: removed.rows[0] || null,
      });
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
