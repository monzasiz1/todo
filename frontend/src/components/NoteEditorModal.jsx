import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Maximize2, Minimize2, Trash2, Archive, Save, Check,
  Calendar as CalendarIcon, Link2, Link2Off, Search, Lock, Users, Eye,
  UserPlus, Pencil,
  Bold, Italic, Underline, Strikethrough, Code, Heading1, Heading2,
  List, ListOrdered, CheckSquare, Quote, Table, History, Sparkles, Loader2,
  Download, MoreHorizontal, Palette, Flag, ChevronDown, Copy, ExternalLink,
} from 'lucide-react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';
import { useTaskStore } from '../store/taskStore';
import { useAuthStore } from '../store/authStore';
import { useFriendsStore } from '../store/friendsStore';
import { useNotesStore } from '../store/notesStore';
import { toEditorHtml, sanitizeHtml, htmlToMarkdown, safeFileName } from '../lib/noteFormat';
import { walkEditorBlocks } from '../lib/noteAuthorship';
import { api } from '../utils/api';
import NoteActivityPanel from './NoteActivityPanel';
import NoteCommentsPanel from './NoteCommentsPanel';
import NoteVersionsPanel from './NoteVersionsPanel';
import AvatarBadge from './AvatarBadge';
import '../styles/note-editor-modal.css';

const NOTE_EDITOR_SIZE_KEY = 'note_editor_modal_size_v1';

// Bordertöne sind absichtlich weniger gesättigt als zuvor — der Border
// wird als --nem-accent in die Color-Bar gemappt; zu satte Töne (das alte
// "Gold" #E6D35C der Gelb-Notiz) erzeugten einen UI-Look, der mit der
// blauen App-Palette gebrochen hat. Jetzt: pastellige Akzentstreifen.
const NOTE_COLORS = [
  { name: 'Gelb', bg: '#FFFE94', border: '#F3C969' },
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

function buildContent(rest /* , color */) {
  // Color wird ab sofort als eigenes Feld an die API geschickt; der
  // Legacy '[COLOR:Name]' Prefix wird nicht mehr in content geschrieben.
  return String(rest ?? '');
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
// schmalen Screens, kompakte Icon-Buttons für Desktop + Mobile.
// ────────────────────────────────────────────────────────────────────
const FORMAT_GROUPS = [
  [
    { type: 'h1',         icon: Heading1,      label: 'Überschrift 1' },
    { type: 'h2',         icon: Heading2,      label: 'Überschrift 2' },
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

// Vollständige URL in die Zwischenablage (mit Fallback für ältere WebViews).
async function copyTextSafe(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fallback unten */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

// URL-Token rund um eine Caret-Position in einem Textknoten ermitteln.
function urlTokenFromCaret(node, offset) {
  if (!node || node.nodeType !== 3) return null;
  const text = node.nodeValue || '';
  const isB = (c) => !c || /\s/.test(c) || c === '​';
  let start = offset, end = offset;
  while (start > 0 && !isB(text[start - 1])) start--;
  while (end < text.length && !isB(text[end])) end++;
  const token = text.slice(start, end).replace(/[).,;!?]+$/, '');
  return /^https?:\/\/\S{3,}$/i.test(token) ? token : null;
}

function FormatToolbar({ onAction, onAiAction, aiBusy = false }) {
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMenuPos, setAiMenuPos] = useState(null); // { top, right }
  const aiRef = useRef(null);
  const aiMenuRef = useRef(null);

  // Beim Öffnen: Anker-Rect lesen und Menue per portal an position:fixed
  // rendern. Andernfalls würde overflow:auto der Toolbar das Dropdown
  // abschneiden (Bug: Menue ist im DOM aber unsichtbar).
  useEffect(() => {
    if (!aiOpen) { setAiMenuPos(null); return undefined; }
    const update = () => {
      const el = aiRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setAiMenuPos({
        top: r.bottom + 6,
        right: Math.max(8, window.innerWidth - r.right),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [aiOpen]);

  useEffect(() => {
    if (!aiOpen) return undefined;
    const onDoc = (e) => {
      const inAnchor = aiRef.current && aiRef.current.contains(e.target);
      const inMenu = aiMenuRef.current && aiMenuRef.current.contains(e.target);
      if (!inAnchor && !inMenu) setAiOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setAiOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [aiOpen]);

  const AI_ITEMS = [
    { key: 'summarize', label: 'Zusammenfassen', hint: '2-4 Bulletpoints' },
    { key: 'rewrite:cleanup', label: 'Verbessern', hint: 'Rechtschreibung + Klarheit' },
    { key: 'rewrite:short', label: 'Kürzen', hint: 'Auf das Wesentliche' },
    { key: 'rewrite:formal', label: 'Formaler', hint: 'Sachlich, Sie-Form' },
    { key: 'rewrite:casual', label: 'Lockerer', hint: 'Freundlich, Du-Form' },
    { key: 'tags', label: 'Tags vorschlagen', hint: '3-6 Tags' },
  ];

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
      {onAiAction && (
        <div className="nem-toolbar-group nem-toolbar-ai" ref={aiRef}>
          <button
            type="button"
            className={`nem-toolbar-btn nem-toolbar-ai-btn${aiOpen ? ' is-active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setAiOpen((o) => !o)}
            title="KI-Aktionen"
            aria-label="KI-Aktionen"
            disabled={aiBusy}
            aria-haspopup="menu"
            aria-expanded={aiOpen}
          >
            <Sparkles size={16} strokeWidth={2} />
            <span className="nem-toolbar-ai-label">AI</span>
          </button>
          {aiOpen && aiMenuPos && createPortal(
            <div
              className="nem-ai-menu nem-ai-menu--portal"
              role="menu"
              ref={aiMenuRef}
              style={{ top: aiMenuPos.top, right: aiMenuPos.right }}
            >
              {AI_ITEMS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="nem-ai-menu-item"
                  role="menuitem"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setAiOpen(false);
                    onAiAction(item.key);
                  }}
                >
                  <span className="nem-ai-menu-label">{item.label}</span>
                  <span className="nem-ai-menu-hint">{item.hint}</span>
                </button>
              ))}
            </div>,
            document.body
          )}
        </div>
      )}
    </div>
  );
}

export default function NoteEditorModal({ note, onClose, onUpdate, onDelete, onComplete, readOnly: readOnlyProp = false }) {
  const sheetRef = useRef(null);
  // Color-DB-Spalte: wenn note.color gesetzt ist, hat sie Vorrang vor
  // Legacy '[COLOR:Name]'-Prefix im content. Backend strippt den Prefix
  // beim Save und backfilled die Spalte beim ersten GET; parseColor
  // bleibt nur als Fallback für Race-Conditions / alte Cache-Stände.
  const initialParsed = useMemo(() => parseColor(note?.content || ''), [note?.id]);
  const initialColor = useMemo(() => {
    if (note?.color) {
      const match = NOTE_COLORS.find((c) => c.name.toLowerCase() === String(note.color).toLowerCase());
      if (match) return match;
    }
    return initialParsed.color;
  }, [note?.id, note?.color, initialParsed.color]);
  const [title, setTitle] = useState(note?.title || '');
  // Content wird ab sofort als HTML gespeichert (WYSIWYG-Editor). Bestands-
  // Notizen sind Markdown -> on-load nach HTML konvertieren.
  const [content, setContent] = useState(() => toEditorHtml(initialParsed.rest));
  const [linkPopover, setLinkPopover] = useState(null); // { url, x, y } | null
  const [linkCopied, setLinkCopied] = useState(false);
  const [color, setColor] = useState(initialColor);
  const [importance, setImportance] = useState(note?.importance || 'medium');
  // Owner-/Readonly-Logik: Notes von anderen Usern (z. B. an gemeinsame
  // Tasks angeheftete Team-Notes) werden read-only dargestellt.
  const currentUser = useAuthStore((s) => s.user);
  const currentUserId = currentUser?.id ? String(currentUser.id) : '';
  const isOwnerOfNote = !note?.user_id || (currentUserId && String(note.user_id) === currentUserId);
  // Notes, die mit edit-Permission geteilt wurden, dürfen auch von Nicht-
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
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1024));
  const [sheetSize, setSheetSize] = useState({ width: null, height: null, maximized: false });
  // Versions-Panel (Verlauf) als Slide-in im Header.
  const [showVersions, setShowVersions] = useState(false);
  const [versionsBust, setVersionsBust] = useState(0);
  // Mobile Action-Sheet: 'more' | 'color' | 'importance' | null
  const [mobileSheet, setMobileSheet] = useState(null);
  // Unterer Bereich (Link-/Insights-Row + Footer-Sekundaeraktionen) ist auf
  // Handy/Tablet standardmaessig eingeklappt, damit der Editor max. Platz hat.
  const [bottomOpen, setBottomOpen] = useState(false);
  // Per-Block-Authorship: ein leichter farbiger Balken links neben jedem
  // Absatz markiert den urspruenglichen Autor. Daten werden on-the-fly
  // aus dem Versionsverlauf rekonstruiert (siehe api/notes.js /authorship).
  // authorMap = { blockKey: userId }, authors = { userId: details }.
  const [authorMap, setAuthorMap] = useState({});
  const [authors, setAuthors] = useState({});
  // Resize-Tick triggert eine Neuberechnung der Bar-Positionen.
  const [authorRailTick, setAuthorRailTick] = useState(0);
  const closeMobileSheet = useCallback(() => { setMobileSheet(null); setSheetDragY(0); }, []);

  // Swipe-to-dismiss für das Mobile-Action-Sheet (siehe NotesPage).
  // dragY = Drag-Offset >= 0. Release-Schwellen: > 120 px ODER > 0.5 px/ms.
  const [sheetDragY, setSheetDragY] = useState(0);
  const resizeDragRef = useRef(null);
  const sheetDragRef = useRef({ startY: 0, lastY: 0, lastT: 0, active: false });
  const handleSheetTouchStart = useCallback((e) => {
    const t = e.touches?.[0];
    if (!t) return;
    e.stopPropagation();
    sheetDragRef.current = { startY: t.clientY, lastY: t.clientY, lastT: performance.now(), active: true };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(NOTE_EDITOR_SIZE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      setSheetSize((prev) => ({
        ...prev,
        width: Number.isFinite(parsed.width) ? parsed.width : null,
        height: Number.isFinite(parsed.height) ? parsed.height : null,
        maximized: parsed.maximized === true,
      }));
    } catch {
      // ignore invalid localStorage payload
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(NOTE_EDITOR_SIZE_KEY, JSON.stringify(sheetSize));
    } catch {
      // localStorage may be unavailable
    }
  }, [sheetSize]);

  const canResizeDesktop = viewportWidth >= 1200;

  const startSheetResize = useCallback((e) => {
    if (!canResizeDesktop || !sheetRef.current) return;
    e.preventDefault();
    const rect = sheetRef.current.getBoundingClientRect();
    resizeDragRef.current = {
      left: rect.left,
      top: rect.top,
    };

    const onMove = (ev) => {
      const drag = resizeDragRef.current;
      if (!drag) return;
      const minWidth = 820;
      const minHeight = 560;
      const maxWidth = Math.max(minWidth, window.innerWidth - 32);
      const maxHeight = Math.max(minHeight, window.innerHeight - 32);
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, ev.clientX - drag.left));
      const nextHeight = Math.max(minHeight, Math.min(maxHeight, ev.clientY - drag.top));
      setSheetSize({ width: nextWidth, height: nextHeight, maximized: false });
    };

    const onUp = () => {
      resizeDragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [canResizeDesktop]);

  const toggleMaximized = useCallback(() => {
    if (!canResizeDesktop) return;
    setSheetSize((prev) => ({ ...prev, maximized: !prev.maximized }));
  }, [canResizeDesktop]);
  const handleSheetTouchMove = useCallback((e) => {
    if (!sheetDragRef.current.active) return;
    const t = e.touches?.[0];
    if (!t) return;
    e.stopPropagation();
    const dy = Math.max(0, t.clientY - sheetDragRef.current.startY);
    sheetDragRef.current.lastY = t.clientY;
    sheetDragRef.current.lastT = performance.now();
    setSheetDragY(dy);
  }, []);
  const handleSheetTouchEnd = useCallback((e) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (!sheetDragRef.current.active) return;
    const dragged = Math.max(0, sheetDragRef.current.lastY - sheetDragRef.current.startY);
    const dt = Math.max(1, performance.now() - sheetDragRef.current.lastT);
    const velocity = dragged / dt; // px/ms
    sheetDragRef.current.active = false;
    if (dragged > 120 || velocity > 0.5) {
      setMobileSheet(null);
      setSheetDragY(0);
    } else {
      setSheetDragY(0);
    }
  }, []);

  // Verknuepfter Termin / Aufgabe (bidirektional via notes.linked_task_id)
  const tasks = useTaskStore((s) => s.tasks);
  const linkedTask = useMemo(() => {
    if (!note?.linked_task_id || !Array.isArray(tasks)) return null;
    return tasks.find((t) => t && String(t.id) === String(note.linked_task_id)) || null;
  }, [tasks, note?.linked_task_id]);
  // Sichtbarkeit: 'private' (Default) oder 'group'. Der manuelle Toggle
  // entfaellt — wenn eine Notiz an eine Gruppentask haengt, ist Sichtbarkeit
  // durch die Task-Verknuepfung impliziert und der Privat/Geteilt-Switch
  // wird ausgeblendet.
  const visibility = note?.visibility === 'group' ? 'group' : 'private';
  const canShareWithGroup = false;
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

  // Friends-Liste laden, falls Store leer (z. B. Note direkt geöffnet).
  useEffect(() => {
    if (!Array.isArray(friends) || friends.length === 0) {
      try { fetchFriends?.(); } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Permissions-Map aus note.shares (Backend, sauberste Quelle).
  // Fallback: participant_ids (alle 'view') für Notes von alten Versionen
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
  // wird nicht vom Backend-Resync überschrieben.
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
    // Globaler Trigger: NotesPage (oder andere Mounter) öffnen TaskDetailModal.
    window.dispatchEvent(new CustomEvent('beequ:open-task', { detail: { task: linkedTask } }));
    onClose?.();
  };
  const editorRef = useRef(null);
  const saveTimerRef = useRef(null);
  const initialKeyRef = useRef(`${note?.id}|${note?.title || ''}|${note?.content || ''}|${note?.color || ''}|${note?.importance || ''}`);
  // Letzter Stand, der serverseitig als "in sync" gilt - verhindert
  // den Loop "externe Aktualisierung -> setContent -> scheduleSave ->
  // PATCH -> Broadcast -> externe Aktualisierung ...". Wir vergleichen
  // die Signatur bevor wir überhaupt einen Save planen.
  const lastSavedKeyRef = useRef(initialKeyRef.current);
  // Mobile/IME-Schutz: document.activeElement === editorRef ist auf
  // Mobile-Browsern unzuverlaessig (virtuelle Tastatur, Autocomplete-
  // Bar, IME-Composition). Wir tracken die letzte User-Eingabe per
  // Timestamp und sperren Live-Sync für 1.5s nach jedem Keystroke.
  const userTypingRef = useRef(0);
  const composingRef = useRef(false);
  // Verhindert Live-Sync-Schreibungen während ein eigener PATCH noch
  // unterwegs ist (Server könnte mit älterem Stand antworten / Broadcast
  // könnte zwischendurch eintreffen).
  const savingInFlightRef = useRef(false);

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
  // nicht bei jedem Keystroke das DOM überschreibt (Caret-Reset).
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = toEditorHtml(initialParsed.rest);
    el.innerHTML = html;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  // Per-Block-Authorship aus dem Versionsverlauf laden. Liefert eine
  // Map {blockKey: userId} für die aktuellen Bloecke der Notiz +
  // User-Details. Wird bei Note-Wechsel und nach jedem Save (via
  // versionsBust) neu gezogen — Snapshots werden serverseitig
  // gedrosselt (~30s), daher kein Spam.
  useEffect(() => {
    let cancelled = false;
    if (!note?.id) { setAuthorMap({}); setAuthors({}); return undefined; }
    (async () => {
      try {
        const data = await api.getNoteAuthorship(note.id);
        if (cancelled) return;
        setAuthorMap(data?.authorship && typeof data.authorship === 'object' ? data.authorship : {});
        setAuthors(data?.authors && typeof data.authors === 'object' ? data.authors : {});
        setAuthorRailTick((t) => t + 1);
      } catch {
        if (!cancelled) { setAuthorMap({}); setAuthors({}); }
      }
    })();
    return () => { cancelled = true; };
  }, [note?.id, versionsBust]);

  // Live-Sync: wenn die Notiz fremd aktualisiert wird (z.B. der Eigentuemer
  // editiert eine geteilte Notiz und das Polling zieht neue Daten), den
  // Editor-Inhalt aktualisieren \u2014 aber NUR wenn der User gerade nicht
  // selbst in dem Editor tippt (sonst Caret-Reset / Datenverlust).
  // Wichtig: nach dem Sync MUSS lastSavedKeyRef aktualisiert werden,
  // sonst feuert die scheduleSave-useEffect (Z. unten) den nächsten
  // PATCH und es entsteht ein Endlos-Loop "save -> broadcast -> sync
  // -> save -> ..." (siehe Versions-Spam).
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    // Nicht überschreiben, solange:
    //  - der User gerade tippt (activeElement-Check IST unzuverlaessig
    //    auf Mobile, daher zusätzlich userTypingRef-Timestamp + IME)
    //  - eine eigene PATCH-Anfrage noch unterwegs ist (Broadcast könnte
    //    älteren Stand zurückspielen, der unsere lokale Eingabe killt)
    if (document.activeElement === el) return;
    if (composingRef.current) return;
    if (savingInFlightRef.current) return;
    if (Date.now() - userTypingRef.current < 1500) return;
    const parsed = parseColor(note?.content || '');
    const nextHtml = toEditorHtml(parsed.rest);
    const nextTitle = note?.title || '';
    const nextColorName = note?.color || parsed.color?.name || '';
    const nextImportance = note?.importance || 'medium';
    // Signatur immer auf den vom Server bestätigten Stand setzen,
    // auch wenn sich der innerHTML-Vergleich nicht ändert (z.B. nach
    // dem ersten echten Save kommt der Inhalt identisch zurück).
    lastSavedKeyRef.current = `${note?.id}|${nextTitle}|${buildContent(nextHtml, parsed.color || color)}|${nextColorName}|${nextImportance}`;
    if (nextHtml === el.innerHTML) return; // nichts zu rendern
    el.innerHTML = nextHtml;
    setContent(nextHtml);
    if (parsed.color) setColor(parsed.color);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.content, note?.title, note?.color, note?.importance]);

  // Debounced Auto-Save. Skipt, wenn der aktuelle Stand bereits dem
  // letzten serverbestätigten Stand entspricht (lastSavedKeyRef).
  // Dadurch werden "Echo-Saves" nach Live-Sync verhindert, die sonst
  // jede Sekunde neue Versions-Snapshots ausgeloest haben.
  const scheduleSave = useCallback((nextTitle, nextContent, nextColor, nextImportance) => {
    if (!note?.id) return;
    if (readOnly) return;
    const trimmedTitle = (nextTitle || '').trim();
    const builtContent = buildContent(nextContent, nextColor);
    const colorName = nextColor?.name || '';
    const sig = `${note.id}|${trimmedTitle}|${builtContent}|${colorName}|${nextImportance}`;
    if (sig === lastSavedKeyRef.current) {
      setSaveState('idle');
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveState('saving');
    saveTimerRef.current = setTimeout(async () => {
      savingInFlightRef.current = true;
      try {
        await onUpdate?.(note.id, {
          title: trimmedTitle,
          content: builtContent,
          color: colorName || null,
          importance: nextImportance,
        });
        lastSavedKeyRef.current = sig;
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1200);
      } catch (err) {
        console.error('[NoteEditorModal] auto-save failed:', err);
        setSaveState('idle');
      } finally {
        // Kurz noch sperren, damit der nachfolgende Broadcast/Refetch
        // nicht in die Live-Sync läuft (Race-Schutz).
        setTimeout(() => { savingInFlightRef.current = false; }, 250);
      }
    }, 700);
  }, [note?.id, onUpdate, readOnly]);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (readOnly) return;
    const builtContent = buildContent(content, color);
    const colorName = color?.name || '';
    const key = `${note?.id}|${title}|${builtContent}|${colorName}|${importance}`;
    if (key === initialKeyRef.current) return;
    if (key === lastSavedKeyRef.current) return; // nichts neues seit dem letzten Save
    onUpdate?.(note.id, {
      title: (title || '').trim(),
      content: builtContent,
      color: colorName || null,
      importance,
    })
      .then(() => { lastSavedKeyRef.current = key; })
      .catch((err) => console.error('[NoteEditorModal] flush save failed:', err));
  }, [note?.id, title, content, color, importance, onUpdate, readOnly]);

  useEffect(() => {
    scheduleSave(title, content, color, importance);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, color, importance]);

  // Beim Unmount sicher speichern. WICHTIG: useEffect-Deps dürfen NICHT
  // [flushSave] sein, weil flushSave per useCallback bei jedem Keystroke
  // (title/content/color/importance Änderung) eine neue Referenz bekommt.
  // Sonst feuert die Cleanup-Funktion auf JEDEM Re-Render einen
  // sofortigen PATCH und der Editor läuft in eine endlose Save-Loop
  // ("Text wird neu geschrieben, halb weg, neu, hört nicht auf").
  // Wir spiegeln den aktuellen flushSave in eine Ref und rufen ihn nur
  // beim echten Unmount.
  const flushSaveRef = useRef(flushSave);
  useEffect(() => { flushSaveRef.current = flushSave; }, [flushSave]);
  useEffect(() => () => { flushSaveRef.current?.(); }, []);

  // Body-Klasse setzen: BottomNav ausblenden + Body-Scroll sperren ohne
  // Layout-Shift (Vermeidet, dass sich der notes-board-header verschiebt).
  // Zusätzlich iOS-Scroll-Lock via position:fixed + scrollY-Restore, damit
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

  // Export der Notiz als Markdown-Datei. Wandelt das aktuelle HTML in
  // Markdown und triggert einen Browser-Download. Keine Server-Roundtrip.
  const handleExportMarkdown = useCallback(() => {
    try {
      const md = htmlToMarkdown(content || '');
      const titleStr = (title || '').trim();
      const header = titleStr ? `# ${titleStr}\n\n` : '';
      const meta = `<!-- exported from Beequ - ${new Date().toISOString()} -->\n\n`;
      const body = header + meta + md;
      const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeFileName(titleStr || 'notiz')}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.warn('[NoteEditorModal] export markdown failed:', err);
    }
  }, [content, title]);

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

  // Tab im Editor: 2-Space-Einrückung statt Fokuswechsel.
  const onEditorKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
      return;
    }
    // Enter am ENDE eines Links: Caret aus dem <a> herausschieben, damit die
    // neue Zeile (und neuer Text) NICHT mehr Teil des Links ist. Sonst bleibt
    // der Cursor im Link "hängen" und man kommt nicht in die nächste Zeile.
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !composingRef.current) {
      const sel = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
      if (!sel || sel.rangeCount === 0) return;
      let node = sel.anchorNode;
      let anchor = null;
      while (node && node !== editorRef.current) {
        if (node.nodeType === 1 && node.nodeName === 'A') { anchor = node; break; }
        node = node.parentNode;
      }
      if (!anchor) return; // kein Link -> normaler Enter
      const range = sel.getRangeAt(0);
      // Steht der Caret am Ende des Link-Inhalts?
      const tail = range.cloneRange();
      tail.selectNodeContents(anchor);
      tail.setStart(range.endContainer, range.endOffset);
      if (tail.toString().length !== 0) return; // mitten im Link -> Browser-Default
      // Caret direkt hinter den Link setzen; Default-Enter macht dann eine
      // neue Zeile AUSSERHALB des <a>.
      const out = document.createRange();
      out.setStartAfter(anchor);
      out.collapse(true);
      sel.removeAllRanges();
      sel.addRange(out);
    }
  };

  // Editor-Input -> State syncen (debounced Save kickt automatisch).
  const onEditorInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    // Mobile-Schutz: Timestamp setzen, Live-Sync sperrt 1.5s.
    userTypingRef.current = Date.now();
    // Keine Sanitization während des Tippens (sonst Caret-Reset).
    // Wird vor jedem Speichern in scheduleSave/flushSave gesaeubert.
    setContent(el.innerHTML);
  }, []);

  // IME / virtuelle Tastatur Composition (Android/iOS-Autocorrect).
  // Solange composing true ist, darf Live-Sync nicht in den Editor
  // schreiben - sonst stuerzt die Auto-Vervollständigung ab.
  const onCompositionStart = useCallback(() => {
    composingRef.current = true;
    userTypingRef.current = Date.now();
  }, []);
  const onCompositionEnd = useCallback(() => {
    composingRef.current = false;
    userTypingRef.current = Date.now();
    const el = editorRef.current;
    if (el) setContent(el.innerHTML);
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
    // Link unter dem Klick (echtes <a> ODER reine Text-URL) -> Popover
    // mit "Öffnen" + "Kopieren". Funktioniert auch im Lese-Modus.
    const aEl = t && t.closest && t.closest('a[href]');
    if (aEl) {
      e.preventDefault();
      setLinkPopover({ url: aEl.getAttribute('href'), x: e.clientX, y: e.clientY });
      return;
    }
    let tok = null;
    if (typeof document !== 'undefined' && document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (r) tok = urlTokenFromCaret(r.startContainer, r.startOffset);
    }
    if (tok) {
      setLinkPopover({ url: tok, x: e.clientX, y: e.clientY });
      return;
    }
    setLinkPopover(null);
    if (readOnly) return;
    // Klick direkt auf den Editor-Container (also Leerraum unter dem
    // letzten Block) -> Caret ans Ende + ggf. neue Zeile anlegen.
    if (t === editorRef.current) {
      moveCaretToEnd();
      onEditorInput();
    }
  }, [readOnly, onEditorInput, moveCaretToEnd]);

  // Link-Popover schließen bei Klick außerhalb / Scroll / Resize.
  useEffect(() => {
    if (!linkPopover) return undefined;
    setLinkCopied(false);
    const close = () => setLinkPopover(null);
    const onDocDown = (ev) => {
      if (!ev.target || !ev.target.closest || !ev.target.closest('.nem-link-pop')) close();
    };
    document.addEventListener('pointerdown', onDocDown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDocDown, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [linkPopover]);

  // ──────────────────────────────────────────────────────────────────
  // Formatierungs-Toolbar (WYSIWYG)
  // Inline-Formate via document.execCommand. Tabellen/Checklisten als
  // HTML-Fragmente direkt eingefuegt. Kein Platzhaltertext, wenn der
  // User bereits Text markiert hat (wrappt nur die Auswahl).
  // ──────────────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────
  // KI-Aktionen über die FormatToolbar (Sparkles-Dropdown).
  // Ein einziger zentraler Handler nimmt den aktuellen Editor-Content,
  // schickt ihn ans Backend und legt das Ergebnis in aiSuggest ab.
  // Der User kann das Ergebnis annehmen (Editor aktualisieren) oder
  // verwerfen. Wir mutieren den Editor NIE direkt - schuetzt vor
  // ungewollten Änderungen.
  // ──────────────────────────────────────────────────────────────────
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggest, setAiSuggest] = useState(null);
  // { kind: 'summary'|'rewrite'|'tags', label, preview, applyHtml, applyText, raw }

  const escapeHtml = useCallback((s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'), []);

  const handleAiAction = useCallback(async (actionKey) => {
    if (readOnly || !editorRef.current) return;
    if (aiBusy) return;
    const current = editorRef.current.innerHTML || '';
    if (!current.trim() || current.replace(/<[^>]*>/g, '').trim().length < 5) {
      window.alert('Bitte erst etwas Text in die Notiz schreiben.');
      return;
    }
    setAiBusy(true);
    setAiSuggest(null);
    try {
      if (actionKey === 'summarize') {
        const data = await api.summarizeNote(current);
        const summary = String(data?.result?.summary || '').trim();
        if (!summary) throw new Error('Leere Zusammenfassung');
        // Bulletpoints kommen als '- ...' Zeilen.
        const lines = summary.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const listHtml = `<p><strong>Zusammenfassung:</strong></p><ul>${
          lines.map((l) => `<li>${escapeHtml(l.replace(/^[-*]\s*/, ''))}</li>`).join('')
        }</ul>`;
        setAiSuggest({
          kind: 'summary',
          label: 'Zusammenfassung anhängen',
          preview: lines.map((l) => l.replace(/^[-*]\s*/, '\u2022 ')).join('\n'),
          mode: 'append',
          applyHtml: listHtml,
        });
      } else if (actionKey.startsWith('rewrite:')) {
        const style = actionKey.split(':')[1];
        const data = await api.rewriteNote(current, style);
        const rewritten = String(data?.result?.rewritten || '').trim();
        if (!rewritten) throw new Error('Leerer Rewrite');
        // Plain-Text -> einfaches HTML (Absaetze).
        const html = rewritten.split(/\n{2,}/).map((p) =>
          `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`
        ).join('');
        const labelMap = {
          cleanup: 'Verbesserten Text übernehmen',
          short: 'Gekürzten Text übernehmen',
          formal: 'Formalen Text übernehmen',
          casual: 'Lockeren Text übernehmen',
        };
        setAiSuggest({
          kind: 'rewrite',
          label: labelMap[style] || 'Text übernehmen',
          preview: rewritten,
          mode: 'replace',
          applyHtml: html,
        });
      } else if (actionKey === 'tags') {
        const data = await api.suggestNoteTags(current);
        const tags = Array.isArray(data?.result?.tags) ? data.result.tags : [];
        if (tags.length === 0) throw new Error('Keine Tags');
        const chips = `<p>${tags.map((t) => `<code>#${escapeHtml(t)}</code>`).join(' ')}</p>`;
        setAiSuggest({
          kind: 'tags',
          label: 'Tags am Anfang einfuegen',
          preview: tags.map((t) => `#${t}`).join('  '),
          mode: 'prepend',
          applyHtml: chips,
        });
      }
    } catch (err) {
      console.error('[NoteEditorModal] AI action failed:', err);
      window.alert('KI-Aktion fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setAiBusy(false);
    }
  }, [readOnly, aiBusy, escapeHtml]);

  const applyAiSuggest = useCallback(() => {
    const el = editorRef.current;
    if (!el || !aiSuggest) return;
    const current = el.innerHTML || '';
    let next = current;
    if (aiSuggest.mode === 'append') {
      next = current + aiSuggest.applyHtml;
    } else if (aiSuggest.mode === 'prepend') {
      next = aiSuggest.applyHtml + current;
    } else {
      next = aiSuggest.applyHtml;
    }
    el.innerHTML = next;
    setContent(next);
    setAiSuggest(null);
    // Debounced Save triggern, damit der Stand persistiert wird.
    scheduleSave(title, next, color, importance);
  }, [aiSuggest, title, color, importance, scheduleSave]);

  // ──────────────────────────────────────────────────────────────────
  // applyFormat (Bold, Italic, Listen, ...).
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
        // und der Cursor dort landet (insertHTML lässt den Cursor sonst
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
          ref={sheetRef}
          className={`nem-sheet${canResizeDesktop ? ' is-desktop-resizable' : ''}${sheetSize.maximized ? ' is-maximized' : ''}${bottomOpen ? ' nem-bottom-open' : ''}`}
          style={{
            '--nem-accent': color.border,
            ...(sheetSize.width ? { '--nem-sheet-width': `${sheetSize.width}px` } : {}),
            ...(sheetSize.height ? { '--nem-sheet-height': `${sheetSize.height}px` } : {}),
          }}
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
                className={`nem-icon-btn${showVersions ? ' is-active' : ''}`}
                onClick={() => setShowVersions((v) => !v)}
                title="Verlauf"
                aria-pressed={showVersions}
              >
                <History size={18} />
              </button>
              <button
                type="button"
                className="nem-icon-btn"
                onClick={handleExportMarkdown}
                title="Als Markdown exportieren"
                aria-label="Notiz als Markdown-Datei exportieren"
              >
                <Download size={18} />
              </button>
              {canResizeDesktop && (
                <button
                  type="button"
                  className="nem-icon-btn"
                  onClick={toggleMaximized}
                  title={sheetSize.maximized ? 'Normale Größe' : 'Editor vergrößern'}
                  aria-label={sheetSize.maximized ? 'Normale Größe' : 'Editor vergrößern'}
                >
                  {sheetSize.maximized ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
              )}
              <button
                type="button"
                className="nem-icon-btn"
                onClick={handleClose}
                title="Schliessen (Esc)"
                aria-label="Editor schliessen"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="nem-body">
            {!readOnly && (
              <FormatToolbar
                onAction={applyFormat}
                onAiAction={handleAiAction}
                aiBusy={aiBusy}
              />
            )}
            {aiBusy && (
              <div className="nem-ai-status" role="status" aria-live="polite">
                <Loader2 size={14} className="nem-ai-spin" />
                <span>KI denkt nach…</span>
              </div>
            )}
            {aiSuggest && !aiBusy && (
              <div className="nem-ai-suggest" role="region" aria-label="KI-Vorschlag">
                <div className="nem-ai-suggest-head">
                  <Sparkles size={14} />
                  <strong>KI-Vorschlag</strong>
                </div>
                <pre className="nem-ai-suggest-preview">{aiSuggest.preview}</pre>
                <div className="nem-ai-suggest-actions">
                  <button
                    type="button"
                    className="nem-ai-suggest-btn is-primary"
                    onClick={applyAiSuggest}
                  >
                    {aiSuggest.label}
                  </button>
                  <button
                    type="button"
                    className="nem-ai-suggest-btn"
                    onClick={() => setAiSuggest(null)}
                  >
                    Verwerfen
                  </button>
                </div>
              </div>
            )}
            <div className="nem-editor-shell">
              <NoteAuthorRail
                editorRef={editorRef}
                authorMap={authorMap}
                authors={authors}
                currentUserId={currentUserId}
                tick={authorRailTick}
              />
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
                onCompositionStart={onCompositionStart}
                onCompositionEnd={onCompositionEnd}
              />
            </div>
            {linkPopover && createPortal(
              <div
                className="nem-link-pop"
                style={{
                  position: 'fixed',
                  top: Math.max(8, linkPopover.y - 52),
                  left: Math.min(Math.max(8, linkPopover.x - 70), (typeof window !== 'undefined' ? window.innerWidth : 400) - 160),
                  zIndex: 2147483000,
                }}
                role="menu"
              >
                <button
                  type="button"
                  className="nem-link-pop-btn"
                  onClick={() => { window.open(linkPopover.url, '_blank', 'noopener,noreferrer'); setLinkPopover(null); }}
                >
                  <ExternalLink size={14} /> Öffnen
                </button>
                <span className="nem-link-pop-sep" />
                <button
                  type="button"
                  className="nem-link-pop-btn"
                  onClick={async () => {
                    const ok = await copyTextSafe(linkPopover.url);
                    if (ok) { setLinkCopied(true); setTimeout(() => setLinkPopover(null), 700); }
                  }}
                >
                  {linkCopied ? <Check size={14} /> : <Copy size={14} />} {linkCopied ? 'Kopiert' : 'Kopieren'}
                </button>
              </div>,
              document.body
            )}
          </div>

          {/* Verknuepfter Termin / Aufgabe (bidirektional). */}
          <div className={`nem-link-row${(taskPickerOpen || friendPickerOpen) ? ' is-picker-open' : ''}`}>
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
                title={visibility === 'group' ? 'Sichtbar für alle Gruppenmitglieder — klicken zum Privatisieren' : 'Nur für dich sichtbar — klicken zum Teilen mit Gruppe'}
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
                      className="nem-share-chip nem-share-chip--pin is-owner"
                      title={`Geteilt von ${note.owner_name}`}
                    >
                      {note.owner_avatar_url ? (
                        <img src={note.owner_avatar_url} alt="" className="nem-share-chip-avatar" />
                      ) : (
                        <span className="nem-share-chip-avatar nem-share-chip-avatar--initial">
                          {(note.owner_name[0] || '?').toUpperCase()}
                        </span>
                      )}
                    </span>
                  )}
                  {recipientList.map((r) => {
                    const isMe = r.user_id === currentUserId;
                    return (
                      <span
                        key={r.user_id}
                        className={`nem-share-chip nem-share-chip--pin${isMe ? ' is-me' : ''}`}
                        title={`${isMe ? 'Du' : r.name} — ${r.permission === 'edit' ? 'darf bearbeiten' : 'kann nur lesen'}`}
                      >
                        {r.avatar_url ? (
                          <img src={r.avatar_url} alt="" className="nem-share-chip-avatar" />
                        ) : (
                          <span className="nem-share-chip-avatar nem-share-chip-avatar--initial">
                            {(r.name[0] || '?').toUpperCase()}
                          </span>
                        )}
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
                        className={`nem-share-chip nem-share-chip--pin is-active${isEdit ? ' is-edit' : ''}`}
                        title={`${getFriendName(f)} — ${isEdit ? 'darf bearbeiten' : 'kann nur lesen'}`}
                      >
                        {getFriendAvatar(f) ? (
                          <img src={getFriendAvatar(f)} alt="" className="nem-share-chip-avatar" />
                        ) : (
                          <span className="nem-share-chip-avatar nem-share-chip-avatar--initial">{getFriendInitial(f)}</span>
                        )}
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
                    <span>{sharedFriends.length === 0 ? 'Teilen' : 'Mehr'}</span>
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

          {/* Insights-Row: Aktivitaetsverlauf + Kommentare als kompakte
              Side-by-Side-Cards (Desktop/Tablet). Auf Mobile stapeln sie
              sich. Ausgeklappt spannt die jeweilige Karte beide Spalten
              über die :has(.is-open)-Regel im CSS, damit das Panel volle
              Breite bekommt. */}
          {note?.id && (
            <div className="nem-insights-row">
              <NoteActivityPanel
                noteId={note.id}
                refreshKey={note?.updated_at || 0}
              />
              <NoteCommentsPanel
                noteId={note.id}
                refreshKey={note?.updated_at || 0}
                canWrite={!readOnly || hasEditPermission || isOwnerOfNote}
                noteOwnerId={note?.user_id}
              />
            </div>
          )}

          <AnimatePresence>
            {showVersions && note?.id && (
              <NoteVersionsPanel
                key={`ver-${note.id}`}
                noteId={note.id}
                canEdit={!readOnly}
                onClose={() => setShowVersions(false)}
                onRestored={() => {
                  // Restore: das Panel laedt seine Liste selbst neu;
                  // der Editor erhaelt den neuen note.content per
                  // Broadcast/Polling und der Live-Sync-useEffect
                  // aktualisiert den contentEditable schonend, ohne
                  // einen weiteren Save auszuloesen (lastSavedKeyRef).
                  setVersionsBust((n) => n + 1);
                }}
              />
            )}
          </AnimatePresence>

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
                  if (!window.confirm('Notiz wirklich löschen?')) return;
                  onDelete?.(note.id);
                  onClose?.();
                }}
                title="Löschen"
              >
                <Trash2 size={14} /> <span>Löschen</span>
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

          {/* Mobile-Bottom-Bar (iOS-Pill-Stil) — nur auf <=720px sichtbar,
              ersetzt visuell den Desktop-Footer. Sekundaere Aktionen sind
              im Aktions-Sheet hinter dem "Mehr"-Button verfuegbar. */}
          {!readOnly && (
            <div className="nem-mobile-bar" role="toolbar" aria-label="Notiz-Aktionen">
              <button
                type="button"
                className={`nem-mobile-pill nem-mobile-pill--expand${bottomOpen ? ' is-open' : ''}`}
                onClick={() => setBottomOpen((v) => !v)}
                aria-label={bottomOpen ? 'Details einklappen' : 'Details ausklappen'}
                aria-expanded={bottomOpen}
              >
                <ChevronDown size={18} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                className="nem-mobile-pill nem-mobile-pill--color"
                style={{ backgroundColor: color.bg, borderColor: color.border }}
                onClick={() => setMobileSheet(mobileSheet === 'color' ? null : 'color')}
                aria-label={`Farbe: ${color.name} (ändern)`}
                aria-haspopup="dialog"
                aria-expanded={mobileSheet === 'color'}
              >
                <Palette size={16} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                className={`nem-mobile-pill nem-mobile-pill--importance is-${importance}`}
                onClick={() => setMobileSheet(mobileSheet === 'importance' ? null : 'importance')}
                aria-label={`Wichtigkeit: ${importance === 'low' ? 'Niedrig' : importance === 'medium' ? 'Mittel' : 'Hoch'} (ändern)`}
                aria-haspopup="dialog"
                aria-expanded={mobileSheet === 'importance'}
              >
                <Flag size={16} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                className="nem-mobile-pill nem-mobile-pill--more"
                onClick={() => setMobileSheet(mobileSheet === 'more' ? null : 'more')}
                aria-label="Weitere Aktionen"
                aria-haspopup="menu"
                aria-expanded={mobileSheet === 'more'}
              >
                <MoreHorizontal size={18} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                className="nem-mobile-pill nem-mobile-pill--done"
                onClick={handleClose}
                title="Fertig (auto-gespeichert)"
              >
                <Check size={16} strokeWidth={2.6} />
                <span>Fertig</span>
              </button>
            </div>
          )}
          {readOnly && (
            <div className="nem-mobile-bar nem-mobile-bar--readonly" role="toolbar" aria-label="Notiz-Aktionen">
              <button
                type="button"
                className="nem-mobile-pill nem-mobile-pill--done"
                onClick={handleClose}
              >
                <X size={16} strokeWidth={2.6} />
                <span>Schliessen</span>
              </button>
            </div>
          )}

          {/* Mobile Action-Sheet */}
          {mobileSheet && (
            <div
              className="nem-mobile-sheet-backdrop"
              role="presentation"
              onClick={closeMobileSheet}
              style={sheetDragY > 0 ? { backgroundColor: `rgba(0,0,0,${Math.max(0.10, 0.35 - sheetDragY / 400)})` } : undefined}
            >
              <div
                className={`nem-mobile-sheet nem-mobile-sheet--${mobileSheet}`}
                role="dialog"
                aria-modal="true"
                aria-label={
                  mobileSheet === 'color' ? 'Farbe wählen'
                  : mobileSheet === 'importance' ? 'Wichtigkeit wählen'
                  : 'Weitere Aktionen'
                }
                onClick={(e) => e.stopPropagation()}
                style={sheetDragY > 0 ? { transform: `translateY(${sheetDragY}px)`, transition: 'none' } : undefined}
              >
                <div
                  className="nem-mobile-sheet-drag"
                  onTouchStart={handleSheetTouchStart}
                  onTouchMove={handleSheetTouchMove}
                  onTouchEnd={handleSheetTouchEnd}
                  onTouchCancel={handleSheetTouchEnd}
                >
                  <div className="nem-mobile-sheet-grip" aria-hidden="true" />
                  <div className="nem-mobile-sheet-title">
                    {mobileSheet === 'color' && 'Farbe'}
                    {mobileSheet === 'importance' && 'Wichtigkeit'}
                    {mobileSheet === 'more' && 'Aktionen'}
                  </div>
                </div>

                {mobileSheet === 'color' && (
                  <div className="nem-mobile-color-grid" role="radiogroup" aria-label="Farbe">
                    {NOTE_COLORS.map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        role="radio"
                        aria-checked={c.name === color.name}
                        className={`nem-mobile-color-swatch${c.name === color.name ? ' is-active' : ''}`}
                        style={{ backgroundColor: c.bg, borderColor: c.border }}
                        onClick={() => { setColor(c); closeMobileSheet(); }}
                      >
                        <span className="nem-mobile-color-name">{c.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {mobileSheet === 'importance' && (
                  <div className="nem-mobile-importance-list">
                    {[
                      { key: 'low', label: 'Niedrig', hint: 'Weniger dringend' },
                      { key: 'medium', label: 'Mittel', hint: 'Standard' },
                      { key: 'high', label: 'Hoch', hint: 'Wichtig / dringend' },
                    ].map((it) => (
                      <button
                        key={it.key}
                        type="button"
                        className={`nem-mobile-sheet-item is-${it.key}${importance === it.key ? ' is-active' : ''}`}
                        onClick={() => { setImportance(it.key); closeMobileSheet(); }}
                      >
                        <span className={`nem-mobile-importance-dot is-${it.key}`} aria-hidden="true" />
                        <span className="nem-mobile-sheet-item-text">
                          <span className="nem-mobile-sheet-item-label">{it.label}</span>
                          <span className="nem-mobile-sheet-item-hint">{it.hint}</span>
                        </span>
                        {importance === it.key && <Check size={16} />}
                      </button>
                    ))}
                  </div>
                )}

                {mobileSheet === 'more' && (
                  <div className="nem-mobile-sheet-list">
                    <button
                      type="button"
                      className="nem-mobile-sheet-item"
                      onClick={() => { closeMobileSheet(); setShowVersions(true); }}
                    >
                      <History size={18} />
                      <span className="nem-mobile-sheet-item-text">
                        <span className="nem-mobile-sheet-item-label">Verlauf</span>
                        <span className="nem-mobile-sheet-item-hint">Ältere Fassungen ansehen</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="nem-mobile-sheet-item"
                      onClick={() => { closeMobileSheet(); handleExportMarkdown(); }}
                    >
                      <Download size={18} />
                      <span className="nem-mobile-sheet-item-text">
                        <span className="nem-mobile-sheet-item-label">Als Markdown exportieren</span>
                        <span className="nem-mobile-sheet-item-hint">.md-Datei herunterladen</span>
                      </span>
                    </button>
                    {canShareWithGroup && (
                      <button
                        type="button"
                        className="nem-mobile-sheet-item"
                        onClick={() => { closeMobileSheet(); handleToggleVisibility(); }}
                      >
                        {visibility === 'group' ? <Lock size={18} /> : <Users size={18} />}
                        <span className="nem-mobile-sheet-item-text">
                          <span className="nem-mobile-sheet-item-label">
                            {visibility === 'group' ? 'Privatisieren' : 'Mit Gruppe teilen'}
                          </span>
                          <span className="nem-mobile-sheet-item-hint">
                            {visibility === 'group' ? 'Nur für dich sichtbar' : 'Für alle Gruppenmitglieder'}
                          </span>
                        </span>
                      </button>
                    )}
                    {!readOnly && (
                      <button
                        type="button"
                        className="nem-mobile-sheet-item"
                        onClick={() => {
                          closeMobileSheet();
                          flushSave();
                          onComplete?.(note.id);
                          onClose?.();
                        }}
                      >
                        <Archive size={18} />
                        <span className="nem-mobile-sheet-item-text">
                          <span className="nem-mobile-sheet-item-label">Archivieren</span>
                          <span className="nem-mobile-sheet-item-hint">Als erledigt markieren</span>
                        </span>
                      </button>
                    )}
                    {!readOnly && (
                      <button
                        type="button"
                        className="nem-mobile-sheet-item is-danger"
                        onClick={() => {
                          closeMobileSheet();
                          if (!window.confirm('Notiz wirklich löschen?')) return;
                          onDelete?.(note.id);
                          onClose?.();
                        }}
                      >
                        <Trash2 size={18} />
                        <span className="nem-mobile-sheet-item-text">
                          <span className="nem-mobile-sheet-item-label">Löschen</span>
                          <span className="nem-mobile-sheet-item-hint">Endgueltig entfernen</span>
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="nem-mobile-sheet-cancel"
                      onClick={closeMobileSheet}
                    >
                      Abbrechen
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          {canResizeDesktop && !sheetSize.maximized && (
            <button
              type="button"
              className="nem-resize-handle"
              onPointerDown={startSheetResize}
              title="Größe ziehen"
              aria-label="Editorgröße anpassen"
            />
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}


// ------------------------------------------------------------
// NoteAuthorRail — winziger Avatar links neben jedem Block,
// der einem bekannten Autor zugeordnet werden konnte. Wird auf
// allen Geraeten angezeigt (auch für eigene Bloecke), damit die
// Markierung konsistent sichtbar bleibt. Position wird live aus
// dem contentEditable-DOM berechnet.
// ------------------------------------------------------------
function NoteAuthorRail({ editorRef, authorMap, authors, currentUserId, tick }) {
  const [marks, setMarks] = useState([]);
  const rafRef = useRef(0);

  const compute = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) { setMarks([]); return; }
    const blocks = walkEditorBlocks(editor);
    if (blocks.length === 0) { setMarks([]); return; }
    const editorRect = editor.getBoundingClientRect();
    // Erst: jeden Block → (userId, top, bottom) sammeln (nur Bloecke mit Autor).
    const enriched = [];
    blocks.forEach((b) => {
      const userId = authorMap[b.key];
      if (!userId) return;
      const author = authors[String(userId)];
      if (!author) return;
      const r = b.el.getBoundingClientRect();
      if (r.height < 4) return;
      enriched.push({
        key: b.key,
        userId: String(userId),
        author,
        top: r.top - editorRect.top,
        bottom: r.bottom - editorRect.top,
      });
    });
    // Dann: in Runs gruppieren (aufeinanderfolgende Bloecke desselben Autors).
    const out = [];
    let i = 0;
    while (i < enriched.length) {
      const start = enriched[i];
      let end = start;
      let j = i + 1;
      while (j < enriched.length && enriched[j].userId === start.userId) {
        end = enriched[j];
        j += 1;
      }
      out.push({
        key: `${start.key}_run`,
        top: start.top,
        height: Math.max(14, end.bottom - start.top),
        name: start.author.name || 'Mitglied',
        color: start.author.avatar_color || '#007AFF',
        avatarUrl: start.author.avatar_url || null,
        isSelf: start.userId === String(currentUserId || ''),
      });
      i = j;
    }
    setMarks(out);
  }, [editorRef, authorMap, authors, currentUserId]);

  useEffect(() => { compute(); }, [compute, tick]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return undefined;
    const schedule = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(compute);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(editor, { childList: true, subtree: true, characterData: true });
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule);
      ro.observe(editor);
    }
    window.addEventListener('resize', schedule);
    return () => {
      mo.disconnect();
      if (ro) ro.disconnect();
      window.removeEventListener('resize', schedule);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [editorRef, compute]);

  if (marks.length === 0) return null;

  return (
    <div className="nem-author-rail" aria-hidden="true">
      {marks.map((m) => (
        <span
          key={m.key}
          className={`nem-author-run${m.isSelf ? ' is-self' : ''}`}
          style={{ top: m.top + 'px', height: m.height + 'px', '--nem-author-color': m.color }}
          title={`Geschrieben von ${m.name}`}
        >
          <span className="nem-author-avatar">
            <AvatarBadge
              name={m.name}
              color={m.color}
              avatarUrl={m.avatarUrl}
              size={14}
            />
          </span>
          <span className="nem-author-spine" aria-hidden="true" />
        </span>
      ))}
    </div>
  );
}
