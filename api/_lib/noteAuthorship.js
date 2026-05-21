// Per-Block-Authorship-Berechnung fuer Notes.
//
// Idee: Statt einer separaten DB-Spalte rekonstruieren wir Authorship
// on-the-fly aus dem bereits vorhandenen Versionsverlauf (note_versions).
// Fuer jeden Block (Absatz / Listenpunkt / Heading) im AKTUELLEN
// Notiz-Content suchen wir die aelteste Version, in der dieser Block
// erstmals auftaucht — der created_by dieser Version ist der Autor.
//
// Bewusst KEIN Diff-Algorithmus mit Operational-Transform: die Aufloesung
// auf Block-Ebene reicht voellig, ist deterministisch und kommt ohne
// Schema-Migration aus.
//
// Wichtig: Block-Key-Algorithmus MUSS exakt zur Frontend-Implementation
// in frontend/src/lib/noteAuthorship.js passen, sonst matchen die Bars
// nicht.

'use strict';

const BLOCK_CLOSE_RE = /<\/(p|h[1-6]|li|blockquote|pre|div)>/gi;
const BR_RE = /<br\s*\/?>(?!\s*<\/)/gi;
const TAG_RE = /<[^>]+>/g;

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// HTML → Array von Plain-Text-Bloecken in Dokument-Reihenfolge.
// Leere Bloecke (whitespace-only) werden gefiltert.
function extractBlocks(html) {
  if (!html) return [];
  // Block-Tags durch Newlines ersetzen, dann Tags strippen.
  const withBreaks = String(html)
    .replace(BLOCK_CLOSE_RE, '\n')
    .replace(BR_RE, '\n')
    .replace(TAG_RE, '');
  const decoded = decodeEntities(withBreaks);
  return decoded
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

// Stabile, schnelle Block-ID. NICHT kryptografisch — reicht fuer
// Block-Dedupe innerhalb einer Notiz. djb2-Hash + Laenge minimiert
// Kollisionen.
function blockKey(text) {
  const norm = String(text || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!norm) return '';
  let h = 5381;
  for (let i = 0; i < norm.length; i++) {
    h = (((h << 5) + h) ^ norm.charCodeAt(i)) >>> 0;
  }
  return h.toString(36) + '_' + norm.length;
}

// Hauptalgorithmus: gegeben sortierte Versionen (ASC nach version_no) +
// aktueller Notiz-State, liefere {key → userId} fuer alle Bloecke des
// aktuellen States. Blocks ohne Version-Treffer (z.B. ganz frisch
// eingetippt seit letztem Snapshot) fallen auf currentEditorId zurueck.
function buildAuthorshipMap({ versionsAsc, currentContent, currentEditorId, ownerId }) {
  const currentBlocks = extractBlocks(currentContent);
  const authorByKey = {};
  // Walk versionen oldest→newest: erstes Auftreten eines Blocks gewinnt.
  for (const v of versionsAsc || []) {
    const blocks = extractBlocks(v.content || '');
    const creator = v.created_by ? String(v.created_by) : (ownerId ? String(ownerId) : null);
    if (!creator) continue;
    for (const text of blocks) {
      const key = blockKey(text);
      if (!key) continue;
      if (!(key in authorByKey)) authorByKey[key] = creator;
    }
  }
  // Aktuelle Bloecke filtern + Fallbacks setzen.
  const result = {};
  const seen = new Set();
  const fallback = currentEditorId ? String(currentEditorId) : (ownerId ? String(ownerId) : null);
  for (const text of currentBlocks) {
    const key = blockKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result[key] = authorByKey[key] || fallback;
  }
  return result;
}

module.exports = {
  extractBlocks,
  blockKey,
  buildAuthorshipMap,
};
