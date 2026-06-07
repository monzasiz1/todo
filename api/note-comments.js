// Comments fuer Notes (parallele Welt zu api/comments.js fuer Tasks).
// Eigene Tabelle note_comments, eigene Access-Logik (Owner / akzeptierte
// Sharees / Participants / Responsible). Bei jedem POST wird ausserdem
// ein Activity-Eintrag (comment_added) sowie ein Realtime-Broadcast
// abgesetzt, damit das Modal des Owners live aktualisiert.

const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');
const { broadcastNoteChange } = require('./_lib/notesBroadcast');
const { recordNoteActivity } = require('./_lib/noteActivity');
const { parseMentions, resolveMentions } = require('./_lib/mentions');
const { sendPushToUser } = require('./_lib/pushService');

let noteCommentsEnsuredAt = 0;
const NOTE_COMMENTS_TTL_MS = 10 * 60 * 1000;

async function ensureNoteCommentsTable(pool) {
  const now = Date.now();
  if (now - noteCommentsEnsuredAt < NOTE_COMMENTS_TTL_MS) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS note_comments (
        id BIGSERIAL PRIMARY KEY,
        note_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji VARCHAR(10) NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        edited_at TIMESTAMP NULL
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_note_comments_note_created ON note_comments (note_id, created_at ASC)');

    // Unread-Tracking: pro (note, user) der Zeitstempel des letzten "Gesehen".
    // Wird automatisch beim GET ?noteId=... aktualisiert.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS note_comment_reads (
        note_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_read_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (note_id, user_id)
      )
    `);

    // Mentions: persistent gespeichert pro Kommentar+Empfaenger, damit das
    // Unread-Aggregat ohne Re-Parse von @handles arbeiten kann.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS note_comment_mentions (
        comment_id BIGINT NOT NULL REFERENCES note_comments(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (comment_id, user_id)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_note_comment_mentions_user ON note_comment_mentions (user_id)');

    noteCommentsEnsuredAt = now;
  } catch (err) {
    console.warn('[note-comments] ensure failed:', err?.message || err);
  }
}

function isValidNoteIdString(value) {
  if (value === null || value === undefined) return false;
  const str = String(value).trim();
  if (!str) return false;
  if (/^\d+$/.test(str)) return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// Pruefen ob der User die Note lesen darf. Spiegelt buildAccessibleNoteClause
// aus api/notes.js (Owner / accepted share / participant / responsible /
// inherited via connections / group-task-visibility).
async function userCanAccessNote(pool, noteId, userId) {
  const userIdText = String(userId);
  try {
    const res = await pool.query(
      `SELECT 1
         FROM notes n
         LEFT JOIN note_shares ns ON ns.note_id = n.id AND ns.friend_id::text = $2
         LEFT JOIN tasks tk ON tk.id::text = n.linked_task_id::text
        WHERE n.id::text = $1
          AND (
            n.user_id::text = $2
            OR (ns.friend_id::text = $2 AND COALESCE(ns.status, 'accepted') = 'accepted')
            OR $3 = ANY(COALESCE(n.participant_ids, '{}'::integer[]))
            OR n.responsible_user_id = $3
            OR (n.visibility = 'group' AND tk.id IS NOT NULL AND tk.user_id = $3)
          )
        LIMIT 1`,
      [String(noteId), userIdText, userId]
    );
    return res.rows.length > 0;
  } catch (err) {
    // Falls eine Spalte (z. B. participant_ids) noch nicht migriert ist:
    // konservativ erlauben, wenn der User der Owner ist.
    try {
      const fallback = await pool.query(
        `SELECT 1 FROM notes n
          LEFT JOIN note_shares ns ON ns.note_id = n.id AND ns.friend_id::text = $2
         WHERE n.id::text = $1
           AND (
             n.user_id::text = $2
             OR (ns.friend_id::text = $2 AND COALESCE(ns.status, 'accepted') = 'accepted')
           )
         LIMIT 1`,
        [String(noteId), userIdText]
      );
      return fallback.rows.length > 0;
    } catch {
      return false;
    }
  }
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const userId = user.id;
    const pool = getPool();
    await ensureNoteCommentsTable(pool);

    // GET /api/note-comments?action=unread
    // Liefert pro Note Anzahl ungelesener Fremd-Kommentare + Mention-Flag
    // fuer den aktuellen User. Selbst-Kommentare zaehlen nicht.
    if (req.method === 'GET' && String(req.query?.action || '') === 'unread') {
      try {
        const userIdText = String(userId);
        const rows = await pool.query(
          `WITH accessible AS (
             SELECT DISTINCT n.id::text AS note_id
               FROM notes n
               LEFT JOIN note_shares ns ON ns.note_id = n.id AND ns.friend_id::text = $1
               LEFT JOIN tasks tk ON tk.id::text = n.linked_task_id::text
              WHERE n.user_id::text = $1
                 OR (ns.friend_id::text = $1 AND COALESCE(ns.status, 'accepted') = 'accepted')
                 OR $2 = ANY(COALESCE(n.participant_ids, '{}'::integer[]))
                 OR n.responsible_user_id = $2
                 OR (n.visibility = 'group' AND tk.id IS NOT NULL AND tk.user_id = $2)
           )
           SELECT c.note_id,
                  COUNT(*)::int AS unread_count,
                  BOOL_OR(mm.user_id IS NOT NULL) AS has_mention
             FROM note_comments c
             JOIN accessible a ON a.note_id = c.note_id
             LEFT JOIN note_comment_reads r
                    ON r.note_id = c.note_id AND r.user_id = $2
             LEFT JOIN note_comment_mentions mm
                    ON mm.comment_id = c.id AND mm.user_id = $2
            WHERE c.user_id <> $2
              AND c.created_at > COALESCE(r.last_read_at, TIMESTAMP '1970-01-01')
            GROUP BY c.note_id
            HAVING COUNT(*) > 0
            LIMIT 500`,
          [userIdText, userId]
        );
        return res.status(200).json({ unread: rows.rows });
      } catch (err) {
        // Fallback: leere Liste, damit Client niemals broken ist.
        console.warn('[note-comments] unread query failed:', err?.message || err);
        return res.status(200).json({ unread: [] });
      }
    }

    // GET /api/note-comments?noteId=…
    if (req.method === 'GET') {
      const noteId = String(req.query?.noteId || '').trim();
      if (!isValidNoteIdString(noteId)) {
        return res.status(400).json({ error: 'noteId required' });
      }
      if (!(await userCanAccessNote(pool, noteId, userId))) {
        return res.status(404).json({ error: 'Note nicht gefunden' });
      }
      const rows = await pool.query(
        `SELECT c.id, c.note_id, c.user_id, c.emoji, c.text, c.created_at, c.edited_at,
                u.name AS author, u.avatar_color AS author_color, u.avatar_url AS author_avatar_url
           FROM note_comments c
           JOIN users u ON u.id = c.user_id
          WHERE c.note_id = $1
          ORDER BY c.created_at ASC
          LIMIT 500`,
        [String(noteId)]
      );
      // Mark-as-read: User hat die Kommentar-Liste eingesehen.
      // Fire-and-forget, darf GET nicht blockieren.
      pool.query(
        `INSERT INTO note_comment_reads (note_id, user_id, last_read_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (note_id, user_id)
         DO UPDATE SET last_read_at = EXCLUDED.last_read_at`,
        [String(noteId), userId]
      ).catch((err) => console.warn('[note-comments] mark-read failed:', err?.message || err));
      return res.status(200).json({ comments: rows.rows });
    }

    // POST /api/note-comments  { noteId, text, emoji? }
    if (req.method === 'POST') {
      const { noteId, text, emoji } = req.body || {};
      const noteIdStr = String(noteId || '').trim();
      const textStr = String(text || '').trim();
      if (!isValidNoteIdString(noteIdStr)) {
        return res.status(400).json({ error: 'noteId required' });
      }
      if (!textStr) {
        return res.status(400).json({ error: 'text required' });
      }
      if (textStr.length > 4000) {
        return res.status(400).json({ error: 'Kommentar zu lang (max 4000 Zeichen)' });
      }
      if (!(await userCanAccessNote(pool, noteIdStr, userId))) {
        return res.status(404).json({ error: 'Note nicht gefunden' });
      }
      const emojiSafe = emoji ? String(emoji).slice(0, 10) : null;
      const ins = await pool.query(
        `INSERT INTO note_comments (note_id, user_id, emoji, text)
         VALUES ($1, $2, $3, $4)
         RETURNING id, note_id, user_id, emoji, text, created_at, edited_at`,
        [noteIdStr, userId, emojiSafe, textStr]
      );
      const created = ins.rows[0];

      // Author-Info anreichern (dieselbe Form wie GET) damit der Client
      // ohne Refetch rendern kann.
      const u = await pool.query(
        'SELECT name, avatar_color, avatar_url FROM users WHERE id = $1',
        [userId]
      );
      const author = u.rows[0] || {};

      // Realtime + Activity (fire-and-forget, darf POST nicht brechen).
      await broadcastNoteChange(pool, noteIdStr, 'updated').catch(() => {});
      await recordNoteActivity(pool, {
        noteId: noteIdStr,
        actorUserId: userId,
        type: 'comment_added',
        payload: {
          comment_id: created.id,
          preview: textStr.slice(0, 120),
        },
      });

      // Mentions: @handles im Kommentar aufloesen + Beteiligte
      // benachrichtigen (Push + In-App via notification_log) und einen
      // 'user_mentioned' Activity-Eintrag pro Empfaenger schreiben.
      try {
        const handles = parseMentions(textStr);
        if (handles.length > 0) {
          const targets = await resolveMentions(pool, handles, userId, noteIdStr);
          for (const t of targets) {
            if (t.id === userId) continue; // Self-Mention ignorieren
            // Persistieren fuer Unread-Aggregat (Badge mit Mention-Akzent).
            await pool.query(
              `INSERT INTO note_comment_mentions (comment_id, user_id)
               VALUES ($1, $2)
               ON CONFLICT DO NOTHING`,
              [created.id, t.id]
            ).catch(() => null);
            await sendPushToUser(
              t.id,
              {
                title: `${author.name || 'Jemand'} hat dich erwähnt`,
                body: textStr.slice(0, 140),
                tag: `note-mention-${noteIdStr}-${created.id}`,
                url: `/notes?open=${encodeURIComponent(noteIdStr)}`,
              },
              'note_mention',
              null,
              null
            ).catch(() => null);
            await recordNoteActivity(pool, {
              noteId: noteIdStr,
              actorUserId: userId,
              type: 'user_mentioned',
              payload: {
                mentioned_user_id: t.id,
                mentioned_name: t.name,
                source: 'comment',
                comment_id: created.id,
              },
            });
          }
        }
      } catch (mentErr) {
        console.warn('[note-comments] mention dispatch failed:', mentErr?.message || mentErr);
      }

      return res.status(201).json({
        comment: {
          ...created,
          author: author.name || 'Unknown',
          author_color: author.avatar_color || '#007AFF',
          author_avatar_url: author.avatar_url || null,
        },
      });
    }

    // DELETE /api/note-comments?commentId=…   (nur Author oder Note-Owner)
    if (req.method === 'DELETE') {
      const commentId = String(req.query?.commentId || '').trim();
      if (!/^\d+$/.test(commentId)) {
        return res.status(400).json({ error: 'commentId required' });
      }
      const existing = await pool.query(
        `SELECT c.id, c.note_id, c.user_id, n.user_id AS owner_id
           FROM note_comments c
           JOIN notes n ON n.id::text = c.note_id
          WHERE c.id = $1
          LIMIT 1`,
        [commentId]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Kommentar nicht gefunden' });
      }
      const row = existing.rows[0];
      const isAuthor = String(row.user_id) === String(userId);
      const isOwner = String(row.owner_id) === String(userId);
      if (!isAuthor && !isOwner) {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }
      await pool.query('DELETE FROM note_comments WHERE id = $1', [commentId]);
      await broadcastNoteChange(pool, row.note_id, 'updated').catch(() => {});
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[note-comments] error:', err);
    return res.status(500).json({
      error: err?.message || 'Internal server error',
      detail: err?.code || null,
    });
  }
};
