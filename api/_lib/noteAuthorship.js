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
// aktuellen States.
//
// WICHTIG zur Semantik von note_versions:
//   - snapshotNoteVersion speichert den Stand VOR dem Save als Version.
//   - version.created_by ist der User, der den Save AUSGELOEST hat
//     (also den Stand danach geschrieben hat) — NICHT der Autor des
//     im Snapshot enthaltenen content.
//
// Daraus folgt:
//   - versions[0].content wurde vom Notiz-Owner geschrieben.
//   - versions[i].content (i>0) wurde von versions[i-1].created_by
//     geschrieben.
//   - Der AKTUELLE Notiz-Content wurde vom letzten versions[*].created_by
//     geschrieben (oder vom Owner, falls noch keine Version existiert).
//
// Ein Block wird dem Autor der AELTESTEN "Stage" zugeordnet, in der er
// erstmals auftaucht.
function buildAuthorshipMap({ versionsAsc, currentContent, currentEditorId, ownerId }) {
  const ownerStr = ownerId ? String(ownerId) : null;
  // Stages aufbauen: jede Stage = {content, author} wobei author der
  // tatsaechliche Schreiber dieses content-Stands ist.
  const stages = [];
  let prevSaver = ownerStr;
  for (const v of versionsAsc || []) {
    stages.push({ content: v.content || '', author: prevSaver });
    if (v.created_by) prevSaver = String(v.created_by);
  }
  // Aktueller Stand: vom letzten Speicherer (oder Owner, falls noch
  // keine Version existiert). currentEditorId ist nur Notfall-Fallback.
  const currentAuthor = prevSaver
    || (currentEditorId ? String(currentEditorId) : null)
    || ownerStr;
  stages.push({ content: currentContent || '', author: currentAuthor });

  // Walk stages oldest→newest: erstes Auftreten eines Blocks gewinnt.
  const authorByKey = {};
  for (const stage of stages) {
    if (!stage.author) continue;
    const blocks = extractBlocks(stage.content);
    for (const text of blocks) {
      const key = blockKey(text);
      if (!key) continue;
      if (!(key in authorByKey)) authorByKey[key] = stage.author;
    }
  }

  // Aktuelle Bloecke filtern + Fallback (letzter Speicherer) setzen.
  const currentBlocks = extractBlocks(currentContent);
  const result = {};
  const seen = new Set();
  const fallback = currentAuthor;
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
