// ────────────────────────────────────────────────────────────────────
// Notes Format Layer
// --------------------------------------------------------------------
// Notes werden ab v? als HTML gespeichert (WYSIWYG-Editor mit
// contentEditable). Bestandsnotizen sind aber Markdown — beim Lesen
// erkennen wir das Format und konvertieren bei Bedarf.
//
//  Storage  -> rohes content-Feld in der DB (kann md oder html sein)
//  Display  -> immer sanitized HTML (toDisplayHtml)
//  Save     -> immer HTML (Editor produziert HTML, das gespeichert wird)
//
// Sicherheit: jeder HTML-Pfad geht durch DOMPurify mit strikter
// Tag/Attr-Allowlist. KEIN onclick/onerror/style/srcdoc o.ae.
// ────────────────────────────────────────────────────────────────────
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p', 'br', 'div', 'span',
  'h1', 'h2', 'h3',
  'strong', 'b', 'em', 'i', 'u', 'del', 's', 'strike', 'sub', 'sup',
  'code', 'pre',
  'ul', 'ol', 'li',
  'blockquote',
  'a',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'input',
  'hr',
];

const ALLOWED_ATTR = [
  'href', 'target', 'rel',
  'type', 'checked', 'disabled',
  'class', 'data-check', 'data-cb-idx',
  'colspan', 'rowspan',
];

// Nur <input type="checkbox"> erlauben — alle anderen input-Typen rausfiltern.
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (node.tagName === 'INPUT' && data.attrName === 'type') {
    if (String(data.attrValue).toLowerCase() !== 'checkbox') {
      data.keepAttr = false;
    }
  }
  // Erzwinge sichere Link-Attribute
  if (node.tagName === 'A' && data.attrName === 'href') {
    const v = String(data.attrValue || '').trim().toLowerCase();
    if (v.startsWith('javascript:') || v.startsWith('data:') || v.startsWith('vbscript:')) {
      data.keepAttr = false;
    }
  }
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  // Nicht-Checkbox-Inputs komplett entfernen
  if (node.tagName === 'INPUT' && node.getAttribute('type') !== 'checkbox') {
    node.parentNode && node.parentNode.removeChild(node);
  }
});

export function sanitizeHtml(html) {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  });
}

// Heuristik: Inhalt enthaelt bereits HTML-Tags?
export function looksLikeHtml(text) {
  if (!text) return false;
  return /<\/?(p|div|br|h[1-3]|strong|b|em|i|u|del|s|strike|ul|ol|li|table|tr|td|th|blockquote|span|input|code|pre|a)\b/i.test(text);
}

// HTML-escape fuer Text-Inhalte
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Inline-Markdown -> HTML
function inlineMdToHtml(text) {
  if (!text) return '';
  let s = escapeHtml(text);
  // Reihenfolge: laenger zuerst
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  s = s.replace(/__([^_\n]+)__/g, '<u>$1</u>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/(https?:\/\/[^\s<)"]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

// Markdown -> HTML (block + inline)
export function mdToHtml(md) {
  if (!md) return '';
  const lines = String(md).split('\n');
  const out = [];
  let inUl = false, inOl = false;
  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };
  for (const line of lines) {
    if (!line.trim()) { closeLists(); out.push('<p><br></p>'); continue; }
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) { closeLists(); out.push(`<h1>${inlineMdToHtml(h1[1])}</h1>`); continue; }
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) { closeLists(); out.push(`<h2>${inlineMdToHtml(h2[1])}</h2>`); continue; }
    const cb = line.match(/^\s*-\s\[( |x|X)\]\s?(.*)$/);
    if (cb) {
      closeLists();
      const checked = cb[1].toLowerCase() === 'x';
      out.push(`<div class="ne-check"><input type="checkbox"${checked ? ' checked' : ''}> <span>${inlineMdToHtml(cb[2])}</span></div>`);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!inUl) { closeLists(); out.push('<ul>'); inUl = true; }
      out.push(`<li>${inlineMdToHtml(li[1])}</li>`);
      continue;
    }
    const oli = line.match(/^\s*\d+\.\s+(.*)$/);
    if (oli) {
      if (!inOl) { closeLists(); out.push('<ol>'); inOl = true; }
      out.push(`<li>${inlineMdToHtml(oli[1])}</li>`);
      continue;
    }
    const q = line.match(/^>\s+(.*)$/);
    if (q) { closeLists(); out.push(`<blockquote>${inlineMdToHtml(q[1])}</blockquote>`); continue; }
    closeLists();
    out.push(`<p>${inlineMdToHtml(line)}</p>`);
  }
  closeLists();
  return out.join('');
}

// Display-HTML: erkennt md/html und liefert immer sauberes HTML.
export function toDisplayHtml(content) {
  if (!content) return '';
  const html = looksLikeHtml(content) ? content : mdToHtml(content);
  return sanitizeHtml(html);
}

// Plaintext-Extraktion fuer Suche / Titel-Fallback / AI.
export function htmlToPlain(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = sanitizeHtml(html);
  // Checkboxen als [x] / [ ] mit-extrahieren
  tmp.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.replaceWith(document.createTextNode(el.checked ? '[x] ' : '[ ] '));
  });
  return (tmp.textContent || '').replace(/\u00a0/g, ' ').trim();
}
