// Shared Activity-Log fuer Notes. Wird von api/notes.js und api/note-comments.js
// genutzt (und kann fuer weitere notes-bezogene Endpoints wiederverwendet
// werden). Auto-Migration, TTL-cached, failt nie den Haupt-Request.

let noteActivityEnsuredAt = 0;
const NOTE_ACTIVITY_TTL_MS = 10 * 60 * 1000;

async function ensureNoteActivityTable(pool) {
  const now = Date.now();
  if (now - noteActivityEnsuredAt < NOTE_ACTIVITY_TTL_MS) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS note_activity (
        id BIGSERIAL PRIMARY KEY,
        note_id TEXT NOT NULL,
        actor_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        type VARCHAR(40) NOT NULL,
        payload JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_note_activity_note_created ON note_activity (note_id, created_at DESC)');
    noteActivityEnsuredAt = now;
  } catch (err) {
    console.warn('[notes] ensure note_activity failed:', err?.message || err);
  }
}

async function recordNoteActivity(pool, { noteId, actorUserId, type, payload, dedupeWindowMs }) {
  if (!noteId || !type) return;
  try {
    await ensureNoteActivityTable(pool);
    const actorId = Number(actorUserId);
    const actorParam = Number.isInteger(actorId) && actorId > 0 ? actorId : null;
    const typeStr = String(type).slice(0, 40);
    const payloadStr = JSON.stringify(payload || {});

    // De-Duplikation gegen Autosave-Spam: wenn innerhalb von
    // dedupeWindowMs der gleiche (note,actor,type) Eintrag bereits
    // existiert, aktualisieren wir nur created_at + payload statt
    // einen neuen Eintrag anzulegen. Verhindert "10x bearbeitet"
    // bei jedem Tastendruck und haelt das Activity-Log sauber.
    if (dedupeWindowMs && Number.isFinite(Number(dedupeWindowMs)) && Number(dedupeWindowMs) > 0) {
      const windowSec = Math.max(1, Math.floor(Number(dedupeWindowMs) / 1000));
      const sql = actorParam === null
        ? `SELECT id FROM note_activity
             WHERE note_id = $1 AND actor_user_id IS NULL AND type = $2
               AND created_at > NOW() - ($3 || ' seconds')::interval
             ORDER BY created_at DESC LIMIT 1`
        : `SELECT id FROM note_activity
             WHERE note_id = $1 AND actor_user_id = $4 AND type = $2
               AND created_at > NOW() - ($3 || ' seconds')::interval
             ORDER BY created_at DESC LIMIT 1`;
      const params = actorParam === null
        ? [String(noteId), typeStr, String(windowSec)]
        : [String(noteId), typeStr, String(windowSec), actorParam];
      const { rows } = await pool.query(sql, params);
      if (rows.length > 0) {
        await pool.query(
          'UPDATE note_activity SET created_at = NOW(), payload = $1::jsonb WHERE id = $2',
          [payloadStr, rows[0].id]
        );
        return;
      }
    }

    await pool.query(
      `INSERT INTO note_activity (note_id, actor_user_id, type, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [String(noteId), actorParam, typeStr, payloadStr]
    );
  } catch (err) {
    console.warn('[notes] recordNoteActivity failed:', err?.message || err);
  }
}

module.exports = { ensureNoteActivityTable, recordNoteActivity };
