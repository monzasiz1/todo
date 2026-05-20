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

async function recordNoteActivity(pool, { noteId, actorUserId, type, payload }) {
  if (!noteId || !type) return;
  try {
    await ensureNoteActivityTable(pool);
    const actorId = Number(actorUserId);
    await pool.query(
      `INSERT INTO note_activity (note_id, actor_user_id, type, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        String(noteId),
        Number.isInteger(actorId) && actorId > 0 ? actorId : null,
        String(type).slice(0, 40),
        JSON.stringify(payload || {}),
      ]
    );
  } catch (err) {
    console.warn('[notes] recordNoteActivity failed:', err?.message || err);
  }
}

module.exports = { ensureNoteActivityTable, recordNoteActivity };
