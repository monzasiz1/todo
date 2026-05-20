// Versions-Historie fuer Notes. Snapshot-Pattern: bei jedem nennenswerten
// Save (Title oder Content geaendert) wird der "alte" Zustand als Version
// abgelegt, sofern der letzte Snapshot mehr als SNAPSHOT_MIN_INTERVAL_MS
// her ist (Default 30s). Insgesamt werden pro Note maximal MAX_VERSIONS
// Versionen aufbewahrt; aelteste werden im Hintergrund entfernt.
//
// Tabelle wird per ensure-on-write (TTL-cached) erstellt. Failt nie
// hart - Versions sind eine Komfort-Funktion, kein blocker.

const SNAPSHOT_MIN_INTERVAL_MS = 90 * 1000;
const MAX_VERSIONS = 50;
const ENSURE_TTL_MS = 10 * 60 * 1000;

// Whitespace-normalisierter Vergleich, damit reine Formatter-Aenderungen
// (z.B. zusaetzliche Leerzeichen im HTML) keinen neuen Snapshot anlegen.
function normalizeForCompare(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

let ensuredAt = 0;

async function ensureNoteVersionsTable(pool) {
  const now = Date.now();
  if (now - ensuredAt < ENSURE_TTL_MS) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS note_versions (
        id BIGSERIAL PRIMARY KEY,
        note_id TEXT NOT NULL,
        version_no INTEGER NOT NULL,
        title TEXT NULL,
        content TEXT NULL,
        color VARCHAR(16) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_note_versions_note_created ON note_versions (note_id, created_at DESC)');
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_note_versions_note_no ON note_versions (note_id, version_no)');
    ensuredAt = now;
  } catch (err) {
    console.warn('[notes] ensure note_versions failed:', err?.message || err);
  }
}

// Snapshot des aktuellen "prev"-Zustands schreiben. Es wird nur gespeichert,
// wenn der letzte Snapshot mehr als SNAPSHOT_MIN_INTERVAL_MS zurueckliegt
// (oder gar kein Snapshot existiert). Liefert die neue version_no oder null.
async function snapshotNoteVersion(pool, { noteId, prevTitle, prevContent, prevColor, actorUserId }) {
  if (!noteId) return null;
  try {
    await ensureNoteVersionsTable(pool);
    const noteIdStr = String(noteId);

    // letzten Snapshot pruefen (Throttle + naechste version_no bestimmen)
    const last = await pool.query(
      'SELECT version_no, title, content, color, created_at FROM note_versions WHERE note_id = $1 ORDER BY version_no DESC LIMIT 1',
      [noteIdStr]
    );
    if (last.rows.length > 0) {
      const ageMs = Date.now() - new Date(last.rows[0].created_at).getTime();
      if (ageMs < SNAPSHOT_MIN_INTERVAL_MS) return null;
      // De-Dup: identischer Inhalt (whitespace-normalisiert) -> kein neuer Snapshot.
      const prevNormTitle = normalizeForCompare(last.rows[0].title);
      const prevNormContent = normalizeForCompare(last.rows[0].content);
      const prevNormColor = normalizeForCompare(last.rows[0].color);
      const nextNormTitle = normalizeForCompare(prevTitle);
      const nextNormContent = normalizeForCompare(prevContent);
      const nextNormColor = normalizeForCompare(prevColor);
      if (
        prevNormTitle === nextNormTitle
        && prevNormContent === nextNormContent
        && prevNormColor === nextNormColor
      ) {
        return null;
      }
    }
    const nextVersionNo = last.rows.length > 0 ? (Number(last.rows[0].version_no) || 0) + 1 : 1;

    await pool.query(
      `INSERT INTO note_versions (note_id, version_no, title, content, color, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [noteIdStr, nextVersionNo, prevTitle ?? null, prevContent ?? null, prevColor ?? null, actorUserId ?? null]
    );

    // Cap auf MAX_VERSIONS (aelteste loeschen)
    pool.query(
      `DELETE FROM note_versions
        WHERE note_id = $1
          AND id NOT IN (
            SELECT id FROM note_versions WHERE note_id = $1 ORDER BY version_no DESC LIMIT $2
          )`,
      [noteIdStr, MAX_VERSIONS]
    ).catch(() => null);

    return nextVersionNo;
  } catch (err) {
    console.warn('[notes] snapshotNoteVersion failed:', err?.message || err);
    return null;
  }
}

async function listNoteVersions(pool, noteId, limit = MAX_VERSIONS) {
  await ensureNoteVersionsTable(pool);
  const noteIdStr = String(noteId);
  const cap = Math.min(Math.max(parseInt(limit, 10) || MAX_VERSIONS, 1), MAX_VERSIONS);
  const rows = await pool.query(
    `SELECT v.id, v.version_no, v.title, v.color, v.created_at, v.created_by,
            u.name AS author_name, u.avatar_url AS author_avatar_url, u.avatar_color AS author_avatar_color,
            CHAR_LENGTH(COALESCE(v.content, '')) AS content_length
       FROM note_versions v
       LEFT JOIN users u ON u.id = v.created_by
      WHERE v.note_id = $1
      ORDER BY v.version_no DESC
      LIMIT $2`,
    [noteIdStr, cap]
  );
  return rows.rows;
}

async function getNoteVersion(pool, noteId, versionNo) {
  await ensureNoteVersionsTable(pool);
  const rows = await pool.query(
    `SELECT id, note_id, version_no, title, content, color, created_at, created_by
       FROM note_versions
      WHERE note_id = $1 AND version_no = $2
      LIMIT 1`,
    [String(noteId), Number(versionNo)]
  );
  return rows.rows[0] || null;
}

module.exports = {
  SNAPSHOT_MIN_INTERVAL_MS,
  MAX_VERSIONS,
  ensureNoteVersionsTable,
  snapshotNoteVersion,
  listNoteVersions,
  getNoteVersion,
};
