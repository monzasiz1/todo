const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');
const { broadcastNoteChange } = require('./_lib/notesBroadcast');
const { ensureNoteActivityTable, recordNoteActivity } = require('./_lib/noteActivity');
const {
  snapshotNoteVersion,
  listNoteVersions,
  getNoteVersion,
} = require('./_lib/noteVersions');
const { parseMentionsFromHtml, resolveMentions } = require('./_lib/mentions');
const { sendPushToUser } = require('./_lib/pushService');
const { buildAuthorshipMap } = require('./_lib/noteAuthorship');

let linkedTaskColumnTypeCache = null;
let linkedTaskColumnTypeCacheAt = 0;
const LINKED_TASK_TYPE_CACHE_TTL_MS = 60 * 1000;
let notesUserIdTypeCache = null;
let notesUserIdTypeCacheAt = 0;
const NOTES_USER_TYPE_CACHE_TTL_MS = 60 * 1000;
let noteStatusColumnsEnsuredAt = 0;
const NOTE_STATUS_COLUMNS_TTL_MS = 5 * 60 * 1000;
let getEffectivePermsFn = null;
let getEffectivePermsLoaded = false;

function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

// Akzeptiert sowohl UUIDs (Legacy-Schema) als auch positive INTEGER-IDs
// (aktuelles SERIAL-Schema). Wird ueberall genutzt, wo eine Note-ID aus dem
// Request validiert werden muss — die DB-Queries vergleichen anschliessend
// per ::text/= und funktionieren mit beiden Typen.
function isValidNoteIdString(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  if (!s) return false;
  if (isUuid(s)) return true;
  return /^[0-9]+$/.test(s) && Number(s) > 0;
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

async function ensureNotesStatusColumns(pool) {
  const now = Date.now();
  if (now - noteStatusColumnsEnsuredAt < NOTE_STATUS_COLUMNS_TTL_MS) return;

  try {
    await pool.query('ALTER TABLE notes ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT FALSE');
    await pool.query('ALTER TABLE notes ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP NULL');
    await pool.query("ALTER TABLE notes ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'open'");
    // visibility: 'private' (nur Owner) | 'group' (alle Mitglieder der Task-Gruppe).
    // Index beschleunigt den GET-Filter beim Anzeigen von Team-Notes an Tasks.
    await pool.query("ALTER TABLE notes ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) DEFAULT 'private'");
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notes_linked_task_visibility ON notes (linked_task_id, visibility) WHERE linked_task_id IS NOT NULL`);
    // Farbe der Notiz (Display-Name aus dem Frontend-Color-Picker, z.B.
    // 'Gelb', 'Blau', 'Rosa'). Ersetzt den Legacy-Prefix '[COLOR:Name]'
    // im content. Backfill geschieht transparent auf INSERT/UPDATE.
    await pool.query("ALTER TABLE notes ADD COLUMN IF NOT EXISTS color VARCHAR(16) NULL");
    // Board-Positionen (frei positionierbarer Sticky-Note-Modus).
    // Bislang nur per 42703-Fallback gehandhabt; explizites Anlegen
    // erspart bei jedem Board-Drag einen Retry-Roundtrip.
    await pool.query('ALTER TABLE notes ADD COLUMN IF NOT EXISTS x DOUBLE PRECISION NULL');
    await pool.query('ALTER TABLE notes ADD COLUMN IF NOT EXISTS y DOUBLE PRECISION NULL');
    // Share-Request-Flow: Empfaenger muss aktiv bestaetigen, bevor eine
    // geteilte Notiz in seiner "Mit mir geteilt"-Liste auftaucht. Default
    // 'accepted' fuer Backward-Compat (Bestandsdaten bleiben sichtbar).
    // Neue Shares setzen explizit status='pending'.
    await pool.query("ALTER TABLE note_shares ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'accepted'");
    await pool.query("CREATE INDEX IF NOT EXISTS idx_note_shares_friend_status ON note_shares (friend_id, status)");
    noteStatusColumnsEnsuredAt = now;
  } catch (err) {
    console.warn('[notes] ensure status columns failed:', err?.message || err);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Activity-Feed: pro Note ein zeitlich sortierter Verlauf (created,
// updated, shared, unshared, link/unlink-task, completed/restored,
// share-accepted/declined, comment_added). ensureNoteActivityTable und
// recordNoteActivity leben in ./_lib/noteActivity damit andere Endpoints
// (z.B. api/note-comments.js) dieselben Eintraege schreiben koennen.
// ─────────────────────────────────────────────────────────────────────

// Diff: ermittelt welche Felder sich zwischen prev und next geaendert
// haben, damit der Activity-Eintrag den Grund nennt (nicht nur "updated").
function diffNoteUpdate(prev, next) {
  const changed = [];
  if (!prev || !next) return changed;
  const fields = ['title', 'content', 'importance', 'date', 'visibility', 'status', 'completed', 'linked_task_id', 'color'];
  for (const f of fields) {
    const a = prev[f] === undefined ? null : prev[f];
    const b = next[f] === undefined ? null : next[f];
    if (String(a ?? '') !== String(b ?? '')) changed.push(f);
  }
  return changed;
}

// Akzeptierte Farb-Display-Namen aus dem Frontend-Color-Picker. Wenn das
// Frontend andere Werte schickt, wird auf null normalisiert (Default-Look
// im UI). Begrenzt damit kein Wildwuchs in der DB landet.
const VALID_NOTE_COLORS = new Set([
  'Gelb', 'Rosa', 'Blau', 'Gruen', 'Lila', 'Orange', 'Tuerkis', 'Grau',
  // Legacy / alternative Schreibweisen
  'Gruen ', 'Grün', 'Tuerkis ', 'Türkis',
]);

function normalizeNoteColor(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  if (str.length > 16) return null;
  // Frontend nutzt aktuell deutsche Display-Namen; wir akzeptieren alles
  // bis 16 Zeichen, normalisieren aber Umlaute auf die ASCII-Variante
  // damit DB-Werte konsistent sind.
  const ascii = str
    .replace(/ü/g, 'ue').replace(/Ü/g, 'Ue')
    .replace(/ö/g, 'oe').replace(/Ö/g, 'Oe')
    .replace(/ä/g, 'ae').replace(/Ä/g, 'Ae')
    .replace(/ß/g, 'ss')
    .trim();
  return ascii.slice(0, 16);
}

// Trennt legacy '[COLOR:Name] ' Prefix vom content. Frontend hat das
// frueher in den content geschrieben. Auf INSERT/UPDATE strippen wir
// den Prefix und uebernehmen den Color-Namen in die neue Spalte.
function extractColorPrefix(rawContent) {
  if (rawContent === null || rawContent === undefined) {
    return { color: null, content: '' };
  }
  const str = String(rawContent);
  const m = str.match(/^\s*\[COLOR:([^\]]+)\]\s*/);
  if (!m) return { color: null, content: str };
  return {
    color: normalizeNoteColor(m[1]),
    content: str.slice(m[0].length),
  };
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

  try {
    // Broad access check: own tasks, permission grants, group membership
    let accessRow = null;

    try {
      const result = await pool.query(
        `SELECT t.id
           FROM tasks t
          WHERE t.id::text = $1
            AND (
              t.user_id = $2
              OR EXISTS (
                SELECT 1 FROM task_permissions tp
                 WHERE tp.task_id = t.id AND tp.user_id = $2 AND tp.can_view = true
              )
              OR EXISTS (
                SELECT 1
                  FROM group_tasks gt
                 WHERE gt.task_id = t.id
                   AND (
                     (
                       gt.subgroup_id IS NULL
                       AND EXISTS (
                         SELECT 1
                           FROM group_members gm
                          WHERE gm.group_id = gt.group_id
                            AND gm.user_id = $2
                       )
                     )
                     OR (
                       gt.subgroup_id IS NOT NULL
                       AND EXISTS (
                         SELECT 1
                           FROM group_subgroup_members gsm
                          WHERE gsm.subgroup_id = gt.subgroup_id
                            AND gsm.user_id = $2
                       )
                     )
                   )
              )
            )
          LIMIT 1`,
        [input, userId]
      );
      accessRow = result.rows[0] || null;
    } catch (broadErr) {
      // Fallback: some tables (group_tasks, task_permissions) may not exist yet
      console.warn('[notes] broad task access check failed, falling back to ownership:', broadErr.message);
      try {
        const fallback = await pool.query(
          `SELECT id FROM tasks WHERE id::text = $1 AND user_id = $2 LIMIT 1`,
          [input, userId]
        );
        accessRow = fallback.rows[0] || null;
      } catch {
        accessRow = null;
      }
    }

    if (accessRow) return accessRow.id;

    return null;
  } catch (error) {
    console.error('[notes] resolveAccessibleTaskId error:', error);
    return null;
  }
}

function getEffectivePermsSafe() {
  if (!getEffectivePermsLoaded) {
    getEffectivePermsLoaded = true;
    try {
      ({ getEffectivePerms: getEffectivePermsFn } = require('./groups'));
    } catch {
      getEffectivePermsFn = null;
    }
  }
  return getEffectivePermsFn;
}

async function canUserManageGroupNotesForTask(pool, taskId, userId) {
  if (taskId === null || taskId === undefined || String(taskId).trim() === '') return true;

  const taskIdText = String(taskId).trim();
  try {
    const memberships = await pool.query(
      `SELECT DISTINCT gt.group_id
         FROM group_tasks gt
         JOIN group_members gm
           ON gm.group_id = gt.group_id
          AND gm.user_id = $2
        WHERE gt.task_id::text = $1
          AND (
            gt.subgroup_id IS NULL
            OR EXISTS (
              SELECT 1
                FROM group_subgroup_members gsm
               WHERE gsm.subgroup_id = gt.subgroup_id
                 AND gsm.user_id = $2
            )
          )`,
      [taskIdText, userId]
    );

    if (!memberships.rows.length) {
      const hasGroupTask = await pool.query(
        'SELECT 1 FROM group_tasks WHERE task_id::text = $1 LIMIT 1',
        [taskIdText]
      );
      return hasGroupTask.rows.length === 0;
    }

    const getEffectivePerms = getEffectivePermsSafe();
    if (typeof getEffectivePerms !== 'function') return true;

    for (const row of memberships.rows) {
      try {
        const eff = await getEffectivePerms(pool, row.group_id, userId);
        if (!eff) continue;
        if (eff.role === 'owner' || eff.role === 'admin') return true;
        if (eff.perms && eff.perms.manage_notes === true) return true;
      } catch (permErr) {
        console.warn('[notes] getEffectivePerms failed for group:', row.group_id, permErr?.message || permErr);
      }
    }

    return false;
  } catch (err) {
    console.warn('[notes] manage-notes task check failed:', err?.message || err);
    return true;
  }
}

async function normalizeLinkedTaskForDb(pool, rawTaskId, userId) {
  try {
    const accessibleId = await resolveAccessibleTaskId(pool, rawTaskId, userId);
    if (accessibleId === null) return { value: null, hasInput: false, allowed: false };

    const canManageGroupNotes = await canUserManageGroupNotesForTask(pool, accessibleId, userId);
    if (!canManageGroupNotes) return { value: null, hasInput: true, allowed: false };

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
  } catch (error) {
    console.error('[notes] normalizeLinkedTaskForDb error:', error);
    // In case of error, allow null value but don't block the operation
    return { value: null, hasInput: true, allowed: true };
  }
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

function buildAccessibleNoteClause(noteAlias, noteShareAlias, userIdTextParam, userIdParam) {
  // Eine Notiz ist fuer den User zugaenglich wenn:
  //  - er der Owner ist, ODER
  //  - er als Empfaenger akzeptiert hat (note_shares.status='accepted'), ODER
  //  - er als Participant gelistet ist, ODER
  //  - er als Verantwortlicher eingetragen ist.
  // Pending-Shares zaehlen explizit NICHT, damit der Empfaenger erst aktiv
  // bestaetigen muss bevor die Notiz erscheint.
  return `(
    ${noteAlias}.user_id::text = ${userIdTextParam}
    OR (${noteShareAlias}.friend_id::text = ${userIdTextParam} AND COALESCE(${noteShareAlias}.status, 'accepted') = 'accepted')
    OR ${userIdParam} = ANY(COALESCE(${noteAlias}.participant_ids, '{}'::integer[]))
    OR ${noteAlias}.responsible_user_id = ${userIdParam}
  )`;
}

function buildInheritedConnectionClause(noteAlias, userIdTextParam, userIdParam) {
  const anchorAccess = buildAccessibleNoteClause('anchor', 'anchor_share', userIdTextParam, userIdParam);
  return `EXISTS (
    SELECT 1
      FROM note_connections nc
      JOIN notes anchor
        ON anchor.id = CASE
          WHEN nc.note_id_1 = ${noteAlias}.id THEN nc.note_id_2
          ELSE nc.note_id_1
        END
      LEFT JOIN note_shares anchor_share
        ON anchor_share.note_id = anchor.id
       AND anchor_share.friend_id::text = ${userIdTextParam}
     WHERE (nc.note_id_1 = ${noteAlias}.id OR nc.note_id_2 = ${noteAlias}.id)
       AND ${anchorAccess}
  )`;
}

/**
 * Synchronise note_shares with participant_ids.
 * - Adds shares for newly added participant IDs.
 * - Removes shares for participant IDs that were removed.
 * ownerIdText must be excluded from shares.
 */
async function syncParticipantShares(pool, noteId, ownerIdText, prevParticipantIds, nextParticipantIds, prevResponsibleId = null, nextResponsibleId = null) {
  const prevPermissions = new Map();
  const nextPermissions = new Map();

  (prevParticipantIds || []).map(String).filter(Boolean).forEach((id) => {
    if (id !== ownerIdText) prevPermissions.set(id, 'view');
  });
  (nextParticipantIds || []).map(String).filter(Boolean).forEach((id) => {
    if (id !== ownerIdText) nextPermissions.set(id, 'view');
  });

  const prevResponsibleText = prevResponsibleId ? String(prevResponsibleId) : null;
  const nextResponsibleText = nextResponsibleId ? String(nextResponsibleId) : null;

  if (prevResponsibleText && prevResponsibleText !== ownerIdText) {
    prevPermissions.set(prevResponsibleText, 'edit');
  }
  if (nextResponsibleText && nextResponsibleText !== ownerIdText) {
    nextPermissions.set(nextResponsibleText, 'edit');
  }

  for (const [id, permission] of nextPermissions.entries()) {
    const prevPermission = prevPermissions.get(id);
    if (prevPermission === permission) continue;

    await pool.query(
      `INSERT INTO note_shares (note_id, friend_id, permission, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (note_id, friend_id)
       DO UPDATE SET permission = CASE
         WHEN note_shares.permission = 'edit' THEN 'edit'
         ELSE EXCLUDED.permission
       END`,
      [noteId, Number(id), permission]
    ).catch(() => null);
  }

  for (const id of prevPermissions.keys()) {
    if (nextPermissions.has(id)) continue;
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
    await ensureNotesStatusColumns(pool);
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

    // GET /api/notes  (Standard: nur offene Notes — completed werden ausgeblendet)
    // GET /api/notes?view=archived  → nur abgeschlossene Notes
    if (segments.length === 0 && req.method === 'GET' && (!requestedView || requestedView === 'archived')) {
      const wantsArchive = requestedView === 'archived';
      const completedFilter = wantsArchive
        ? 'AND COALESCE(n.completed, false) = true'
        : 'AND COALESCE(n.completed, false) = false';
      const orderBy = wantsArchive
        ? 'ORDER BY n.completed_at DESC NULLS LAST, n.updated_at DESC'
        : 'ORDER BY n.updated_at DESC, n.created_at DESC';

      let ownNotes = [];
      try {
        const result = await pool.query(
          `SELECT n.*, t.title AS linked_task_title,
                  COALESCE(sh.shares, '[]'::jsonb) AS shares
             FROM notes n
             LEFT JOIN tasks t ON t.id::text = n.linked_task_id::text
             LEFT JOIN LATERAL (
               SELECT jsonb_agg(jsonb_build_object(
                        'user_id', ns.friend_id::text,
                        'permission', ns.permission,
                        'name', su.name,
                        'avatar_url', su.avatar_url
                      )) AS shares
                 FROM note_shares ns
                 LEFT JOIN users su ON su.id::text = ns.friend_id::text
                WHERE ns.note_id = n.id
             ) sh ON true
            WHERE n.user_id::text = $1
              ${completedFilter}
            ${orderBy}`,
          [userIdText]
        );
        ownNotes = result.rows;
      } catch {
        try {
          const resultNoJoin = await pool.query(
            `SELECT n.*
               FROM notes n
              WHERE n.user_id::text = $1
                ${completedFilter}
              ${orderBy}`,
            [userIdText]
          );
          ownNotes = resultNoJoin.rows;
        } catch {
          // Fallback: completed-Spalte existiert evtl. nicht → alles zurück
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
        await syncParticipantShares(pool, note.id, userIdText, [], normalizedParticipantIds, null, normalizedResponsibleId).catch(() => null);
      }

      // Zusaetzlich: Team-Notes (visibility='group') die an Tasks haengen,
      // auf die der User Zugriff hat (eigene, geteilte, Gruppenmitglied).
      // Performance: indexed via idx_notes_linked_task_visibility; ein einziges
      // EXISTS-Subquery deckt alle Zugriffsarten ab.
      if (!wantsArchive) {
        try {
          const teamResult = await pool.query(
            `SELECT n.*, t.title AS linked_task_title,
                    u.name AS owner_name, u.avatar_url AS owner_avatar_url,
                    COALESCE(sh.shares, '[]'::jsonb) AS shares,
                    CASE
                      WHEN n.responsible_user_id::text = $1 THEN 'edit'
                      WHEN EXISTS (
                        SELECT 1
                          FROM group_tasks gtm
                         WHERE gtm.task_id::text = t.id::text
                           AND (
                             (
                               gtm.subgroup_id IS NULL
                               AND EXISTS (
                                 SELECT 1
                                   FROM group_members gmm
                                  WHERE gmm.group_id = gtm.group_id
                                    AND gmm.user_id::text = $1
                               )
                             )
                             OR (
                               gtm.subgroup_id IS NOT NULL
                               AND EXISTS (
                                 SELECT 1
                                   FROM group_subgroup_members gsm
                                  WHERE gsm.subgroup_id = gtm.subgroup_id
                                    AND gsm.user_id::text = $1
                               )
                             )
                           )
                      ) THEN 'edit'
                      ELSE COALESCE(ns.permission, 'view')
                    END AS shared_permission
               FROM notes n
               JOIN tasks t ON t.id::text = n.linked_task_id::text
               LEFT JOIN users u ON u.id::text = n.user_id::text
               LEFT JOIN note_shares ns ON ns.note_id = n.id AND ns.friend_id::text = $1
               LEFT JOIN LATERAL (
                 SELECT jsonb_agg(jsonb_build_object(
                          'user_id', ns2.friend_id::text,
                          'permission', ns2.permission,
                          'name', su.name,
                          'avatar_url', su.avatar_url
                        )) AS shares
                   FROM note_shares ns2
                   LEFT JOIN users su ON su.id::text = ns2.friend_id::text
                  WHERE ns2.note_id = n.id
               ) sh ON true
              WHERE n.user_id::text <> $1
                AND n.visibility = 'group'
                AND COALESCE(n.completed, false) = false
                AND (
                  t.user_id::text = $1
                  OR EXISTS (
                    SELECT 1 FROM task_permissions tp
                     WHERE tp.task_id::text = t.id::text
                       AND tp.user_id::text = $1
                       AND tp.can_view = true
                  )
                  OR EXISTS (
                    SELECT 1
                      FROM group_tasks gt
                     WHERE gt.task_id::text = t.id::text
                       AND (
                         (
                           gt.subgroup_id IS NULL
                           AND EXISTS (
                             SELECT 1
                               FROM group_members gm
                              WHERE gm.group_id = gt.group_id
                                AND gm.user_id::text = $1
                           )
                         )
                         OR (
                           gt.subgroup_id IS NOT NULL
                           AND EXISTS (
                             SELECT 1
                               FROM group_subgroup_members gsm
                              WHERE gsm.subgroup_id = gt.subgroup_id
                                AND gsm.user_id::text = $1
                           )
                         )
                       )
                  )
                )
              ORDER BY n.updated_at DESC`,
            [userIdText]
          );
          // Markiere als foreign; read_only nur wenn keine edit-Permission via note_shares.
          // So koennen Empfaenger mit Schreibrecht die Note auch im Canvas bearbeiten,
          // waehrend reine Gruppen-Leser sie weiterhin nur lesen koennen.
          const taskManageCache = new Map();
          const teamNotes = await Promise.all((teamResult.rows || []).map(async (n) => {
            let canEdit = n.shared_permission === 'edit';
            if (canEdit && n.visibility === 'group' && n.linked_task_id) {
              const key = String(n.linked_task_id);
              if (!taskManageCache.has(key)) {
                const allowed = await canUserManageGroupNotesForTask(pool, n.linked_task_id, userId);
                taskManageCache.set(key, allowed);
              }
              canEdit = taskManageCache.get(key) === true;
            }
            return {
              ...n,
              shared_permission: canEdit ? 'edit' : 'view',
              is_foreign: true,
              read_only: !canEdit,
            };
          }));
          console.log('[notes] team-notes fetched:', teamNotes.length, 'for user', userIdText);
          ownNotes = ownNotes.concat(teamNotes);
        } catch (teamErr) {
          // Fehler nicht fatal — Tabellen group_tasks/task_permissions koennten
          // fehlen oder visibility-Spalte ist noch nicht migriert. Eigene Notes
          // werden bereits korrekt zurueckgegeben.
          console.warn('[notes] team-notes query skipped:', teamErr?.message || teamErr);
        }
      }

      // Color-Backfill: alte Notes haben '[COLOR:Name]' im content statt
      // in der color-Spalte. Wir extrahieren on-the-fly (Response wird
      // 'sauber' ausgeliefert) und stossen einen UPDATE im Hintergrund an,
      // damit kuenftige Reads die Spalte direkt nutzen koennen.
      for (const note of ownNotes) {
        if (!note || note.is_foreign) continue;
        if (note.color) continue;
        const ext = extractColorPrefix(note.content || '');
        if (!ext.color) continue;
        note.color = ext.color;
        note.content = ext.content;
        pool.query(
          'UPDATE notes SET color = $1, content = $2 WHERE id = $3 AND color IS NULL',
          [ext.color, ext.content, note.id]
        ).catch(() => null);
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
        completed = false,
        completed_at = null,
        status = null,
        linked_task_id = null,
        x = null,
        y = null,
        participant_ids = [],
        responsible_user_id = null,
        color: colorInput,
      } = req.body || {};

      // iOS-Notes-Stil: leerer Titel erlaubt (frueher 400 "Titel ist erforderlich")
      const safeTitle = (title && String(title).trim()) ? String(title).trim() : '';

      // Color-DB-Spalte: explizit gesetzter color-Wert hat Vorrang vor
      // Legacy '[COLOR:...]' Prefix im content. Prefix wird in jedem
      // Fall vom gespeicherten content gestripped.
      const { color: contentColor, content: cleanContent } = extractColorPrefix(content);
      const safeColor = normalizeNoteColor(colorInput !== undefined ? colorInput : contentColor);
      const storedContent = cleanContent;

      const validImportance = ['low', 'medium', 'high'].includes(importance) ? importance : 'medium';
      const safeCompleted = !!completed;
      const safeCompletedAt = safeCompleted ? (completed_at || new Date().toISOString()) : null;
      const safeStatus = ['open', 'done', 'blocked', 'active'].includes(String(status || '').toLowerCase())
        ? String(status).toLowerCase()
        : (safeCompleted ? 'done' : 'open');
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
      // Try with participant + color columns first; fall back gracefully if columns don't exist yet
      try {
        insert = await pool.query(
          `INSERT INTO notes (user_id, title, content, importance, date, completed, completed_at, status, linked_task_id, x, y, participant_ids, responsible_user_id, color)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING *`,
          [
            ownerId.value,
            safeTitle,
            storedContent,
            validImportance,
            date || null,
            safeCompleted,
            safeCompletedAt,
            safeStatus,
            normalizedTask.value,
            x === null || x === undefined ? null : Number(x),
            y === null || y === undefined ? null : Number(y),
            safeParticipantIds,
            safeResponsibleId,
            safeColor,
          ]
        );
      } catch (err) {
        // 42703 = undefined column; also catch position / linked_task type errors
        const isMissingColumn = err.code === '42703';
        if (!isMissingColumn && !isMissingPositionColumnError(err) && !isLinkedTaskTypeError(err)) throw err;

        // Fallback: insert without participant / color columns (and without position if needed)
        try {
          insert = await pool.query(
            `INSERT INTO notes (user_id, title, content, importance, date, completed, completed_at, status, linked_task_id, x, y)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [
              ownerId.value,
              safeTitle,
              storedContent,
              validImportance,
              date || null,
              safeCompleted,
              safeCompletedAt,
              safeStatus,
              isLinkedTaskTypeError(err) ? null : normalizedTask.value,
              x === null || x === undefined ? null : Number(x),
              y === null || y === undefined ? null : Number(y),
            ]
          );
        } catch (err2) {
          if (!isMissingPositionColumnError(err2) && !isLinkedTaskTypeError(err2)) throw err2;
          insert = await pool.query(
            `INSERT INTO notes (user_id, title, content, importance, date, completed, completed_at, status, linked_task_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [
              ownerId.value,
              safeTitle,
              storedContent,
              validImportance,
              date || null,
              safeCompleted,
              safeCompletedAt,
              safeStatus,
              isLinkedTaskTypeError(err2) ? null : normalizedTask.value,
            ]
          );
        }
      }

      const createdNote = insert.rows[0];
      // Always sync shares via note_shares table (works even without participant_ids column)
      if (safeParticipantIds.length > 0 || safeResponsibleId) {
        await syncParticipantShares(pool, createdNote.id, userIdText, [], safeParticipantIds, null, safeResponsibleId);
      }

      // Realtime-Broadcast (Owner + alle Sharee bekommen rt-notes-<id>).
      await broadcastNoteChange(pool, createdNote.id, 'created').catch(() => {});
      await recordNoteActivity(pool, {
        noteId: createdNote.id,
        actorUserId: user.id,
        type: 'created',
        payload: { title: createdNote.title || '' },
      });

      return res.status(201).json({ note: createdNote });
    }

    // GET /api/notes/share-requests
    // Liefert offene Share-Anfragen, die der eingeloggte User akzeptieren
    // oder ablehnen muss. Bestandsshares (status='accepted' / Default)
    // tauchen hier NICHT auf.
    if (
      segments.length === 1
      && segments[0] === 'share-requests'
      && req.method === 'GET'
    ) {
      try {
        const pending = await pool.query(
          `SELECT n.id AS note_id,
                  n.title,
                  n.content,
                  n.updated_at,
                  ns.permission,
                  ns.created_at AS shared_at,
                  u.id AS owner_id,
                  u.name AS owner_name,
                  u.avatar_url AS owner_avatar_url,
                  u.avatar_color AS owner_avatar_color
             FROM note_shares ns
             JOIN notes n ON n.id = ns.note_id
             JOIN users u ON u.id = n.user_id
            WHERE ns.friend_id::text = $1
              AND ns.status = 'pending'
            ORDER BY ns.created_at DESC`,
          [userIdText]
        );
        return res.status(200).json({ requests: pending.rows });
      } catch (err) {
        // Falls die Spalte noch nicht migriert ist, liefere leere Liste.
        if (err && /column .*status/i.test(String(err.message || ''))) {
          return res.status(200).json({ requests: [] });
        }
        throw err;
      }
    }

    // POST /api/notes/share-requests/accept   body: { note_id }
    // POST /api/notes/share-requests/decline  body: { note_id }
    if (
      segments.length === 2
      && segments[0] === 'share-requests'
      && ['accept', 'decline'].includes(segments[1])
      && req.method === 'POST'
    ) {
      const action = segments[1];
      const noteIdRaw = (req.body && req.body.note_id) || null;
      if (!noteIdRaw || !isValidNoteIdString(noteIdRaw)) {
        return res.status(400).json({ error: 'note_id ist erforderlich' });
      }

      if (action === 'accept') {
        const upd = await pool.query(
          `UPDATE note_shares
              SET status = 'accepted'
            WHERE note_id::text = $1
              AND friend_id::text = $2
              AND status = 'pending'
            RETURNING *`,
          [String(noteIdRaw), userIdText]
        );
        if (upd.rows.length === 0) {
          return res.status(404).json({ error: 'Anfrage nicht gefunden' });
        }
        await broadcastNoteChange(pool, noteIdRaw, 'shared').catch(() => {});
        await recordNoteActivity(pool, {
          noteId: noteIdRaw,
          actorUserId: user.id,
          type: 'share_accepted',
          payload: {},
        });
        return res.status(200).json({ share: upd.rows[0] });
      }

      // decline: Share-Zeile entfernen damit weder Owner noch Empfaenger
      // diese Anfrage erneut sieht. Owner kann jederzeit erneut teilen.
      const del = await pool.query(
        `DELETE FROM note_shares
          WHERE note_id::text = $1
            AND friend_id::text = $2
            AND status = 'pending'
          RETURNING *`,
        [String(noteIdRaw), userIdText]
      );
      if (del.rows.length === 0) {
        return res.status(404).json({ error: 'Anfrage nicht gefunden' });
      }
      await broadcastNoteChange(pool, noteIdRaw, 'unshared', {
        extraUserIds: [Number(userIdText)],
      }).catch(() => {});
      await recordNoteActivity(pool, {
        noteId: noteIdRaw,
        actorUserId: user.id,
        type: 'share_declined',
        payload: {},
      });
      return res.status(200).json({ declined: true });
    }

    // GET /api/notes/shared
    if (
      (segments.length === 1 && segments[0] === 'shared' && req.method === 'GET') ||
      (segments.length === 0 && req.method === 'GET' && requestedView === 'shared')
    ) {      const directAccessClause = buildAccessibleNoteClause('n', 'ns', '$1', '$2');
      const inheritedAccessClause = buildInheritedConnectionClause('n', '$1', '$2');
      try {
        const shared = await pool.query(
            `SELECT DISTINCT n.*, CASE
                WHEN n.responsible_user_id = $2 THEN 'edit'
                ELSE COALESCE(ns.permission, 'view')
              END AS permission,
                  u.name AS owner_name,
                  u.avatar_url AS owner_avatar_url,
                  COALESCE(sh.shares, '[]'::jsonb) AS shares,
                  t.title AS linked_task_title
             FROM notes n
             LEFT JOIN note_shares ns ON ns.note_id = n.id AND ns.friend_id::text = $1
             JOIN users u ON u.id = n.user_id
             LEFT JOIN tasks t ON t.id::text = n.linked_task_id::text
             LEFT JOIN LATERAL (
               SELECT jsonb_agg(jsonb_build_object(
                        'user_id', ns2.friend_id::text,
                        'permission', ns2.permission,
                        'name', su.name,
                        'avatar_url', su.avatar_url
                      )) AS shares
                 FROM note_shares ns2
                 LEFT JOIN users su ON su.id::text = ns2.friend_id::text
                WHERE ns2.note_id = n.id
             ) sh ON true
            WHERE n.user_id::text <> $1
              AND (
                ${directAccessClause}
                OR ${inheritedAccessClause}
              )
            ORDER BY n.updated_at DESC, n.created_at DESC`,
          [userIdText, userId]
        );
        // Color-Backfill auch hier (read-only fuer Sharees, kein UPDATE).
        for (const note of shared.rows) {
          if (note && !note.color) {
            const ext = extractColorPrefix(note.content || '');
            if (ext.color) {
              note.color = ext.color;
              note.content = ext.content;
            }
          }
        }
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

    if (!noteId || !isValidNoteIdString(noteId)) {
      return res.status(404).json({ error: 'Route nicht gefunden' });
    }

    const directNoteAccessClause = buildAccessibleNoteClause('n', 'ns', '$2', '$3');
    const inheritedNoteAccessClause = buildInheritedConnectionClause('n', '$2', '$3');
    const noteAccess = await pool.query(
      `SELECT n.*, CASE
                  WHEN n.responsible_user_id = $3 THEN 'edit'
                  ELSE ns.permission
                END AS shared_permission,
                tk.user_id AS linked_task_owner_id,
                EXISTS (
                  SELECT 1
                    FROM group_tasks gtm
                   WHERE gtm.task_id::text = tk.id::text
                     AND (
                       (
                         gtm.subgroup_id IS NULL
                         AND EXISTS (
                           SELECT 1
                             FROM group_members gmm
                            WHERE gmm.group_id = gtm.group_id
                              AND gmm.user_id = $3
                         )
                       )
                       OR (
                         gtm.subgroup_id IS NOT NULL
                         AND EXISTS (
                           SELECT 1
                             FROM group_subgroup_members gsm
                            WHERE gsm.subgroup_id = gtm.subgroup_id
                              AND gsm.user_id = $3
                         )
                       )
                     )
                ) AS linked_task_group_member
         FROM notes n
         LEFT JOIN note_shares ns ON ns.note_id = n.id AND ns.friend_id::text = $2
         LEFT JOIN tasks tk ON tk.id::text = n.linked_task_id::text
        WHERE n.id = $1
          AND (
            ${directNoteAccessClause}
            OR ${inheritedNoteAccessClause}
            OR (
              n.visibility = 'group'
              AND tk.id IS NOT NULL
              AND (
                tk.user_id = $3
                OR EXISTS (
                  SELECT 1
                    FROM group_tasks gtm
                   WHERE gtm.task_id::text = tk.id::text
                     AND (
                       (
                         gtm.subgroup_id IS NULL
                         AND EXISTS (
                           SELECT 1
                             FROM group_members gmm
                            WHERE gmm.group_id = gtm.group_id
                              AND gmm.user_id = $3
                         )
                       )
                       OR (
                         gtm.subgroup_id IS NOT NULL
                         AND EXISTS (
                           SELECT 1
                             FROM group_subgroup_members gsm
                            WHERE gsm.subgroup_id = gtm.subgroup_id
                              AND gsm.user_id = $3
                         )
                       )
                     )
                )
              )
            )
          )
        LIMIT 1`,
      [noteId, userIdText, userId]
    );

    if (noteAccess.rows.length === 0) {
      return res.status(404).json({ error: 'Note nicht gefunden' });
    }

    const note = noteAccess.rows[0];
    const isOwner = String(note.user_id) === userIdText;
    const isResponsible = String(note.responsible_user_id || '') === userIdText;
    let canEditViaGroupTask = note.visibility === 'group' && note.linked_task_group_member === true;
    if (canEditViaGroupTask && note.linked_task_id) {
      canEditViaGroupTask = await canUserManageGroupNotesForTask(pool, note.linked_task_id, userId);
    }
    const canEditNote = isOwner
      || isResponsible
      || note.shared_permission === 'edit'
      || canEditViaGroupTask;
    // Task-Owner darf eine Team-Notiz von seiner Task entfernen (Moderation),
    // aber sonst keine Inhalte editieren.
    const isLinkedTaskOwner = !!note.linked_task_owner_id && String(note.linked_task_owner_id) === String(userId);
    const canModerateDetach = !isOwner && note.visibility === 'group' && isLinkedTaskOwner;

    // PATCH /api/notes/:id
    if (
      (segments.length === 1 && (req.method === 'PATCH' || req.method === 'PUT')) ||
      (isLegacyNoteAction && req.method === 'POST' && ['update', 'edit'].includes(legacyMethod)) ||
      (isRootAction && ['update', 'edit'].includes(rootAction))
    ) {
      // Moderations-Detach: Task-Owner darf eine fremde Team-Notiz von seiner
      // Task entfernen — aber nur das Feld linked_task_id auf null setzen.
      if (!canEditNote) {
        if (canModerateDetach) {
          const body = req.body || {};
          const linkedInput = body.linked_task_id !== undefined ? body.linked_task_id : body.linkedTaskId;
          const isDetachOnly = (linkedInput === null || linkedInput === '' )
            && Object.keys(body).filter((k) => !['linked_task_id', 'linkedTaskId', 'id', 'action', 'updates', 'data'].includes(k)).length === 0;
          if (isDetachOnly) {
            try {
              const detach = await pool.query(
                `UPDATE notes SET linked_task_id = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
                [noteId]
              );
              return res.status(200).json({ note: detach.rows[0] });
            } catch (e) {
              console.error('[notes] moderation-detach failed:', e);
              return res.status(500).json({ error: 'Detach fehlgeschlagen' });
            }
          }
        }
        return res.status(403).json({ error: 'Keine Berechtigung zum Bearbeiten' });
      }
      const rawBody = req.body || {};
      const nestedUpdates =
        rawBody && typeof rawBody.updates === 'object' && rawBody.updates !== null
          ? rawBody.updates
          : rawBody && typeof rawBody.data === 'object' && rawBody.data !== null
            ? rawBody.data
            : null;
      const updates = nestedUpdates ? { ...rawBody, ...nestedUpdates } : rawBody;
      const fields = [];
      const values = [];
      let idx = 1;

      if (updates.title !== undefined) {
        fields.push(`title = $${idx++}`);
        values.push(String(updates.title || '').trim());
      }
      // Color-Spalte: explizit gesetzter color-Wert hat Vorrang. Wenn nur
      // content kommt und einen Legacy '[COLOR:...]' Prefix hat, ziehen
      // wir die Farbe daraus und schreiben sie in die Spalte, der content
      // wird ohne Prefix gespeichert.
      let pendingColorUpdate = null; // null = nicht aendern, sonst Wert (incl null)
      let cleanedUpdateContent = null;
      if (updates.content !== undefined) {
        const ext = extractColorPrefix(updates.content);
        cleanedUpdateContent = ext.content;
        if (updates.color === undefined && ext.color) {
          pendingColorUpdate = ext.color;
        }
      }
      if (updates.color !== undefined) {
        pendingColorUpdate = normalizeNoteColor(updates.color);
      }
      if (updates.content !== undefined) {
        fields.push(`content = $${idx++}`);
        values.push(String(cleanedUpdateContent ?? ''));
      }
      if (pendingColorUpdate !== null || updates.color !== undefined) {
        fields.push(`color = $${idx++}`);
        values.push(pendingColorUpdate);
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
      if (updates.completed !== undefined) {
        fields.push(`completed = $${idx++}`);
        values.push(!!updates.completed);
      }
      const completedAtInput = updates.completed_at !== undefined ? updates.completed_at : updates.completedAt;
      if (completedAtInput !== undefined) {
        fields.push(`completed_at = $${idx++}`);
        values.push(completedAtInput || null);
      }
      if (updates.status !== undefined) {
        const validStatus = ['open', 'done', 'blocked', 'active'].includes(String(updates.status).toLowerCase())
          ? String(updates.status).toLowerCase()
          : 'open';
        fields.push(`status = $${idx++}`);
        values.push(validStatus);
      }
      if (updates.visibility !== undefined) {
        const validVisibility = ['private', 'group'].includes(String(updates.visibility).toLowerCase())
          ? String(updates.visibility).toLowerCase()
          : 'private';
        fields.push(`visibility = $${idx++}`);
        values.push(validVisibility);
      }
      const linkedTaskInput = updates.linked_task_id !== undefined ? updates.linked_task_id : updates.linkedTaskId;
      if (linkedTaskInput !== undefined) {
        const hasInput = !(linkedTaskInput === null || linkedTaskInput === '' || linkedTaskInput === undefined);
        const normalizedTask = await normalizeLinkedTaskForDb(pool, linkedTaskInput, userId);
        if (hasInput && !normalizedTask.allowed) {
          return res.status(403).json({ error: 'Keine Berechtigung fuer verknuepfte Aufgabe' });
        }
        fields.push(`linked_task_id = $${idx++}`);
        values.push(normalizedTask.value);
      }
      const xInput = updates.x !== undefined ? updates.x : updates.posX;
      if (xInput !== undefined) {
        fields.push(`x = $${idx++}`);
        values.push(xInput === null ? null : Number(xInput));
      }
      const yInput = updates.y !== undefined ? updates.y : updates.posY;
      if (yInput !== undefined) {
        fields.push(`y = $${idx++}`);
        values.push(yInput === null ? null : Number(yInput));
      }

      // participant_ids and responsible_user_id – owner-only
      // Read previous participants from note row (may be null if column doesn't exist)
      let prevParticipantIds = Array.isArray(note.participant_ids) ? note.participant_ids : [];
      const prevResponsibleId = note.responsible_user_id || null;
      let nextParticipantIds = prevParticipantIds;
      let participantsChanged = false;
      let participantFieldsToAdd = [];
      let nextResponsibleId = prevResponsibleId;

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
        nextResponsibleId = safeResponsible;
        participantFieldsToAdd.push({ field: `responsible_user_id = $${idx}`, value: safeResponsible });
        idx++;
      } else {
        nextResponsibleId = prevResponsibleId;
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
          rebuiltValues.push(String(cleanedUpdateContent ?? updates.content ?? ''));
        }
        // color-Spalte auch im Fallback uebernehmen (falls Migration durch
        // ist). Fehlt die Spalte, schmeisst PG erneut 42703 - wird durch
        // try/catch eine Ebene tiefer abgefangen.
        if (pendingColorUpdate !== null || updates.color !== undefined) {
          rebuiltFields.push(`color = $${paramIdx++}`);
          rebuiltValues.push(pendingColorUpdate);
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
        if (updates.completed !== undefined) {
          rebuiltFields.push(`completed = $${paramIdx++}`);
          rebuiltValues.push(!!updates.completed);
        }
        if (completedAtInput !== undefined) {
          rebuiltFields.push(`completed_at = $${paramIdx++}`);
          rebuiltValues.push(completedAtInput || null);
        }
        if (updates.status !== undefined) {
          const validStatus = ['open', 'done', 'blocked', 'active'].includes(String(updates.status).toLowerCase())
            ? String(updates.status).toLowerCase()
            : 'open';
          rebuiltFields.push(`status = $${paramIdx++}`);
          rebuiltValues.push(validStatus);
        }
        if (!isLinkedTaskTypeError(err) && linkedTaskInput !== undefined) {
          const hasInput = !(linkedTaskInput === null || linkedTaskInput === '' || linkedTaskInput === undefined);
          const normalizedTask = await normalizeLinkedTaskForDb(pool, linkedTaskInput, userId);
          if (hasInput && !normalizedTask.allowed) {
            return res.status(403).json({ error: 'Keine Berechtigung fuer verknuepfte Aufgabe' });
          }
          rebuiltFields.push(`linked_task_id = $${paramIdx++}`);
          rebuiltValues.push(normalizedTask.value);
        }
        if (!isMissingPositionColumnError(err)) {
          if (xInput !== undefined) {
            rebuiltFields.push(`x = $${paramIdx++}`);
            rebuiltValues.push(xInput === null ? null : Number(xInput));
          }
          if (yInput !== undefined) {
            rebuiltFields.push(`y = $${paramIdx++}`);
            rebuiltValues.push(yInput === null ? null : Number(yInput));
          }
        }
        rebuiltFields.push('updated_at = NOW()');

        if (rebuiltFields.length === 1) {
          // Only updated_at – still sync shares then return existing note
          if (participantsChanged) {
            await syncParticipantShares(pool, noteId, userIdText, prevParticipantIds, nextParticipantIds, prevResponsibleId, nextResponsibleId);
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
      if (participantsChanged || String(prevResponsibleId || '') !== String(nextResponsibleId || '')) {
        await syncParticipantShares(pool, noteId, userIdText, prevParticipantIds, nextParticipantIds, prevResponsibleId, nextResponsibleId);
      }
      // Bei Participant-Wechsel auch die vorher beteiligten User benachrichtigen,
      // damit deren Shared-Liste die Note ggf. wieder ausblendet.
      const updateExtras = participantsChanged && Array.isArray(prevParticipantIds) ? prevParticipantIds : [];
      await broadcastNoteChange(pool, noteId, 'updated', { extraUserIds: updateExtras }).catch(() => {});

      // Activity-Log: konkrete Aenderung (Titel/Inhalt/Status/Verknuepfung)
      const changedFields = diffNoteUpdate(note, finalNote);
      // Versions-Snapshot: nur wenn Title oder Content geaendert wurden.
      // snapshotNoteVersion drosselt selbst (max alle 30s) und backfilled
      // den "alten" Zustand (= note, der Pre-UPDATE-Snapshot).
      if (changedFields.includes('title') || changedFields.includes('content')) {
        snapshotNoteVersion(pool, {
          noteId,
          prevTitle: note.title,
          prevContent: note.content,
          prevColor: note.color || null,
          actorUserId: user.id,
        }).catch(() => null);
      }
      if (changedFields.length > 0 || participantsChanged) {
        let activityType = 'edited';
        if (changedFields.length === 1 && changedFields[0] === 'completed') {
          activityType = finalNote.completed ? 'completed' : 'reopened';
        } else if (changedFields.includes('linked_task_id')) {
          activityType = finalNote.linked_task_id ? 'linked_task' : 'unlinked_task';
        } else if (changedFields.includes('visibility')) {
          activityType = finalNote.visibility === 'group' ? 'made_group' : 'made_private';
        } else if (participantsChanged) {
          activityType = 'participants_changed';
        }
        await recordNoteActivity(pool, {
          noteId,
          actorUserId: user.id,
          type: activityType,
          payload: {
            fields: changedFields,
            title: finalNote.title || '',
          },
          // Autosave-Spam abfangen: kleine Edits innerhalb von 10 Minuten
          // werden zu einem Eintrag zusammengefasst. Hard-State-Wechsel
          // (completed/reopened/linked_task/...) sind eigene Typen und
          // werden dadurch nicht gemergt.
          dedupeWindowMs: activityType === 'edited' ? 10 * 60 * 1000 : 0,
        });
      }

      // Mentions: nur neu hinzugekommene @handles benachrichtigen, damit
      // jeder kleine Edit nicht erneut alle Erwaehnten pingt.
      try {
        if (changedFields.includes('content') || changedFields.includes('title')) {
          const prevHandles = new Set(parseMentionsFromHtml(
            `${note?.title || ''} ${note?.content || ''}`
          ));
          const nextHandlesArr = parseMentionsFromHtml(
            `${finalNote?.title || ''} ${finalNote?.content || ''}`
          );
          const newHandles = nextHandlesArr.filter((h) => !prevHandles.has(h));
          if (newHandles.length > 0) {
            const targets = await resolveMentions(pool, newHandles, user.id, noteId);
            for (const t of targets) {
              if (t.id === user.id) continue;
              await sendPushToUser(
                t.id,
                {
                  title: `${user.name || 'Jemand'} hat dich in einer Notiz erwaehnt`,
                  body: (finalNote?.title || 'Notiz').slice(0, 140),
                  tag: `note-mention-${noteId}`,
                  url: `/notes?open=${encodeURIComponent(noteId)}`,
                },
                'note_mention',
                null,
                null
              ).catch(() => null);
              await recordNoteActivity(pool, {
                noteId,
                actorUserId: user.id,
                type: 'user_mentioned',
                payload: {
                  mentioned_user_id: t.id,
                  mentioned_name: t.name,
                  source: 'note',
                },
              });
            }
          }
        }
      } catch (mentErr) {
        console.warn('[notes] mention dispatch failed:', mentErr?.message || mentErr);
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

      // Vor dem DELETE die betroffenen User einsammeln, damit Realtime-Broadcast
      // sie noch erreichen kann (nach DELETE waeren die Rows weg).
      let deletedRecipients = [];
      try {
        const recRes = await pool.query(
          'SELECT friend_id FROM note_shares WHERE note_id = $1',
          [noteId]
        );
        deletedRecipients = recRes.rows.map((r) => r.friend_id).filter(Boolean);
      } catch { /* ignore */ }
      // Owner selbst auch dazunehmen (wird gleich aus notes geloescht).
      deletedRecipients.push(note.user_id);

      await pool.query('DELETE FROM note_shares WHERE note_id = $1', [noteId]);
      await pool.query('DELETE FROM note_connections WHERE note_id_1 = $1 OR note_id_2 = $1', [noteId]);
      await pool.query('DELETE FROM notes WHERE id = $1 AND user_id::text = $2', [noteId, userIdText]);
      try { await pool.query('DELETE FROM note_activity WHERE note_id = $1', [String(noteId)]); } catch { /* table may not exist yet */ }

      await broadcastNoteChange(pool, noteId, 'deleted', { extraUserIds: deletedRecipients }).catch(() => {});

      return res.status(200).json({ success: true });
    }

    // POST /api/notes/:id/link-task
    if (
      (segments.length === 2 && segments[1] === 'link-task' && req.method === 'POST') ||
      (isLegacyNoteAction && req.method === 'POST' && ['link-task', 'link_task', 'linktask'].includes(legacyMethod)) ||
      (isRootAction && ['link-task', 'link_task', 'linktask'].includes(rootAction))
    ) {
      if (!canEditNote) {
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

      const updatedNote = updated.rows[0];
      const wasLinked = !!note.linked_task_id;
      const isLinked = !!updatedNote.linked_task_id;
      if (wasLinked !== isLinked) {
        await recordNoteActivity(pool, {
          noteId,
          actorUserId: user.id,
          type: isLinked ? 'linked_task' : 'unlinked_task',
          payload: { task_id: updatedNote.linked_task_id || null },
        });
      }
      return res.status(200).json({ note: updatedNote });
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

      // Neue Shares starten als 'pending' damit der Empfaenger zustimmen
      // muss. Wenn eine Zeile bereits existiert (z.B. Permission wird
      // geaendert), bleibt der bestehende Status erhalten und nur die
      // Permission wird upgedatet.
      const shared = await pool.query(
        `INSERT INTO note_shares (note_id, friend_id, permission, status)
         VALUES ($1, $2, $3, 'pending')
         ON CONFLICT (note_id, friend_id)
         DO UPDATE SET permission = EXCLUDED.permission
         RETURNING *`,
        [noteId, targetUserId, validPermission]
      );

      await broadcastNoteChange(pool, noteId, 'shared').catch(() => {});
      await recordNoteActivity(pool, {
        noteId,
        actorUserId: user.id,
        type: 'shared',
        payload: { target_user_id: Number(targetUserId), permission: validPermission },
      });

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

      // Den gerade entfernten Sharee zusaetzlich benachrichtigen — der ist
      // jetzt nicht mehr in note_shares und wuerde sonst kein Event mehr
      // bekommen, also kein Removal aus seiner UI sehen.
      await broadcastNoteChange(pool, noteId, 'unshared', {
        extraUserIds: [targetUserId],
      }).catch(() => {});
      if (removed.rows.length > 0) {
        await recordNoteActivity(pool, {
          noteId,
          actorUserId: user.id,
          type: 'unshared',
          payload: { target_user_id: Number(targetUserId) },
        });
      }

      return res.status(200).json({
        removed: removed.rows.length > 0,
        share: removed.rows[0] || null,
      });
    }

    // GET /api/notes/:id/mentionable — Liste tagbarer User (Friends
    // accepted + bereits akzeptierte Sharees der Notiz). Wird vom Frontend
    // fuer das @-Autocomplete-Dropdown verwendet. Sichtbar fuer alle, die
    // die Note lesen duerfen.
    if (segments.length === 2 && segments[1] === 'mentionable' && req.method === 'GET') {
      try {
        const params = [user.id, String(noteId)];
        const r = await pool.query(
          `SELECT DISTINCT u.id, u.name, u.avatar_color, u.avatar_url
             FROM users u
             WHERE u.id <> $1 AND (
               u.id IN (
                 SELECT CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
                   FROM friends f
                  WHERE (f.user_id = $1 OR f.friend_id = $1)
                    AND f.status = 'accepted'
               )
               OR u.id IN (SELECT user_id FROM notes WHERE id::text = $2)
               OR u.id IN (
                 SELECT friend_id FROM note_shares
                  WHERE note_id::text = $2 AND status = 'accepted'
               )
             )
             ORDER BY u.name ASC
             LIMIT 100`,
          params
        );
        return res.status(200).json({ users: r.rows || [] });
      } catch (err) {
        console.warn('[notes] mentionable fetch failed:', err?.message || err);
        return res.status(200).json({ users: [] });
      }
    }

    // GET /api/notes/:id/activity — chronologischer Verlauf der Notiz
    // (created, edited, shared, unshared, completed, …). Sichtbar fuer
    // alle, die die Note auch lesen duerfen (Owner + akzeptierte Sharees).
    if (segments.length === 2 && segments[1] === 'activity' && req.method === 'GET') {
      await ensureNoteActivityTable(pool);
      try {
        const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 50, 1), 200);
        const rows = await pool.query(
          `SELECT a.id, a.note_id, a.actor_user_id, a.type, a.payload, a.created_at,
                  u.name AS actor_name, u.avatar_url AS actor_avatar_url, u.avatar_color AS actor_avatar_color
             FROM note_activity a
             LEFT JOIN users u ON u.id = a.actor_user_id
            WHERE a.note_id = $1
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT $2`,
          [String(noteId), limit]
        );
        return res.status(200).json({ activity: rows.rows });
      } catch (err) {
        console.warn('[notes] activity fetch failed:', err?.message || err);
        return res.status(200).json({ activity: [] });
      }
    }

    // GET /api/notes/:id/authorship — Per-Block-Authorship aus dem
    // Versionsverlauf. Liefert { authorship: {blockKey: userId},
    // authors: {userId: {id, name, avatar_color, avatar_url}} }.
    // Bewusst on-the-fly, keine DB-Spalte — Versions sind die Quelle
    // der Wahrheit. Nur fuer Leser der Note erreichbar.
    if (segments.length === 2 && segments[1] === 'authorship' && req.method === 'GET') {
      try {
        const versionsRes = await pool.query(
          `SELECT version_no, content, created_by, created_at
             FROM note_versions
            WHERE note_id = $1
            ORDER BY version_no ASC`,
          [String(noteId)]
        ).catch(() => ({ rows: [] }));
        const versionsAsc = versionsRes.rows || [];

        const ownerId = note.user_id ? String(note.user_id) : null;
        const map = buildAuthorshipMap({
          versionsAsc,
          currentContent: note.content || '',
          currentEditorId: ownerId,
          ownerId,
        });

        const ids = Array.from(new Set(Object.values(map))).filter(Boolean);
        const authors = {};
        if (ids.length > 0) {
          try {
            const urows = await pool.query(
              `SELECT id::text AS id, name, avatar_color, avatar_url
                 FROM users
                WHERE id::text = ANY($1::text[])`,
              [ids]
            );
            for (const row of urows.rows) {
              authors[row.id] = {
                id: row.id,
                name: row.name || null,
                avatar_color: row.avatar_color || null,
                avatar_url: row.avatar_url || null,
              };
            }
          } catch (e) {
            console.warn('[notes] authorship users lookup failed:', e?.message || e);
          }
        }

        return res.status(200).json({ authorship: map, authors });
      } catch (err) {
        console.warn('[notes] authorship failed:', err?.message || err);
        return res.status(200).json({ authorship: {}, authors: {} });
      }
    }

    // GET /api/notes/:id/versions — Liste aller Snapshots (Metadaten,
    // ohne content). Nur fuer Leser der Note sichtbar.
    if (segments.length === 2 && segments[1] === 'versions' && req.method === 'GET') {
      try {
        const versions = await listNoteVersions(pool, noteId);
        return res.status(200).json({ versions });
      } catch (err) {
        console.warn('[notes] versions list failed:', err?.message || err);
        return res.status(200).json({ versions: [] });
      }
    }

    // GET /api/notes/:id/versions/:no — eine einzelne Version inkl.
    // content (zum Vergleichen / Preview).
    if (segments.length === 3 && segments[1] === 'versions' && req.method === 'GET') {
      try {
        const version = await getNoteVersion(pool, noteId, segments[2]);
        if (!version) return res.status(404).json({ error: 'Version nicht gefunden' });
        return res.status(200).json({ version });
      } catch (err) {
        console.warn('[notes] version fetch failed:', err?.message || err);
        return res.status(500).json({ error: 'Version konnte nicht geladen werden' });
      }
    }

    // POST /api/notes/:id/versions/:no/restore — gewaehlte Version als
    // aktuellen Stand setzen. Erst ein Snapshot des AKTUELLEN Standes,
    // dann UPDATE auf Title/Content/Color der ausgewaehlten Version.
    if (segments.length === 4 && segments[1] === 'versions' && segments[3] === 'restore' && req.method === 'POST') {
      try {
        const version = await getNoteVersion(pool, noteId, segments[2]);
        if (!version) return res.status(404).json({ error: 'Version nicht gefunden' });

        // Berechtigung pruefen: nur Eigentuemer ODER Edit-Sharee darf restoren.
        const noteRow = await pool.query('SELECT user_id FROM notes WHERE id = $1', [noteId]);
        if (noteRow.rows.length === 0) return res.status(404).json({ error: 'Notiz nicht gefunden' });
        const isOwner = String(noteRow.rows[0].user_id) === userIdText;
        let canEdit = isOwner;
        if (!canEdit) {
          try {
            const shareRow = await pool.query(
              'SELECT permission FROM note_shares WHERE note_id = $1 AND friend_id::text = $2 LIMIT 1',
              [noteId, userIdText]
            );
            canEdit = shareRow.rows.length > 0 && shareRow.rows[0].permission === 'edit';
          } catch { /* note_shares fehlt evtl. */ }
        }
        if (!canEdit) return res.status(403).json({ error: 'Keine Berechtigung' });

        // Snapshot des aktuellen Stands vor dem Restore (Throttle 0s
        // ueberschreiben, damit der jetzige Stand definitiv gesichert wird).
        const currentRow = await pool.query('SELECT title, content, color FROM notes WHERE id = $1', [noteId]);
        const cur = currentRow.rows[0] || {};
        // Direktes Insert mit eigener version_no (ueberspringt 30s-Throttle).
        try {
          const lastRow = await pool.query(
            'SELECT version_no FROM note_versions WHERE note_id = $1 ORDER BY version_no DESC LIMIT 1',
            [noteId]
          );
          const nextNo = lastRow.rows.length > 0 ? Number(lastRow.rows[0].version_no) + 1 : 1;
          await pool.query(
            `INSERT INTO note_versions (note_id, version_no, title, content, color, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [noteId, nextNo, cur.title ?? null, cur.content ?? null, cur.color ?? null, user.id]
          );
        } catch (snapErr) {
          console.warn('[notes] pre-restore snapshot failed:', snapErr?.message || snapErr);
        }

        // UPDATE auf Version (color-Spalte optional, fallback ohne)
        let restored;
        try {
          restored = await pool.query(
            `UPDATE notes SET title = $1, content = $2, color = $3, updated_at = NOW()
              WHERE id = $4 RETURNING *`,
            [version.title ?? null, version.content ?? '', version.color ?? null, noteId]
          );
        } catch (err) {
          if (err.code === '42703') {
            restored = await pool.query(
              `UPDATE notes SET title = $1, content = $2, updated_at = NOW()
                WHERE id = $3 RETURNING *`,
              [version.title ?? null, version.content ?? '', noteId]
            );
          } else {
            throw err;
          }
        }

        await recordNoteActivity(pool, {
          noteId,
          actorUserId: user.id,
          type: 'restored_version',
          payload: { version_no: Number(version.version_no) },
        }).catch(() => null);
        await broadcastNoteChange(pool, noteId, 'updated').catch(() => {});

        return res.status(200).json({ note: restored.rows[0], restored_version: Number(version.version_no) });
      } catch (err) {
        console.error('[notes] version restore failed:', err);
        return res.status(500).json({ error: 'Version konnte nicht wiederhergestellt werden' });
      }
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
      if (!canEditNote) {
        return res.status(403).json({ error: 'Keine Berechtigung zum Bearbeiten' });
      }

      const otherNoteId = req.body?.other_note_id || req.body?.note_id;
      const relationshipType = req.body?.relationship_type || 'related';

      if (!isValidNoteIdString(otherNoteId) || String(otherNoteId) === String(noteId)) {
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
              OR $3 = ANY(COALESCE(notes.participant_ids, '{}'::integer[]))
              OR notes.responsible_user_id = $3
            )
          LIMIT 1`,
        [otherNoteId, userIdText, userId]
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
      if (!canEditNote) {
        return res.status(403).json({ error: 'Keine Berechtigung zum Bearbeiten' });
      }

      const otherNoteId = req.body?.other_note_id || req.body?.note_id;

      if (!isValidNoteIdString(otherNoteId) || String(otherNoteId) === String(noteId)) {
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
              OR $3 = ANY(COALESCE(notes.participant_ids, '{}'::integer[]))
              OR notes.responsible_user_id = $3
            )
          LIMIT 1`,
        [otherNoteId, userIdText, userId]
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
