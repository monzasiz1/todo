import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Maximize2, Minimize2, Trash2, Archive, Save, Check,
  Calendar as CalendarIcon, Link2, Link2Off, Search, Lock, Users, Eye,
  UserPlus, Pencil,
  Bold, Italic, Underline, Strikethrough, Code, Heading1, Heading2,
  List, ListOrdered, CheckSquare, Quote, Table,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { useTaskStore } from '../store/taskStore';
import { useAuthStore } from '../store/authStore';
import { useFriendsStore } from '../store/friendsStore';
import { useNotesStore } from '../store/notesStore';
import { toDisplayHtml, sanitizeHtml } from '../lib/noteFormat';
import '../styles/note-editor-modal.css';

const NOTE_COLORS = [
  { name: 'Gelb', bg: '#FFFE94', border: '#E6D35C' },
  { name: 'Blau', bg: '#B3D9F7', border: '#5DADE2' },
  { name: 'Grün', bg: '#A9F5A9', border: '#58D68D' },
  { name: 'Rosa', bg: '#FFB3BA', border: '#F1948A' },
  { name: 'Orange', bg: '#FFCC99', border: '#F39C12' },
  { name: 'Lila', bg: '#E8DAEF', border: '#BB8FCE' },
];

function parseColor(content) {
  const m = (content || '').match(/^\[COLOR:([^\]]+)\]\s*/);
  if (m) {
    const color = NOTE_COLORS.find((c) => c.name === m[1]);
    return { color: color || NOTE_COLORS[0], rest: (content || '').slice(m[0].length) };
  }
  return { color: NOTE_COLORS[0], rest: content || '' };
}

function buildContent(rest, color) {
  return color && color.name !== 'Gelb' ? `[COLOR:${color.name}] ${rest}` : rest;
}

// Live-Markdown-Vorschau (nutzt simple Block-/Inline-Regeln).
function renderPreview(text) {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    if (!line.trim()) return <br key={`br-${idx}`} />;
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) return <h1 key={idx}>{h1[1]}</h1>;
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) return <h2 key={idx}>{h2[1]}</h2>;
    const cb = line.match(/^(\s*)-\s\[( |x|X)\]\s?(.*)$/);
    if (cb) {
      const checked = cb[2].toLowerCase() === 'x';
      return (
        <div key={idx} className={`nem-md-check ${checked ? 'checked' : ''}`}>
          <span className="nem-md-checkbox" aria-hidden>{checked ? <Check size={12} strokeWidth={3} /> : null}</span>
          <span>{renderInline(cb[3])}</span>
        </div>
      );
    }
    const li = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (li) return <div key={idx} className="nem-md-li"><span className="nem-md-bullet">•</span><span>{renderInline(li[2])}</span></div>;
    return <p key={idx}>{renderInline(line)}</p>;
  });
}

function renderInline(text) {
  if (!text) return null;
  // Reihenfolge ist wichtig: laengere Token (**, ~~, __) zuerst,
  // damit *italic* nicht **bold** vorgreift.
  const re = /(\*\*[^*]+\*\*|~~[^~]+~~|__[^_]+__|\*[^*\n]+\*|`[^`\n]+`|https?:\/\/[^\s)]+)/g;
  const parts = [];
  let last = 0; let m; let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) parts.push(<strong key={i}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('~~')) parts.push(<del key={i}>{tok.slice(2, -2)}</del>);
    else if (tok.startsWith('__')) parts.push(<u key={i}>{tok.slice(2, -2)}</u>);
    else if (tok.startsWith('`')) parts.push(<code key={i}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('*')) parts.push(<em key={i}>{tok.slice(1, -1)}</em>);
    else parts.push(<a key={i} href={tok} target="_blank" rel="noopener noreferrer">{tok}</a>);
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ────────────────────────────────────────────────────────────────────
// Formatierungs-Toolbar (Rich-Text-Style)
// Buttons fuegen Markdown-Tokens ein. Horizontal scrollbar auf
// schmalen Screens, kompakte Icon-Buttons fuer Desktop + Mobile.
// ────────────────────────────────────────────────────────────────────
const FORMAT_GROUPS = [
  [
    { type: 'h1',         icon: Heading1,      label: 'Ueberschrift 1' },
    { type: 'h2',         icon: Heading2,      label: 'Ueberschrift 2' },
  ],
  [
    { type: 'bold',       icon: Bold,          label: 'Fett (Strg+B)' },
    { type: 'italic',     icon: Italic,        label: 'Kursiv (Strg+I)' },
    { type: 'underline',  icon: Underline,     label: 'Unterstrichen' },
    { type: 'strike',     icon: Strikethrough, label: 'Durchgestrichen' },
    { type: 'code',       icon: Code,          label: 'Inline-Code' },
  ],
  [
    { type: 'list',       icon: List,          label: 'Aufzaehlung' },
    { type: 'ordered',    icon: ListOrdered,   label: 'Nummerierte Liste' },
    { type: 'check',      icon: CheckSquare,   label: 'Checkliste' },
    { type: 'quote',      icon: Quote,         label: 'Zitat' },
    { type: 'table',      icon: Table,         label: 'Tabelle einfuegen' },
  ],
];

function FormatToolbar({ onAction }) {
  return (
    <div className="nem-toolbar" role="toolbar" aria-label="Textformatierung">
      {FORMAT_GROUPS.map((group, gIdx) => (
        <div key={gIdx} className="nem-toolbar-group">
          {group.map(({ type, icon: Icon, label }) => (
            <button
              key={type}
              type="button"
              className="nem-toolbar-btn"
              onMouseDown={(e) => e.preventDefault() /* Fokus in Textarea behalten */}
              onClick={() => onAction(type)}
              title={label}
              aria-label={label}
            >
              <Icon size={16} strokeWidth={2} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function NoteEditorModal({ note, onClose, onUpdate, onDelete, onComplete, readOnly: readOnlyProp = false }) {
  const initialParsed = useMemo(() => parseColor(note?.content || ''), [note?.id]);
  const [title, setTitle] = useState(note?.title || '');
  // Content wird ab sofort als HTML gespeichert (WYSIWYG-Editor). Bestands-
  // Notizen sind Markdown -> on-load nach HTML konvertieren.
  const [content, setContent] = useState(() => toDisplayHtml(initialParsed.rest));
  const [color, setColor] = useState(initialParsed.color);
  const [importance, setImportance] = useState(note?.importance || 'medium');
  // Owner-/Readonly-Logik: Notes von anderen Usern (z. B. an gemeinsame
  // Tasks angeheftete Team-Notes) werden read-only dargestellt.
  const currentUser = useAuthStore((s) => s.user);
  const currentUserId = currentUser?.id ? String(currentUser.id) : '';
  const isOwnerOfNote = !note?.user_id || (currentUserId && String(note.user_id) === currentUserId);
  // Notes, die mit edit-Permission geteilt wurden, duerfen auch von Nicht-
  // Eigentuemern bearbeitet werden. Backend liefert note.permission='edit'
  // im /api/notes/shared-Pfad bzw. note.shared_permission='edit' wenn der
  // Detail-Endpoint genutzt wird.
  const hasEditPermission = !isOwnerOfNote && (
    note?.permission === 'edit' || note?.shared_permission === 'edit'
  );
  // Edit-Permission haebelt einen extern gesetzten readOnly-Prop aus
  // (z.B. wenn TaskDetailModal die Note als "foreign" markiert, der User
  // sie aber via note_shares mit edit bearbeiten darf).
  const readOnly = (readOnlyProp && !hasEditPermission) || (!isOwnerOfNote && !hasEditPermission);
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [taskQuery, setTaskQuery] = useState('');

  // Verknuepfter Termin / Aufgabe (bidirektional via notes.linked_task_id)
  const tasks = useTaskStore((s) => s.tasks);
  const linkedTask = useMemo(() => {
    if (!note?.linked_task_id || !Array.isArray(tasks)) return null;
    return tasks.find((t) => t && String(t.id) === String(note.linked_task_id)) || null;
  }, [tasks, note?.linked_task_id]);
  // Sichtbarkeit: 'private' (Default) oder 'group' — Toggle nur fuer Owner
  // einer Notiz, die an eine Gruppentask haengt.
  const visibility = note?.visibility === 'group' ? 'group' : 'private';
  const canShareWithGroup = isOwnerOfNote && !!linkedTask && !!linkedTask.group_id;
  const handleToggleVisibility = async () => {
    if (!canShareWithGroup || readOnly) return;
    const next = visibility === 'group' ? 'private' : 'group';
    try { await onUpdate?.(note.id, { visibility: next }); }
    catch (err) { console.error('[NoteEditorModal] toggle visibility failed:', err); }
  };

  // --------------------------------------------------------------------
  // Mit Freunden teilen (note_shares mit permission 'view'|'edit')
  // --------------------------------------------------------------------
  const friends = useFriendsStore((s) => s.friends);
  const fetchFriends = useFriendsStore((s) => s.fetchFriends);
  const fetchNotesStore = useNotesStore((s) => s.fetchNotes);
  const shareNoteApi = useNotesStore((s) => s.shareNoteWithFriend);
  const unshareNoteApi = useNotesStore((s) => s.unshareNoteForFriend);
  const [friendPickerOpen, setFriendPickerOpen] = useState(false);
  const [friendQuery, setFriendQuery] = useState('');

  // Friends-Liste laden, falls Store leer (z. B. Note direkt geoeffnet).
  useEffect(() => {
    if (!Array.isArray(friends) || friends.length === 0) {
      try { fetchFriends?.(); } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Permissions-Map aus note.shares (Backend, sauberste Quelle).
  // Fallback: participant_ids (alle 'view') fuer Notes von alten Versionen
  // oder bevor das shares-Aggregat im Backend gelandet ist.
  const sharesByUserId = useMemo(() => {
    const map = new Map();
    if (Array.isArray(note?.shares)) {
      note.shares.forEach((s) => {
        if (!s || s.user_id == null) return;
        map.set(String(s.user_id), s.permission || 'view');
      });
    } else if (Array.isArray(note?.participant_ids)) {
      note.participant_ids.forEach((id) => { if (id != null) map.set(String(id), 'view'); });
    }
    return map;
  }, [note?.shares, note?.participant_ids]);

  // Vollständige Empfängerliste (Name+Avatar) direkt aus note.shares
  // — funktioniert auch für Empfänger, die nicht in der eigenen Friends-
  // Liste stehen (z. B. Gruppen-Note vom fremden Owner).
  const recipientList = useMemo(() => {
    if (!Array.isArray(note?.shares)) return [];
    return note.shares
      .filter((s) => s && s.user_id != null)
      .map((s) => ({
        user_id: String(s.user_id),
        name: s.name || 'Unbekannt',
        avatar_url: s.avatar_url || null,
        permission: s.permission || 'view',
      }));
  }, [note?.shares]);

  // Friend-Objekt -> Ziel-User-ID (echte User-ID, nicht friendship-PK).
  const getFriendUserId = (friend) => {
    if (!friend) return null;
    return friend.friend_user_id || friend.user_id || friend.friend_id || friend.id || null;
  };
  const getFriendName = (friend) => friend?.friend_name || friend?.name || friend?.email || 'Freund';
  const getFriendInitial = (friend) => (getFriendName(friend)[0] || '?').toUpperCase();
  const getFriendAvatar = (friend) => friend?.friend_avatar_url || friend?.avatar_url || null;

  const sharedFriends = useMemo(() => {
    if (!Array.isArray(friends)) return [];
    return friends.filter((f) => {
      const uid = getFriendUserId(f);
      return uid && sharesByUserId.has(String(uid));
    });
  }, [friends, sharesByUserId]);

  const availableFriends = useMemo(() => {
    if (!Array.isArray(friends)) return [];
    const q = friendQuery.trim().toLowerCase();
    return friends
      .filter((f) => {
        const uid = getFriendUserId(f);
        if (!uid) return false;
        if (sharesByUserId.has(String(uid))) return false;
        if (!q) return true;
        return getFriendName(f).toLowerCase().includes(q) || (f.email || '').toLowerCase().includes(q);
      })
      .slice(0, 30);
  }, [friends, friendQuery, sharesByUserId]);

  const canShareWithFriends = isOwnerOfNote && !readOnly && !!note?.id;

  // Direkter Aufruf von shareNote/unshareNote (statt participant_ids zu
  // patchen). So bleibt die Permission ('view' oder 'edit') erhalten und
  // wird nicht vom Backend-Resync ueberschrieben.
  const refreshNotes = () => { try { fetchNotesStore?.({ force: true }); } catch {} };
  const handleAddFriend = async (friend) => {
    if (!canShareWithFriends) return;
    const uid = getFriendUserId(friend);
    if (!uid) return;
    setFriendPickerOpen(false);
    setFriendQuery('');
    try {
      await shareNoteApi?.(note.id, uid, 'view');
      refreshNotes();
    } catch (err) { console.error('[NoteEditorModal] add friend share failed:', err); }
  };
  const handleRemoveFriend = async (friend) => {
    if (!canShareWithFriends) return;
    const uid = getFriendUserId(friend);
    if (!uid) return;
    try {
      await unshareNoteApi?.(note.id, uid);
      refreshNotes();
    } catch (err) { console.error('[NoteEditorModal] remove friend share failed:', err); }
  };
  const handleTogglePermission = async (friend, e) => {
    e?.stopPropagation?.();
    if (!canShareWithFriends) return;
    const uid = getFriendUserId(friend);
    if (!uid) return;
    const current = sharesByUserId.get(String(uid)) || 'view';
    const next = current === 'edit' ? 'view' : 'edit';
    try {
      await shareNoteApi?.(note.id, uid, next);
      refreshNotes();
    } catch (err) { console.error('[NoteEditorModal] toggle permission failed:', err); }
  };
  const availableTasks = useMemo(() => {
    if (!Array.isArray(tasks)) return [];
    const q = taskQuery.trim().toLowerCase();
    return tasks
      .filter((t) => t && !t.completed && String(t.id) !== String(note?.linked_task_id || ''))
      .filter((t) => !q || (t.title || '').toLowerCase().includes(q))
      .slice(0, 30);
  }, [tasks, taskQuery, note?.linked_task_id]);

  const handleLinkTask = async (taskId) => {
    try {
      await onUpdate?.(note.id, { linked_task_id: taskId });
      setTaskPickerOpen(false);
      setTaskQuery('');
    } catch (err) {
      console.error('[NoteEditorModal] link task failed:', err);
    }
  };
  const handleUnlinkTask = async () => {
    try { await onUpdate?.(note.id, { linked_task_id: null }); } catch (err) { console.error(err); }
  };
  const handleOpenLinkedTask = () => {
    if (!linkedTask) return;
    flushSave();
    // Globaler Trigger: NotesPage (oder andere Mounter) oeffnen TaskDetailModal.
    window.dispatchEvent(new CustomEvent('beequ:open-task', { detail: { task: linkedTask } }));
    onClose?.();
  };
  const editorRef = useRef(null);
  const saveTimerRef = useRef(null);
  const initialKeyRef = useRef(`${note?.id}|${note?.title || ''}|${note?.content || ''}|${note?.importance || ''}`);

  // ESC schliesst
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        flushSave();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  // Init / Re-Init des contentEditable Editors, wenn sich die Notiz
  // wechselt. innerHTML wird nur EINMAL pro Notiz gesetzt, damit React
  // nicht bei jedem Keystroke das DOM ueberschreibt (Caret-Reset).
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = toDisplayHtml(initialParsed.rest);
    el.innerHTML = html;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  // Live-Sync: wenn die Notiz fremd aktualisiert wird (z.B. der Eigentuemer
  // editiert eine geteilte Notiz und das Polling zieht neue Daten), den
  // Editor-Inhalt aktualisieren \u2014 aber NUR wenn der User gerade nicht
  // selbst in dem Editor tippt (sonst Caret-Reset / Datenverlust).
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (document.activeElement === el) return; // User tippt gerade
    const parsed = parseColor(note?.content || '');
    const nextHtml = toDisplayHtml(parsed.rest);
    if (nextHtml === el.innerHTML) return; // nichts geaendert
    el.innerHTML = nextHtml;
    setContent(nextHtml);
    if (parsed.color) setColor(parsed.color);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.content]);

  // Debounced Auto-Save
  const scheduleSave = useCallback((nextTitle, nextContent, nextColor, nextImportance) => {
    if (!note?.id) return;
    if (readOnly) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveState('saving');
    saveTimerRef.current = setTimeout(async () => {
      try {
        await onUpdate?.(note.id, {
          title: (nextTitle || '').trim(),
          content: buildContent(nextContent, nextColor),
          importance: nextImportance,
        });
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1200);
      } catch (err) {
        console.error('[NoteEditorModal] auto-save failed:', err);
        setSaveState('idle');
      }
    }, 700);
  }, [note?.id, onUpdate]);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (readOnly) return;
    const key = `${note?.id}|${title}|${buildContent(content, color)}|${importance}`;
    if (key === initialKeyRef.current) return;
    onUpdate?.(note.id, {
      title: (title || '').trim(),
      content: buildContent(content, color),
      importance,
    }).catch((err) => console.error('[NoteEditorModal] flush save failed:', err));
  }, [note?.id, title, content, color, importance, onUpdate]);

  useEffect(() => {
    scheduleSave(title, content, color, importance);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, color, importance]);

  // Beim Unmount sicher speichern
  useEffect(() => () => { flushSave(); }, [flushSave]);

  // Body-Klasse setzen: BottomNav ausblenden + Body-Scroll sperren ohne
  // Layout-Shift (Vermeidet, dass sich der notes-board-header verschiebt).
  // Zusaetzlich iOS-Scroll-Lock via position:fixed + scrollY-Restore, damit
  // beim Schliessen die NotesPage nicht durch eine offene Tastatur verrutscht.
  useEffect(() => {
    const scrollY = window.scrollY || window.pageYOffset || 0;
    document.body.classList.add('note-editor-open');
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    return () => {
      document.body.classList.remove('note-editor-open');
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      // Aktives Element blurren -> Mobile-Tastatur schliesst zuverlaessig.
      try { document.activeElement?.blur?.(); } catch {}
      // ScrollY wiederherstellen (instant, sonst springt es sichtbar).
      window.scrollTo(0, scrollY);
    };
  }, []);

  if (!note) return null;

  const handleClose = () => {
    flushSave();
    onClose?.();
  };

  // Caret an das Ende des Editors stellen (in eine neue leere
  // <p>-Zeile, falls der letzte Block nicht editierbar/leer ist).
  // Wird benutzt, wenn der User unter eine Tabelle / Liste / Quote klickt
  // — sonst bleibt der Cursor in der Tabelle gefangen.
  const moveCaretToEnd = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    // Sicherstellen, dass am Ende ein bearbeitbares <p> steht.
    const last = el.lastElementChild;
    const isBlockNeedingTail = last && /^(TABLE|UL|OL|BLOCKQUOTE|PRE|HR|H1|H2|H3)$/.test(last.tagName)
      || (last && last.tagName === 'DIV' && last.classList.contains('ne-check'));
    if (!last || isBlockNeedingTail) {
      const p = document.createElement('p');
      p.appendChild(document.createElement('br'));
      el.appendChild(p);
    }
    const range = document.createRange();
    const target = el.lastElementChild || el;
    range.selectNodeContents(target);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  }, []);

  // Tab im Editor: 2-Space-Einrueckung statt Fokuswechsel.
  const onEditorKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  };

  // Editor-Input -> State syncen (debounced Save kickt automatisch).
  const onEditorInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    // Keine Sanitization waehrend des Tippens (sonst Caret-Reset).
    // Wird vor jedem Speichern in scheduleSave/flushSave gesaeubert.
    setContent(el.innerHTML);
  }, []);

  // Klick im Editor: Checkbox-Toggle ODER Klick in den Leerraum
  // unter dem letzten Block -> Caret ans Ende (damit man unter
  // Tabellen/Listen weiterschreiben kann).
  const onEditorClick = useCallback((e) => {
    const t = e.target;
    if (t && t.tagName === 'INPUT' && t.getAttribute('type') === 'checkbox') {
      if (readOnly) { e.preventDefault(); return; }
      // Browser togglet die .checked Property; wir spiegeln aufs Attribut,
      // damit innerHTML-Serialisierung den Zustand persistiert.
      requestAnimationFrame(() => {
        if (t.checked) t.setAttribute('checked', '');
        else t.removeAttribute('checked');
        onEditorInput();
      });
      return;
    }
    if (readOnly) return;
    // Klick direkt auf den Editor-Container (also Leerraum unter dem
    // letzten Block) -> Caret ans Ende + ggf. neue Zeile anlegen.
    if (t === editorRef.current) {
      moveCaretToEnd();
      onEditorInput();
    }
  }, [readOnly, onEditorInput, moveCaretToEnd]);

  // ──────────────────────────────────────────────────────────────────
  // Formatierungs-Toolbar (WYSIWYG)
  // Inline-Formate via document.execCommand. Tabellen/Checklisten als
  // HTML-Fragmente direkt eingefuegt. Kein Platzhaltertext, wenn der
  // User bereits Text markiert hat (wrappt nur die Auswahl).
  // ──────────────────────────────────────────────────────────────────
  const applyFormat = useCallback((type) => {
    if (readOnly) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    const hasSelection = sel && sel.rangeCount > 0 && !sel.isCollapsed;
    const exec = (cmd, val = null) => document.execCommand(cmd, false, val);
    const escHtml = (s) => String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    switch (type) {
      case 'bold':       exec('bold'); break;
      case 'italic':     exec('italic'); break;
      case 'underline':  exec('underline'); break;
      case 'strike':     exec('strikeThrough'); break;
      case 'code': {
        if (hasSelection) {
          const txt = sel.toString();
          exec('insertHTML', `<code>${escHtml(txt)}</code>`);
        } else {
          // Leere Code-Span, Cursor landet drin (ZWS damit Browser den Tag haelt).
          exec('insertHTML', '<code>\u200b</code>');
        }
        break;
      }
      case 'h1':         exec('formatBlock', 'H1'); break;
      case 'h2':         exec('formatBlock', 'H2'); break;
      case 'quote':      exec('formatBlock', 'BLOCKQUOTE'); break;
      case 'list':       exec('insertUnorderedList'); break;
      case 'ordered':    exec('insertOrderedList'); break;
      case 'check': {
        const inner = hasSelection ? escHtml(sel.toString()) : 'Aufgabe';
        exec('insertHTML', `<div class="ne-check"><input type="checkbox"> <span>${inner}</span></div><p><br></p>`);
        break;
      }
      case 'table': {
        // Echte HTML-Tabelle (3 Spalten, Header + 2 Datenzeilen) direkt eingefuegt.
        const tableHtml = (
          '<table class="ne-table"><tbody>' +
          '<tr><th>Spalte 1</th><th>Spalte 2</th><th>Spalte 3</th></tr>' +
          '<tr><td>Wert</td><td>Wert</td><td>Wert</td></tr>' +
          '<tr><td>Wert</td><td>Wert</td><td>Wert</td></tr>' +
          '</tbody></table><p><br></p>'
        );
        exec('insertHTML', tableHtml);
        // Sicherstellen, dass darunter eine bearbeitbare Zeile bleibt
        // und der Cursor dort landet (insertHTML laesst den Cursor sonst
        // gerne im letzten <td> stehen).
        requestAnimationFrame(() => moveCaretToEnd());
        break;
      }
      default: break;
    }
    onEditorInput();
  }, [readOnly, onEditorInput, moveCaretToEnd]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="nem-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      >
        <motion.div
          className="nem-sheet"
          style={{ '--nem-accent': color.border }}
          initial={{ y: 24, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 24, opacity: 0, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          role="dialog"
          aria-modal="true"
          aria-label="Notiz bearbeiten"
        >
          <div className="nem-color-bar" aria-hidden="true" />
          <div className="nem-header">
            <input
              type="text"
              className="nem-title"
              value={title}
              maxLength={120}
              placeholder="Titel…"
              onChange={(e) => setTitle(e.target.value)}
              readOnly={readOnly}
            />
            <div className="nem-header-actions">
              {readOnly && (
                <span className="nem-readonly-badge" title="Nur lesen">
                  <Eye size={13} /> <span>Nur lesen</span>
                </span>
              )}
              {!readOnly && visibility === 'group' && (
                <span className="nem-readonly-badge nem-readonly-badge--shared" title="Mit Gruppe geteilt">
                  <Users size={13} /> <span>Geteilt</span>
                </span>
              )}
              <span className={`nem-save-state nem-save-${saveState}`} aria-live="polite">
                {saveState === 'saving' && 'Speichere…'}
                {saveState === 'saved' && 'Gespeichert'}
              </span>
              <button
                type="button"
                className="nem-icon-btn"
                onClick={handleClose}
                title="Schliessen (Esc)"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="nem-body">
            {!readOnly && (
              <FormatToolbar onAction={applyFormat} />
            )}
            <div
              ref={editorRef}
              className="nem-editor"
              contentEditable={!readOnly}
              suppressContentEditableWarning
              spellCheck
              data-placeholder="Schreib los…"
              onInput={onEditorInput}
              onKeyDown={onEditorKeyDown}
              onClick={onEditorClick}
            />
          </div>

          {/* Verknuepfter Termin / Aufgabe (bidirektional). */}
          <div className="nem-link-row">
            {linkedTask ? (
              <div className="nem-link-chip is-linked" role="group" aria-label="Verknuepfter Termin">
                <button
                  type="button"
                  className="nem-link-chip-main"
                  onClick={handleOpenLinkedTask}
                  title="Zum Termin springen"
                >
                  <CalendarIcon size={14} />
                  <span className="nem-link-chip-title">{linkedTask.title || 'Termin'}</span>
                  {linkedTask.date && (
                    <span className="nem-link-chip-meta">
                      {(() => { try { return format(parseISO(linkedTask.date), 'd. MMM', { locale: de }); } catch { return ''; } })()}
                      {linkedTask.time ? ` · ${linkedTask.time}` : ''}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="nem-link-chip-remove"
                  onClick={handleUnlinkTask}
                  title="Verknuepfung entfernen"
                  aria-label="Verknuepfung entfernen"
                  disabled={readOnly}
                  style={readOnly ? { display: 'none' } : undefined}
                >
                  <Link2Off size={13} />
                </button>
              </div>
            ) : (
              !readOnly && (
                <button
                  type="button"
                  className="nem-link-add"
                  onClick={() => setTaskPickerOpen((v) => !v)}
                  aria-expanded={taskPickerOpen}
                >
                  <Link2 size={14} /> <span>Termin anheften</span>
                </button>
              )
            )}
            {canShareWithGroup && (
              <button
                type="button"
                className={`nem-visibility-toggle${visibility === 'group' ? ' is-shared' : ''}`}
                onClick={handleToggleVisibility}
                title={visibility === 'group' ? 'Sichtbar fuer alle Gruppenmitglieder — klicken zum Privatisieren' : 'Nur fuer dich sichtbar — klicken zum Teilen mit Gruppe'}
                aria-pressed={visibility === 'group'}
              >
                {visibility === 'group' ? <Users size={13} /> : <Lock size={13} />}
                <span>{visibility === 'group' ? 'Mit Gruppe geteilt' : 'Privat'}</span>
              </button>
            )}
            {!isOwnerOfNote && (note?.owner_name || recipientList.length > 0) && (
              <div className="nem-share-friends nem-share-friends--readonly">
                <div className="nem-share-friends-row">
                  {note?.owner_name && (
                    <span
                      className="nem-share-chip is-owner"
                      title={`Geteilt von ${note.owner_name}`}
                    >
                      {note.owner_avatar_url ? (
                        <img src={note.owner_avatar_url} alt="" className="nem-share-chip-avatar" />
                      ) : (
                        <span className="nem-share-chip-avatar nem-share-chip-avatar--initial">
                          {(note.owner_name[0] || '?').toUpperCase()}
                        </span>
                      )}
                      <span className="nem-share-chip-name">Von {note.owner_name}</span>
                    </span>
                  )}
                  {recipientList.map((r) => {
                    const isMe = r.user_id === currentUserId;
                    const isEdit = r.permission === 'edit';
                    return (
                      <span
                        key={r.user_id}
                        className={`nem-share-chip${isEdit ? ' is-edit' : ''}${isMe ? ' is-me' : ''}`}
                        title={`${isMe ? 'Du' : r.name} — ${isEdit ? 'darf bearbeiten' : 'kann nur lesen'}`}
                      >
                        {r.avatar_url ? (
                          <img src={r.avatar_url} alt="" className="nem-share-chip-avatar" />
                        ) : (
                          <span className="nem-share-chip-avatar nem-share-chip-avatar--initial">
                            {(r.name[0] || '?').toUpperCase()}
                          </span>
                        )}
                        <span className="nem-share-chip-name">{isMe ? 'Du' : r.name}</span>
                        {isEdit ? <Pencil size={12} /> : <Eye size={12} />}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            {canShareWithFriends && (
              <div className="nem-share-friends">
                <div className="nem-share-friends-row">
                  {sharedFriends.map((f) => {
                    const uid = getFriendUserId(f);
                    const perm = sharesByUserId.get(String(uid)) || 'view';
                    const isEdit = perm === 'edit';
                    return (
                      <span
                        key={uid}
                        className={`nem-share-chip is-active${isEdit ? ' is-edit' : ''}`}
                        title={`${getFriendName(f)} — ${isEdit ? 'darf bearbeiten' : 'kann nur lesen'}`}
                      >
                        {getFriendAvatar(f) ? (
                          <img src={getFriendAvatar(f)} alt="" className="nem-share-chip-avatar" />
                        ) : (
                          <span className="nem-share-chip-avatar nem-share-chip-avatar--initial">{getFriendInitial(f)}</span>
                        )}
                        <span className="nem-share-chip-name">{getFriendName(f)}</span>
                        <button
                          type="button"
                          className={`nem-share-chip-perm${isEdit ? ' is-edit' : ''}`}
                          onClick={(e) => handleTogglePermission(f, e)}
                          title={isEdit ? 'Klicken: Nur-Lese-Recht' : 'Klicken: Schreibrecht geben'}
                          aria-label={isEdit ? 'Schreibrecht entziehen' : 'Schreibrecht geben'}
                        >
                          {isEdit ? <Pencil size={13} /> : <Eye size={13} />}
                        </button>
                        <button
                          type="button"
                          className="nem-share-chip-remove"
                          onClick={() => handleRemoveFriend(f)}
                          title="Freigabe entfernen"
                          aria-label="Freigabe entfernen"
                        >
                          <X size={13} />
                        </button>
                      </span>
                    );
                  })}
                  <button
                    type="button"
                    className="nem-share-add"
                    onClick={() => setFriendPickerOpen((v) => !v)}
                    aria-expanded={friendPickerOpen}
                    title="Mit Freund teilen"
                  >
                    <UserPlus size={13} />
                    <span>{sharedFriends.length === 0 ? 'Mit Freund teilen' : 'Weiteren teilen'}</span>
                  </button>
                </div>
                {friendPickerOpen && (
                  <div className="nem-link-picker" role="listbox">
                    <div className="nem-link-picker-search">
                      <Search size={13} />
                      <input
                        type="text"
                        placeholder="Freund suchen…"
                        value={friendQuery}
                        onChange={(e) => setFriendQuery(e.target.value)}
                      />
                    </div>
                    <div className="nem-link-picker-list">
                      {availableFriends.length === 0 ? (
                        <div className="nem-link-picker-empty">
                          {Array.isArray(friends) && friends.length === 0
                            ? 'Du hast noch keine Freunde hinzugefuegt.'
                            : 'Keine passenden Freunde.'}
                        </div>
                      ) : availableFriends.map((f) => (
                        <button
                          key={getFriendUserId(f)}
                          type="button"
                          className="nem-link-picker-item"
                          onClick={() => handleAddFriend(f)}
                          role="option"
                        >
                          {getFriendAvatar(f) ? (
                            <img src={getFriendAvatar(f)} alt="" className="nem-share-chip-avatar" />
                          ) : (
                            <span className="nem-share-chip-avatar nem-share-chip-avatar--initial">{getFriendInitial(f)}</span>
                          )}
                          <span className="nem-link-picker-title">{getFriendName(f)}</span>
                          {f.email && <span className="nem-link-picker-meta">{f.email}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {taskPickerOpen && !linkedTask && (
              <div className="nem-link-picker" role="listbox">
                <div className="nem-link-picker-search">
                  <Search size={13} />
                  <input
                    type="text"
                    placeholder="Termin suchen…"
                    value={taskQuery}
                    onChange={(e) => setTaskQuery(e.target.value)}
                  />
                </div>
                <div className="nem-link-picker-list">
                  {availableTasks.length === 0 ? (
                    <div className="nem-link-picker-empty">Keine passenden Termine.</div>
                  ) : availableTasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="nem-link-picker-item"
                      onClick={() => handleLinkTask(t.id)}
                      role="option"
                    >
                      <CalendarIcon size={12} />
                      <span className="nem-link-picker-title">{t.title}</span>
                      {t.date && (
                        <span className="nem-link-picker-meta">
                          {(() => { try { return format(parseISO(t.date), 'd. MMM', { locale: de }); } catch { return ''; } })()}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="nem-footer">
            {!readOnly && (
              <>
                <div className="nem-color-row" role="radiogroup" aria-label="Farbe">
              {NOTE_COLORS.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  role="radio"
                  aria-checked={c.name === color.name}
                  className={`nem-color-dot${c.name === color.name ? ' is-active' : ''}`}
                  style={{ backgroundColor: c.bg, borderColor: c.border }}
                  onClick={() => setColor(c)}
                  title={c.name}
                />
              ))}
            </div>

            <div className="nem-importance-row">
              {['low', 'medium', 'high'].map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`nem-importance-btn${importance === level ? ' is-active' : ''}`}
                  onClick={() => setImportance(level)}
                  title={`Wichtigkeit: ${level}`}
                >
                  {level === 'low' ? 'Niedrig' : level === 'medium' ? 'Mittel' : 'Hoch'}
                </button>
              ))}
            </div>

            <div className="nem-footer-actions">
              <button
                type="button"
                className="nem-action-btn"
                onClick={() => {
                  flushSave();
                  onComplete?.(note.id);
                  onClose?.();
                }}
                title="Erledigt -> Archiv"
              >
                <Archive size={14} /> <span>Archivieren</span>
              </button>
              <button
                type="button"
                className="nem-action-btn danger"
                onClick={() => {
                  if (!window.confirm('Notiz wirklich loeschen?')) return;
                  onDelete?.(note.id);
                  onClose?.();
                }}
                title="Loeschen"
              >
                <Trash2 size={14} /> <span>Loeschen</span>
              </button>
              <button
                type="button"
                className="nem-action-btn primary"
                onClick={handleClose}
                title="Schliessen (auto-gespeichert)"
              >
                <Save size={14} /> <span>Fertig</span>
              </button>
            </div>
              </>
            )}
            {readOnly && (
              <div className="nem-footer-actions">
                <button
                  type="button"
                  className="nem-action-btn primary"
                  onClick={handleClose}
                  title="Schliessen"
                >
                  <X size={14} /> <span>Schliessen</span>
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
