// Block-Authorship: Plain-Text-Bloecke aus dem Editor + stabile Keys.
//
// Spiegelt EXAKT die Logik aus api/_lib/noteAuthorship.js — beide Seiten
// muessen identische Keys produzieren, sonst matchen die Author-Bars
// neben dem Editor nicht.

// Stabile, kollisionsarme djb2-Variante + Laengen-Suffix.
export function blockKey(text) {
  const norm = String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!norm) return '';
  let h = 5381;
  for (let i = 0; i < norm.length; i++) {
    h = (((h << 5) + h) ^ norm.charCodeAt(i)) >>> 0;
  }
  return h.toString(36) + '_' + norm.length;
}

// Liefert eine flache Liste der Block-Elemente im contentEditable.
// "Block" = jeder direkte Kind-Container des Editors + jedes <li> in
// Listen. Reihenfolge entspricht der Dokument-Reihenfolge — wichtig
// fuer die Vertikal-Positionierung der Author-Bars.
export function walkEditorBlocks(rootEl) {
  if (!rootEl) return [];
  const out = [];
  const children = Array.from(rootEl.children || []);
  for (const child of children) {
    const tag = (child.tagName || '').toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(child.querySelectorAll(':scope > li'));
      for (const li of items) {
        const text = (li.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) out.push({ el: li, text, key: blockKey(text) });
      }
    } else {
      const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) out.push({ el: child, text, key: blockKey(text) });
    }
  }
  return out;
}
