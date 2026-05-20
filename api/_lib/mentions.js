/**
 * Mention-Helper: parst @handles aus Text/HTML und loest sie zu Usern auf,
 * die der Viewer kennt (Friends accepted) ODER die selber Zugriff auf die
 * Notiz haben. So koennen Nutzer keine fremden User taggen, die mit ihnen
 * nichts zu tun haben.
 *
 * Schreibweise: @vorname  oder  @vorname_nachname  (case-insensitive,
 * Umlaute werden auf Basisbuchstaben gemappt).
 */

// Erlaubt Buchstaben (inkl. Umlaute), Ziffern, _ . -
const MENTION_RE = /(^|[^A-Za-z0-9_])@([A-Za-zÀ-ÖØ-öø-ÿ0-9_.\-]{2,40})/g;

function normalizeHandle(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Diakritika entfernen
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9_.\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function normalizeNameForMatch(displayName) {
  return normalizeHandle(displayName);
}

function firstNameOf(displayName) {
  return normalizeHandle(String(displayName || '').split(/\s+/)[0] || '');
}

/**
 * Liefert ein Set einzigartiger Mention-Handles (lowercase, normalisiert).
 */
function parseMentions(text) {
  if (!text || typeof text !== 'string') return [];
  const out = new Set();
  let m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(text)) !== null) {
    const raw = m[2];
    const norm = normalizeHandle(raw);
    if (norm && norm.length >= 2) out.add(norm);
  }
  return Array.from(out);
}

/**
 * HTML -> Plaintext (sehr defensiv, fuer Mention-Parsing reicht das).
 */
function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMentionsFromHtml(html) {
  return parseMentions(stripHtml(html));
}

/**
 * Loest Mention-Handles zu User-Datensaetzen auf, die der Viewer kennen
 * sollte (Friends accepted ODER bereits Zugriff auf die Notiz).
 *
 * @param {Pool} pool
 * @param {string[]} handles - normalisierte Handles aus parseMentions
 * @param {number} viewerUserId - User der den Text schreibt
 * @param {string|null} noteId - optionale Notiz, deren Teilnehmer auch erlaubt sind
 * @returns {Promise<Array<{id:number, name:string, handle:string}>>}
 */
async function resolveMentions(pool, handles, viewerUserId, noteId = null) {
  if (!Array.isArray(handles) || handles.length === 0) return [];

  // Kandidaten = Friends (accepted) + Note-Teilnehmer (falls noteId)
  const params = [viewerUserId];
  let candidateSql = `
    SELECT DISTINCT u.id, u.name
    FROM users u
    JOIN friends f ON f.status = 'accepted'
      AND ( (f.user_id = $1 AND f.friend_id = u.id)
         OR (f.friend_id = $1 AND f.user_id = u.id) )
    WHERE u.id <> $1
  `;

  if (noteId) {
    params.push(String(noteId));
    candidateSql += `
      UNION
      SELECT DISTINCT u.id, u.name
      FROM users u
      WHERE u.id <> $1 AND (
        u.id IN (SELECT user_id FROM notes WHERE id::text = $2)
        OR u.id IN (
          SELECT friend_id FROM note_shares
          WHERE note_id::text = $2 AND status = 'accepted'
        )
      )
    `;
  }

  let rows = [];
  try {
    const r = await pool.query(candidateSql, params);
    rows = r.rows || [];
  } catch (err) {
    // note_shares existiert evtl. unter anderem Namen -> Fallback ohne Notiz-Teil
    try {
      const r = await pool.query(
        `SELECT DISTINCT u.id, u.name
         FROM users u
         JOIN friends f ON f.status = 'accepted'
           AND ( (f.user_id = $1 AND f.friend_id = u.id)
              OR (f.friend_id = $1 AND f.user_id = u.id) )
         WHERE u.id <> $1`,
        [viewerUserId]
      );
      rows = r.rows || [];
    } catch (err2) {
      console.warn('[mentions] resolveMentions candidates failed:', err2.message);
      return [];
    }
  }

  const wanted = new Set(handles.map((h) => h.toLowerCase()));
  const matched = [];
  const seen = new Set();
  for (const row of rows) {
    const full = normalizeNameForMatch(row.name);
    const first = firstNameOf(row.name);
    let hit = null;
    if (full && wanted.has(full)) hit = full;
    else if (first && wanted.has(first)) hit = first;
    if (hit && !seen.has(row.id)) {
      seen.add(row.id);
      matched.push({ id: row.id, name: row.name, handle: hit });
    }
  }
  return matched;
}

module.exports = {
  parseMentions,
  parseMentionsFromHtml,
  stripHtml,
  normalizeHandle,
  resolveMentions,
};
