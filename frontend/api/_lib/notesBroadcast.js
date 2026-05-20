// ─────────────────────────────────────────────────────────────────────────
// Notes Realtime-Broadcast Helper (Frontend-Mirror)
// ─────────────────────────────────────────────────────────────────────────
// Spiegel der Datei unter /api/_lib/notesBroadcast.js. Vercel bundlet die
// Functions im /frontend-Bereich aus diesem Verzeichnis — beide Kopien
// muessen identisch bleiben.
// ─────────────────────────────────────────────────────────────────────────

const { broadcast, isConfigured } = require('./realtimeBroadcast');

async function broadcastNoteChange(pool, noteId, op, extra = {}) {
  if (!isConfigured()) return;
  if (!noteId || !op) return;

  const recipients = new Set();
  if (Array.isArray(extra.extraUserIds)) {
    for (const id of extra.extraUserIds) {
      if (id !== null && id !== undefined && id !== '') recipients.add(String(id));
    }
  }

  try {
    const ownerRes = await pool.query(
      'SELECT user_id FROM notes WHERE id = $1 LIMIT 1',
      [noteId]
    );
    if (ownerRes.rows.length > 0) {
      recipients.add(String(ownerRes.rows[0].user_id));
    }

    const sharesRes = await pool.query(
      'SELECT friend_id FROM note_shares WHERE note_id = $1',
      [noteId]
    );
    for (const row of sharesRes.rows) {
      if (row.friend_id !== null && row.friend_id !== undefined) {
        recipients.add(String(row.friend_id));
      }
    }
  } catch (err) {
    console.error('[notesBroadcast] recipient lookup failed:', err.message);
    if (recipients.size === 0) return;
  }

  const payload = {
    note_id: String(noteId),
    op,
    ts: Date.now(),
  };

  await Promise.all(
    Array.from(recipients).map((userId) =>
      broadcast(`rt-notes-${userId}`, 'note_changed', payload).catch((err) => {
        console.error(`[notesBroadcast] failed for user ${userId}:`, err.message);
      })
    )
  );
}

module.exports = { broadcastNoteChange };
