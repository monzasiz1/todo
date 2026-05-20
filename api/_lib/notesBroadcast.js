// ─────────────────────────────────────────────────────────────────────────
// Notes Realtime-Broadcast Helper
// ─────────────────────────────────────────────────────────────────────────
// Wird von api/notes.js nach jeder schreibenden Operation aufgerufen.
// Ermittelt alle betroffenen User (Owner + alle aktiven Shares) und sendet
// pro User-ID einen Broadcast an dessen privaten Topic `rt-notes-<userId>`.
//
// Vorteile pro-User-Channel statt globalem Channel:
//   • Skaliert auf viele Nutzer: jeder Client bekommt nur seine eigenen
//     Notes-Events, nicht alle aus dem System.
//   • Broadcast umgeht RLS — wir senden nur Trigger (note_id + op),
//     keine Inhalte. Empfaenger laedt den aktuellen Stand per REST nach.
//
// Aufruf ist fire-and-forget; Fehler werden geloggt aber blockieren den
// API-Response nie.
// ─────────────────────────────────────────────────────────────────────────

const { broadcast, isConfigured } = require('./realtimeBroadcast');

/**
 * Sendet ein note-changed Event an Owner + alle (aktuellen + ueber userIds
 * uebergebenen) Shared-Recipients der Note.
 *
 * @param {import('pg').Pool} pool
 * @param {string|number} noteId
 * @param {'created'|'updated'|'deleted'|'shared'|'unshared'|'connected'|'disconnected'} op
 * @param {object} [extra]
 * @param {Array<string|number>} [extra.extraUserIds] zusaetzliche User-IDs,
 *        die das Event ebenfalls bekommen sollen (z.B. der gerade entfernte
 *        Sharee bei 'unshared' — der ist nach DELETE nicht mehr in der Tabelle).
 */
async function broadcastNoteChange(pool, noteId, op, extra = {}) {
  if (!isConfigured()) return;
  if (!noteId || !op) return;

  const recipients = new Set();
  // Extra IDs (z.B. soeben entfernte Sharee) immer mit aufnehmen.
  if (Array.isArray(extra.extraUserIds)) {
    for (const id of extra.extraUserIds) {
      if (id !== null && id !== undefined && id !== '') recipients.add(String(id));
    }
  }

  try {
    // Owner ermitteln. Bei 'deleted' kann die Note bereits weg sein —
    // dann nur die extraUserIds nutzen (die der Caller mitgeben muss).
    const ownerRes = await pool.query(
      'SELECT user_id FROM notes WHERE id = $1 LIMIT 1',
      [noteId]
    );
    if (ownerRes.rows.length > 0) {
      recipients.add(String(ownerRes.rows[0].user_id));
    }

    // Alle aktiven Shares.
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
    // DB-Fehler hier sind nicht fatal — broadcast wird ggf. uebersprungen.
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
