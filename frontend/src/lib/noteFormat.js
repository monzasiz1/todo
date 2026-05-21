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

// HTML -> Markdown. Minimaler Konverter ohne Fremdbibliothek.
// Deckt ab: h1-h6, p, br, strong/b, em/i, u, code, pre, blockquote,
// hr, a, img, ul/ol/li (auch verschachtelt), input[type=checkbox] in li.
// Unbekannte Elemente werden auf ihren Text-Inhalt reduziert.
export function htmlToMarkdown(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = sanitizeHtml(html);

  const escapeMd = (s) => String(s)
    .replace(/\\/g, '\\\\')
    .replace(/([*_`])/g, '\\$1');

  const walk = (node, ctx) => {
    if (node.nodeType === 3) {
      // Text: Newlines innerhalb von Plain-Text auf Space reduzieren.
      return (node.nodeValue || '').replace(/\s+/g, ' ');
    }
    if (node.nodeType !== 1) return '';
    const tag = node.tagName?.toLowerCase();
    const inner = () => Array.from(node.childNodes).map((c) => walk(c, ctx)).join('');

    switch (tag) {
      case 'br': return '\n';
      case 'hr': return '\n\n---\n\n';
      case 'h1': return `\n# ${inner().trim()}\n\n`;
      case 'h2': return `\n## ${inner().trim()}\n\n`;
      case 'h3': return `\n### ${inner().trim()}\n\n`;
      case 'h4': return `\n#### ${inner().trim()}\n\n`;
      case 'h5': return `\n##### ${inner().trim()}\n\n`;
      case 'h6': return `\n###### ${inner().trim()}\n\n`;
      case 'p':  return `${inner().trim()}\n\n`;
      case 'strong':
      case 'b':  return `**${inner().trim()}**`;
      case 'em':
      case 'i':  return `*${inner().trim()}*`;
      case 'u':  return `<u>${inner().trim()}</u>`;
      case 'code': {
        // Inline-Code in einem <pre> wird in pre behandelt
        if (node.parentElement?.tagName?.toLowerCase() === 'pre') return inner();
        return '`' + (node.textContent || '') + '`';
      }
      case 'pre': {
        const text = node.textContent || '';
        return `\n\`\`\`\n${text.replace(/\n$/, '')}\n\`\`\`\n\n`;
      }
      case 'blockquote': {
        const t = inner().trim().split('\n').map((l) => `> ${l}`).join('\n');
        return `\n${t}\n\n`;
      }
      case 'a': {
        const href = node.getAttribute('href') || '';
        const label = inner().trim() || href;
        return href ? `[${label}](${href})` : label;
      }
      case 'img': {
        const src = node.getAttribute('src') || '';
        const alt = node.getAttribute('alt') || '';
        return src ? `![${alt}](${src})` : '';
      }
      case 'ul':
      case 'ol': {
        const items = Array.from(node.children).filter((c) => c.tagName?.toLowerCase() === 'li');
        const lines = items.map((li, i) => {
          const prefix = tag === 'ol' ? `${i + 1}.` : '-';
          // Checkbox-Liste (Task-List)
          const cb = li.querySelector(':scope > input[type="checkbox"]');
          let checkPrefix = '';
          if (cb) {
            checkPrefix = cb.checked ? '[x] ' : '[ ] ';
            cb.remove();
          }
          // Innere Liste separat behandeln (Einrueckung)
          const nested = Array.from(li.children)
            .filter((c) => ['ul', 'ol'].includes(c.tagName?.toLowerCase()));
          nested.forEach((n) => n.remove());
          const text = Array.from(li.childNodes).map((c) => walk(c, ctx)).join('').trim();
          const nestedMd = nested.map((n) => walk(n, { ...ctx, indent: (ctx.indent || 0) + 1 })).join('');
          const indent = '  '.repeat(ctx.indent || 0);
          const nestedIndented = nestedMd
            ? '\n' + nestedMd.split('\n').filter(Boolean).map((l) => `  ${l}`).join('\n')
            : '';
          return `${indent}${prefix} ${checkPrefix}${text}${nestedIndented}`;
        });
        return `\n${lines.join('\n')}\n\n`;
      }
      case 'div':
      case 'span':
      case 'section':
      case 'article':
        return inner();
      case 'input': {
        if (node.getAttribute('type') === 'checkbox') {
          return node.checked ? '[x] ' : '[ ] ';
        }
        return '';
      }
      default:
        return inner();
    }
  };

  const md = Array.from(tmp.childNodes)
    .map((n) => walk(n, { indent: 0 }))
    .join('');
  // Whitespace normalisieren: max 2 Leerzeilen, Trim
  return md.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim() + '\n';
}

// Sicherer Dateiname fuer Downloads (latin + Bindestriche, max 80).
export function safeFileName(name, fallback = 'notiz') {
  const s = String(name || '').trim()
    .replace(/[\u00e4]/g, 'ae').replace(/[\u00f6]/g, 'oe').replace(/[\u00fc]/g, 'ue')
    .replace(/[\u00c4]/g, 'Ae').replace(/[\u00d6]/g, 'Oe').replace(/[\u00dc]/g, 'Ue')
    .replace(/[\u00df]/g, 'ss')
    .replace(/[^a-zA-Z0-9._ -]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 80);
  return s || fallback;
}
