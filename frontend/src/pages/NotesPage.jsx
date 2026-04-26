import { useState, useRef, useEffect, useMemo } from 'react';
import { Plus, ZoomIn, ZoomOut, Maximize2, Minimize2, Share2, Link2, Trash2, Edit2, X, CalendarDays, Sparkles, PanelsTopLeft, Workflow, LayoutGrid, ChevronLeft, Circle, CheckCircle2, Type } from 'lucide-react';
import { useNotesStore } from '../store/notesStore';
import { useFriendsStore } from '../store/friendsStore';
import { useTaskStore } from '../store/taskStore';
import { useAuthStore } from '../store/authStore';
import { api } from '../utils/api';
import '../styles/notes.css';
import { motion, AnimatePresence } from 'framer-motion';
import TaskDetailModal from '../components/TaskDetailModal';
import AvatarBadge from '../components/AvatarBadge';

function getPickerSeriesKey(task) {
  if (!task?.recurrence_rule) return null;
  const ownerId = task.user_id || 'u';
  const title = String(task.title || '').toLowerCase().trim();
  return `${ownerId}::${title}::${task.recurrence_rule}`;
}

function getPickerTaskDate(task) {
  if (!task?.date) return null;
  const parsed = new Date(String(task.date));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getPickerEventEnd(task) {
  if (!task || task.type !== 'event') return null;
  const datePart = String(task.date_end || task.date || '').slice(0, 10);
  if (!datePart) return null;

  const rawEnd = String(task.time_end || task.time || '23:59');
  const match = rawEnd.match(/(\d{1,2}):(\d{2})/);
  const hh = String(Math.min(23, Math.max(0, Number(match?.[1]) || 23))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, Number(match?.[2]) || 59))).padStart(2, '0');
  const dt = new Date(`${datePart}T${hh}:${mm}:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function isPickerEventEnded(task, nowTs = Date.now()) {
  const end = getPickerEventEnd(task);
  return !!end && end.getTime() < nowTs;
}

function deduplicatePickerTasks(tasks) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const seenIds = new Set();
  const uniqueTasks = tasks.filter((task) => {
    if (seenIds.has(task.id)) return false;
    seenIds.add(task.id);
    return true;
  });

  const seriesMap = new Map();

  for (const task of uniqueTasks) {
    const seriesKey = getPickerSeriesKey(task);
    if (!seriesKey) continue;

    const existing = seriesMap.get(seriesKey);
    if (!existing) {
      seriesMap.set(seriesKey, task);
      continue;
    }

    const taskDate = getPickerTaskDate(task);
    const existingDate = getPickerTaskDate(existing);
    if (!taskDate) continue;
    if (!existingDate) {
      seriesMap.set(seriesKey, task);
      continue;
    }

    const taskFuture = taskDate >= today;
    const existingFuture = existingDate >= today;

    if (taskFuture && !existingFuture) {
      seriesMap.set(seriesKey, task);
    } else if (taskFuture && existingFuture && taskDate < existingDate) {
      seriesMap.set(seriesKey, task);
    } else if (!taskFuture && !existingFuture && taskDate > existingDate) {
      seriesMap.set(seriesKey, task);
    }
  }

  return uniqueTasks.filter((task) => {
    const seriesKey = getPickerSeriesKey(task);
    if (!seriesKey) return true;
    return seriesMap.get(seriesKey)?.id === task.id;
  });
}

const CONNECTION_TYPES = [
  { value: 'related', label: 'Verwandt' },
  { value: 'depends_on', label: 'Abhängig von' },
  { value: 'belongs_to', label: 'Gehört zu' },
  { value: 'blocks', label: 'Blockiert' },
];

const CONNECTION_TYPE_LABELS = {
  related: 'Verwandt',
  depends_on: 'Abhängig von',
  belongs_to: 'Gehört zu',
  blocks: 'Blockiert',
};

const CANVAS_TEXT_FONT_OPTIONS = [
  { value: '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif', label: 'System (Apple)' },
  { value: '"SF Pro Rounded", -apple-system, "Helvetica Neue", sans-serif', label: 'Rounded' },
  { value: '"Georgia", "Times New Roman", serif', label: 'Georgia' },
  { value: '"Poppins", "Segoe UI", sans-serif', label: 'Poppins' },
  { value: '"JetBrains Mono", "Consolas", monospace', label: 'Mono' },
];

const NOTE_PEOPLE_CACHE_KEY = 'taski_note_people_v1';
const NOTE_VIEW_CACHE_KEY = 'taski_note_view_v1';
const NOTE_CANVAS_TEXT_CACHE_KEY = 'taski_note_canvas_text_v1';

function getUserScopedKey(baseKey) {
  if (typeof window === 'undefined') return `${baseKey}:anon`;
  try {
    const token = localStorage.getItem('token') || 'anon';
    return `${baseKey}:${token.slice(0, 24)}`;
  } catch {
    return `${baseKey}:anon`;
  }
}

function readNotePeopleCache() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(getUserScopedKey(NOTE_PEOPLE_CACHE_KEY));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeNotePeopleCache(data) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getUserScopedKey(NOTE_PEOPLE_CACHE_KEY), JSON.stringify(data || {}));
  } catch {
    // ignore quota/security errors
  }
}

function readNoteViewCache() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(getUserScopedKey(NOTE_VIEW_CACHE_KEY));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeNoteViewCache(data) {
  if (typeof window === 'undefined') return;
  try {
    const prev = readNoteViewCache();
    localStorage.setItem(
      getUserScopedKey(NOTE_VIEW_CACHE_KEY),
      JSON.stringify({ ...(prev || {}), ...(data || {}) })
    );
  } catch {
    // ignore quota/security errors
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(value) {
  let text = escapeHtml(value || '');
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
    const safeSrc = String(src || '').trim();
    if (!/^data:image\//i.test(safeSrc) && !/^https?:\/\//i.test(safeSrc)) {
      return '';
    }
    return `<img class="note-md-image" src="${safeSrc}" alt="${escapeHtml(alt || 'Bild')}" />`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  return text;
}

function markdownToHtml(content, options = {}) {
  const lines = String(content || '').split(/\r?\n/);
  let html = '';
  let inList = false;
  const interactiveChecklist = options?.interactiveChecklist === true;

  const closeList = () => {
    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };

  lines.forEach((rawLine, lineIndex) => {
    const line = String(rawLine || '');
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      return;
    }

    if (trimmed.startsWith('## ')) {
      closeList();
      html += `<h2>${renderInlineMarkdown(trimmed.slice(3))}</h2>`;
      return;
    }

    if (trimmed.startsWith('# ')) {
      closeList();
      html += `<h1>${renderInlineMarkdown(trimmed.slice(2))}</h1>`;
      return;
    }

    const checkbox = trimmed.match(/^[-*]\s\[(x|X|\s)\]\s(.+)$/);
    if (checkbox) {
      if (!inList) {
        inList = true;
        html += '<ul class="note-md-list">';
      }
      const checked = checkbox[1].toLowerCase() === 'x';
      const classes = ['note-md-checkbox'];
      if (checked) classes.push('checked');
      if (interactiveChecklist) classes.push('interactive');
      html += `<li class="${classes.join(' ')}" data-line-index="${lineIndex}"><span class="note-md-checkbox-box" aria-hidden="true"></span><span class="note-md-checkbox-label">${renderInlineMarkdown(checkbox[2])}</span></li>`;
      return;
    }

    const bullet = trimmed.match(/^[-*]\s(.+)$/);
    if (bullet) {
      if (!inList) {
        inList = true;
        html += '<ul class="note-md-list">';
      }
      html += `<li>${renderInlineMarkdown(bullet[1])}</li>`;
      return;
    }

    closeList();
    html += `<p>${renderInlineMarkdown(trimmed)}</p>`;
  });

  closeList();
  return html;
}

function toggleChecklistLine(content, lineIndex) {
  const lines = String(content || '').split(/\r?\n/);
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return content;

  const line = String(lines[lineIndex] || '');
  const match = line.match(/^(\s*[-*]\s\[)(x|X|\s)(\]\s.*)$/);
  if (!match) return content;

  const nextMark = match[2].toLowerCase() === 'x' ? ' ' : 'x';
  lines[lineIndex] = `${match[1]}${nextMark}${match[3]}`;
  return lines.join('\n');
}

function markdownToPlainText(content) {
  return String(content || '')
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '[Bild]')
    .replace(/^##\s+/gm, '')
    .replace(/^#\s+/gm, '')
    .replace(/^[-*]\s\[(x|X|\s)\]\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitChecklistCandidates(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return [];

  const normalized = trimmed
    .replace(/^[-*]\s\[(x|X|\s)\]\s+/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/^#+\s+/, '')
    .trim();

  if (!normalized) return [];

  if (normalized.includes(',') || normalized.includes(';')) {
    return normalized
      .split(/[;,]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  const words = normalized.split(/\s+/);
  if (normalized.includes(' und ') && words.length <= 8) {
    return normalized
      .split(/\bund\b/i)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return [normalized];
}

function fallbackChecklistFromText(input) {
  const text = String(input || '').trim();
  if (!text) return [];

  const source = text
    .replace(/\r/g, '\n')
    .replace(/^.*?:\s*/m, (m) => (m.length < 40 ? '' : m));

  const items = source
    .split('\n')
    .flatMap(splitChecklistCandidates)
    .map((entry) => entry.replace(/^[\d)\].\-\s]+/, '').trim())
    .filter((entry) => entry.length >= 2)
    .slice(0, 20);

  return [...new Set(items.map((entry) => entry.toLowerCase()))]
    .map((lower) => items.find((entry) => entry.toLowerCase() === lower))
    .filter(Boolean);
}

function checklistItemsToMarkdown(items = []) {
  return items
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => `- [ ] ${entry}`)
    .join('\n');
}

export default function NotesPage() {
  const { notes, createNote, updateNote, deleteNote, linkNoteToTask, shareNoteWithFriend, unshareNoteForFriend, connectNotes, disconnectNotes, getNoteConnections } = useNotesStore();
  const { friends, fetchFriends } = useFriendsStore();
  const { tasks, fetchTasks } = useTaskStore();
  const currentUser = useAuthStore((state) => state.user);

  const [zoom, setZoom] = useState(() => {
    if (typeof window === 'undefined') return 65;
    const cached = readNoteViewCache();
    if (Number.isFinite(cached?.zoom)) {
      return Math.min(220, Math.max(25, Number(cached.zoom)));
    }
    return window.innerWidth < 640 ? 92 : 65;
  });
  const [mobileViewMode, setMobileViewMode] = useState(() => {
    const cachedMode = readNoteViewCache()?.mobileViewMode;
    return cachedMode === 'canvas' ? 'canvas' : 'grid';
  }); // 'grid' | 'canvas'
  const [mobileSearch, setMobileSearch] = useState('');
  const [mobileFilter, setMobileFilter] = useState('all'); // 'all' | 'high' | 'medium' | 'low'
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [selectedNote, setSelectedNote] = useState(null);
  const [showShareModal, setShowShareModal] = useState(null);
  const [showConnectModal, setShowConnectModal] = useState(null);
  const [connectSearch, setConnectSearch] = useState('');
  const [newNote, setNewNote] = useState({ title: '', content: '', importance: 'medium', date: '', linked_task_id: null, participant_ids: [], responsible_user_id: null });
  const [isDragging, setIsDragging] = useState(null);
  const [notePositions, setNotePositions] = useState({});
  const [connections, setConnections] = useState([]);
  const [hoveredNoteId, setHoveredNoteId] = useState(null);
  const [hoveredTaskPreview, setHoveredTaskPreview] = useState(null);
  const [taskSearch, setTaskSearch] = useState('');
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [quickCreatePosition, setQuickCreatePosition] = useState(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState(null);
  const [quickConnectMode, setQuickConnectMode] = useState(false);
  const [connectionType, setConnectionType] = useState('related');
  const [actionNoteId, setActionNoteId] = useState(null);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [contextTab, setContextTab] = useState('details');
  const [noteComments, setNoteComments] = useState({});
  const [commentDraft, setCommentDraft] = useState('');
  const [notePeopleMap, setNotePeopleMap] = useState(() => readNotePeopleCache());
  const [isMobileView, setIsMobileView] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 640 : false));
  const [canvasViewport, setCanvasViewport] = useState({ left: 0, top: 0, right: 0, bottom: 0 });
  const [isCanvasFullscreen, setIsCanvasFullscreen] = useState(false);
  const [isCanvasPseudoFullscreen, setIsCanvasPseudoFullscreen] = useState(false);
  const [fsToolbarPos, setFsToolbarPos] = useState({ x: 14, y: 86 });
  const [newChecklistStatus, setNewChecklistStatus] = useState({ loading: false, error: '' });
  const [editChecklistStatus, setEditChecklistStatus] = useState({ loading: false, error: '' });
  const [canvasTexts, setCanvasTexts] = useState(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(getUserScopedKey(NOTE_CANVAS_TEXT_CACHE_KEY));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [activeCanvasTextId, setActiveCanvasTextId] = useState(null);
  const [editingCanvasTextId, setEditingCanvasTextId] = useState(null);
  const canvasRef = useRef(null);
  const canvasShellRef = useRef(null);
  const containerRef = useRef(null);
  const fsToolbarRef = useRef(null);
  const fsToolbarDragRef = useRef(null);
  const pinchStateRef = useRef(null);
  const handleTouchMoveRef = useRef(null);
  const handleCanvasTouchStartRef = useRef(null);
  const mobileViewModeRef = useRef(mobileViewMode);
  const didManualZoomRef = useRef(false);
  const didInitialViewportFitRef = useRef(false);
  const didRestoreViewportRef = useRef(false);
  const noteDragOccurredRef = useRef(false);
  // DOM refs for note elements — used for zero-re-render drag via CSS transform
  const noteElRefs = useRef({});
  // Tracks the drag start state without triggering re-renders
  const activeDragRef = useRef(null);
  // Zoom ref — holds live zoom value during gestures (avoids React re-renders per frame)
  const zoomRef = useRef(zoom);
  const canvasContentRef = useRef(null);
  const newNoteContentRef = useRef(null);
  const editNoteContentRef = useRef(null);
  const newNoteImageInputRef = useRef(null);
  const editNoteImageInputRef = useRef(null);
  const commitZoomTimerRef = useRef(null);
  const canvasTextElRefs = useRef({});
  const canvasTextLSSaveTimer = useRef(null);
  // isDragging ref mirrors state for use inside non-reactive callbacks
  const isDraggingRef = useRef(null);

  const getCanvasTextPosition = (entry) => {
    if (!entry) return { x: 0, y: 0 };
    if (entry.attached_note_id) {
      const note = notes.find((n) => String(n.id) === String(entry.attached_note_id));
      if (note) {
        const position = notePositions[note.id] || { x: note.x ?? 100, y: note.y ?? 100 };
        return {
          x: Number(position.x || 0) + Number(entry.offset_x || 0),
          y: Number(position.y || 0) + Number(entry.offset_y || 0),
        };
      }
    }
    return {
      x: Number(entry.x || 0),
      y: Number(entry.y || 0),
    };
  };

  const getAdaptiveZoom = (screenWidth, screenHeight = (typeof window !== 'undefined' ? window.innerHeight : 900)) => {
    if (screenWidth < 640) return 92;

    const baseZoom = 65;
    if (!Array.isArray(notes) || notes.length === 0) return baseZoom;

    const dims = getNoteDimensions(screenWidth);
    const spreadPaddingX = 320;
    const spreadPaddingY = 260;

    const bounds = notes.reduce((acc, note) => {
      const pos = notePositions[note.id] || { x: note.x ?? 100, y: note.y ?? 100 };
      acc.minX = Math.min(acc.minX, pos.x);
      acc.minY = Math.min(acc.minY, pos.y);
      acc.maxX = Math.max(acc.maxX, pos.x + (note.width || dims.width));
      acc.maxY = Math.max(acc.maxY, pos.y + (note.height || dims.height));
      return acc;
    }, { minX: Infinity, minY: Infinity, maxX: 0, maxY: 0 });

    const spreadWidth = Math.max(1, (bounds.maxX - bounds.minX) + spreadPaddingX);
    const spreadHeight = Math.max(1, (bounds.maxY - bounds.minY) + spreadPaddingY);

    const viewportWidth = Math.max(420, screenWidth - 120);
    const viewportHeight = Math.max(320, screenHeight - 220);
    const fitRatio = Math.min(viewportWidth / spreadWidth, viewportHeight / spreadHeight);

    // Start at 65% and zoom out only if the notes cluster exceeds the comfortable overview area.
    if (fitRatio >= 1) return baseZoom;

    const countPenalty = notes.length > 18 ? Math.min(0.18, (notes.length - 18) * 0.008) : 0;
    const autoZoom = baseZoom * fitRatio * (1 - countPenalty);
    return Math.max(35, Math.min(baseZoom, Math.round(autoZoom)));
  };

  const getNoteDimensions = (screenWidth) => {
    if (screenWidth < 640) {
      return { width: 210, height: 116 };
    }
    if (screenWidth < 1024) {
      return { width: 260, height: 140 };
    }
    if (screenWidth < 1280) {
      return { width: 280, height: 145 };
    }
    if (screenWidth < 1600) {
      return { width: 300, height: 150 };
    }
    if (screenWidth < 1920) {
      return { width: 320, height: 160 };
    }
    return { width: 340, height: 170 };
  };

  const getNewNoteDimensions = (screenWidth) => {
    if (screenWidth < 640) {
      return { width: 220, height: 122 };
    }
    if (screenWidth < 1024) {
      return { width: 280, height: 150 };
    }
    if (screenWidth < 1280) {
      return { width: 300, height: 160 };
    }
    if (screenWidth < 1440) {
      return { width: 320, height: 180 };
    }
    return { width: 380, height: 210 };
  };

  const setZoomManual = (nextZoom) => {
    didManualZoomRef.current = true;
    const clamped = Math.round(clampZoom(nextZoom));
    applyZoom(clamped);
    setZoom(clamped);
  };

  const resetZoomToViewport = () => {
    didManualZoomRef.current = false;
    const next = typeof window !== 'undefined'
      ? (window.innerWidth < 640 ? 92 : getAdaptiveZoom(window.innerWidth, window.innerHeight))
      : 100;
    applyZoom(next);
    setZoom(next);
  };

  const toggleCanvasFullscreen = async () => {
    const element = containerRef.current;
    if (!element) return;

    const activeFullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    const canUseNativeFullscreen =
      !!(element.requestFullscreen || element.webkitRequestFullscreen) &&
      !!(document.exitFullscreen || document.webkitExitFullscreen);

    try {
      if (!canUseNativeFullscreen) {
        setIsCanvasPseudoFullscreen((prev) => !prev);
        return;
      }

      if (activeFullscreenElement === element) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
        return;
      }

      if (isMobileView) {
        setMobileViewMode('canvas');
      }
      setIsCanvasPseudoFullscreen(false);

      if (element.requestFullscreen) {
        await element.requestFullscreen();
      } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
      }
    } catch {
      // Browser may reject native fullscreen on mobile. Fall back to pseudo fullscreen.
      setIsCanvasPseudoFullscreen((prev) => !prev);
    }
  };

  const startFsToolbarDrag = (event) => {
    const fullscreenActive = isCanvasFullscreen || isCanvasPseudoFullscreen;
    if (!fullscreenActive) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const toolbar = fsToolbarRef.current;
    if (!toolbar) return;

    const rect = toolbar.getBoundingClientRect();
    fsToolbarDragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };

    const move = (moveEvent) => {
      if (!fsToolbarDragRef.current) return;
      const drag = fsToolbarDragRef.current;
      const maxX = Math.max(8, window.innerWidth - drag.width - 8);
      const maxY = Math.max(8, window.innerHeight - drag.height - 8);
      const nextX = Math.min(maxX, Math.max(8, moveEvent.clientX - drag.offsetX));
      const nextY = Math.min(maxY, Math.max(8, moveEvent.clientY - drag.offsetY));
      setFsToolbarPos({ x: nextX, y: nextY });
    };

    const stop = () => {
      fsToolbarDragRef.current = null;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
    };

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
  };

  const startFsToolbarTouchDrag = (event) => {
    const fullscreenActive = isCanvasFullscreen || isCanvasPseudoFullscreen;
    if (!fullscreenActive) return;
    const touch = event.touches?.[0];
    if (!touch) return;

    const toolbar = fsToolbarRef.current;
    if (!toolbar) return;

    const rect = toolbar.getBoundingClientRect();
    fsToolbarDragRef.current = {
      offsetX: touch.clientX - rect.left,
      offsetY: touch.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };

    const move = (moveEvent) => {
      if (!fsToolbarDragRef.current) return;
      const drag = fsToolbarDragRef.current;
      const t = moveEvent.touches?.[0];
      if (!t) return;
      const maxX = Math.max(8, window.innerWidth - drag.width - 8);
      const maxY = Math.max(8, window.innerHeight - drag.height - 8);
      const nextX = Math.min(maxX, Math.max(8, t.clientX - drag.offsetX));
      const nextY = Math.min(maxY, Math.max(8, t.clientY - drag.offsetY));
      setFsToolbarPos({ x: nextX, y: nextY });
      moveEvent.preventDefault();
    };

    const stop = () => {
      fsToolbarDragRef.current = null;
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', stop);
      document.removeEventListener('touchcancel', stop);
    };

    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', stop);
    document.addEventListener('touchcancel', stop);
  };

  const persistNoteViewState = (overrides = {}) => {
    const canvas = canvasRef.current;
    writeNoteViewCache({
      zoom: Math.round(zoomRef.current),
      mobileViewMode: mobileViewModeRef.current,
      scrollLeft: canvas ? canvas.scrollLeft : undefined,
      scrollTop: canvas ? canvas.scrollTop : undefined,
      updatedAt: Date.now(),
      ...overrides,
    });
  };

  useEffect(() => {
    mobileViewModeRef.current = mobileViewMode;
  }, [mobileViewMode]);

  const refreshConnections = async (sourceNotes = notes) => {
    if (!sourceNotes.length) {
      setConnections([]);
      return;
    }

    try {
      const groups = await Promise.all(sourceNotes.map((note) => getNoteConnections(note.id)));
      const seen = new Set();
      const merged = [];

      groups.flat().forEach((connection) => {
        const firstId = connection?.note_id_1 || connection?.noteId1;
        const secondId = connection?.note_id_2 || connection?.noteId2;
        if (!firstId || !secondId) return;

        const key = [String(firstId), String(secondId)].sort().join(':');
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(connection);
      });

      setConnections(merged);
    } catch {
      setConnections([]);
    }
  };

  // Focus the viewport on the actual notes cluster on first load.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (didInitialViewportFitRef.current) return;

    const cachedView = readNoteViewCache();
    if (!didRestoreViewportRef.current && Number.isFinite(cachedView?.scrollLeft) && Number.isFinite(cachedView?.scrollTop)) {
      requestAnimationFrame(() => {
        canvas.scrollLeft = Math.max(0, Number(cachedView.scrollLeft) || 0);
        canvas.scrollTop = Math.max(0, Number(cachedView.scrollTop) || 0);
        didRestoreViewportRef.current = true;
        didInitialViewportFitRef.current = true;
      });
      return;
    }

    requestAnimationFrame(() => {
      if (notes.length === 0) {
        const CANVAS_SIZE = 4400;
        canvas.scrollLeft = Math.max(0, (CANVAS_SIZE * zoom / 100 - canvas.clientWidth) / 2);
        canvas.scrollTop = Math.max(0, (CANVAS_SIZE * zoom / 100 - canvas.clientHeight) / 2);
        didInitialViewportFitRef.current = true;
        return;
      }

      const padding = isMobileView ? 120 : 220;
      const noteWidth = isMobileView ? 240 : 300;
      const noteHeight = isMobileView ? 132 : 150;
      const bounds = notes.reduce((acc, note) => {
        const pos = notePositions[note.id] || { x: note.x ?? 100, y: note.y ?? 100 };
        acc.minX = Math.min(acc.minX, pos.x);
        acc.minY = Math.min(acc.minY, pos.y);
        acc.maxX = Math.max(acc.maxX, pos.x + (note.width || noteWidth));
        acc.maxY = Math.max(acc.maxY, pos.y + (note.height || noteHeight));
        return acc;
      }, { minX: Infinity, minY: Infinity, maxX: 0, maxY: 0 });

      const targetCenterX = ((bounds.minX + bounds.maxX) / 2) * (zoom / 100);
      const targetCenterY = ((bounds.minY + bounds.maxY) / 2) * (zoom / 100);

      canvas.scrollLeft = Math.max(0, targetCenterX - canvas.clientWidth / 2 - padding / 2);
      canvas.scrollTop = Math.max(0, targetCenterY - canvas.clientHeight / 2 - padding / 2);
      didInitialViewportFitRef.current = true;
    });
  }, [isMobileView, notePositions, notes, zoom]);

  // Register touch listeners with { passive: false } so preventDefault() works without browser warnings
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas && !container) return;

    const onCanvasTouchStart = (e) => handleCanvasTouchStartRef.current?.(e);
    const onTouchMove = (e) => handleTouchMoveRef.current?.(e);

    canvas?.addEventListener('touchstart', onCanvasTouchStart, { passive: false });
    container?.addEventListener('touchstart', onCanvasTouchStart, { passive: false });
    canvas?.addEventListener('touchmove', onTouchMove, { passive: false });
    container?.addEventListener('touchmove', onTouchMove, { passive: false });

    return () => {
      canvas?.removeEventListener('touchstart', onCanvasTouchStart);
      container?.removeEventListener('touchstart', onCanvasTouchStart);
      canvas?.removeEventListener('touchmove', onTouchMove);
      container?.removeEventListener('touchmove', onTouchMove);
    };
  }, []); // empty deps – refs always hold latest handlers

  // Load notes on mount
  useEffect(() => {
    useNotesStore.getState().fetchNotes?.({ force: true });
    fetchTasks?.({ limit: '2000', completed: 'false' }, { force: true });
    fetchFriends?.();
  }, [fetchTasks, fetchFriends]);

  // One-time backfill: push localStorage participant data to DB for old notes
  useEffect(() => {
    if (!notes.length) return;
    const BACKFILL_KEY = getUserScopedKey('taski_people_backfill_done_v1');
    if (localStorage.getItem(BACKFILL_KEY)) return;
    const localCache = readNotePeopleCache();
    if (!localCache || !Object.keys(localCache).length) return;
    localStorage.setItem(BACKFILL_KEY, '1');

    notes.forEach((note) => {
      const key = String(note.id);
      const local = localCache[key];
      if (!local) return;
      const dbParticipants = Array.isArray(note.participant_ids) ? note.participant_ids : [];
      const localParticipants = Array.isArray(local?.participant_ids) ? local.participant_ids : [];
      const localResponsible = local?.responsible_user_id || null;

      // Only backfill if DB has no participants but localStorage does
      if (dbParticipants.length === 0 && (localParticipants.length > 0 || localResponsible)) {
        updateNote(note.id, {
          participant_ids: localParticipants.map(Number).filter(Boolean),
          responsible_user_id: localResponsible ? Number(localResponsible) : null,
        }).catch(() => null);
      }
    });
  }, [notes, updateNote]);

  useEffect(() => {
    writeNotePeopleCache(notePeopleMap);
  }, [notePeopleMap]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (canvasTextLSSaveTimer.current) clearTimeout(canvasTextLSSaveTimer.current);
    canvasTextLSSaveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(getUserScopedKey(NOTE_CANVAS_TEXT_CACHE_KEY), JSON.stringify(Array.isArray(canvasTexts) ? canvasTexts : []));
      } catch {
        // ignore quota/security errors
      }
    }, 800);
  }, [canvasTexts]);

  useEffect(() => {
    const syncViewport = () => {
      setIsMobileView(window.innerWidth < 640);
      if (!didManualZoomRef.current) {
        const next = window.innerWidth < 640 ? 92 : getAdaptiveZoom(window.innerWidth, window.innerHeight);
        applyZoom(next);
        setZoom(next);
      }
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, [notes.length]);

  useEffect(() => {
    if (!canvasContextMenu) return;

    const closeMenu = (event) => {
      if (event.target?.closest('.notes-canvas-context-menu')) return;
      setCanvasContextMenu(null);
    };

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setCanvasContextMenu(null);
    };

    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [canvasContextMenu]);

  useEffect(() => {
    let cancelled = false;

    const loadConnections = async () => {
      await refreshConnections(notes);
      if (cancelled) return;
    };

    loadConnections();

    return () => {
      cancelled = true;
    };
  }, [notes, getNoteConnections]);

  // Sync notePeopleMap from DB data whenever notes change (supports shared notes recipients)
  useEffect(() => {
    if (!notes.length) return;
    setNotePeopleMap((prev) => {
      const patch = { ...prev };
      notes.forEach((note) => {
        const key = String(note.id);
        const rawParticipants = Array.isArray(note.participant_ids)
          ? note.participant_ids.map(String).filter(Boolean)
          : [];
        const dbResponsible = note.responsible_user_id
          ? String(note.responsible_user_id)
          : null;

        if (rawParticipants.length > 0 || dbResponsible) {
          const mergedParticipants = dbResponsible && !rawParticipants.includes(dbResponsible)
            ? [...rawParticipants, dbResponsible]
            : rawParticipants;
          // Always overwrite with DB data when available — this is the source of truth
          patch[key] = {
            participant_ids: mergedParticipants,
            responsible_user_id: dbResponsible,
          };
        }
        // If DB has no data but localStorage does, keep the localStorage version (patch[key] stays)
      });
      return patch;
    });
  }, [notes]);

  useEffect(() => {
    setNotePositions((prev) => {
      const next = { ...prev };

      notes.forEach((note) => {
        if (!next[note.id]) {
          next[note.id] = {
            x: note.x ?? 100,
            y: note.y ?? 100,
          };
        }
      });

      Object.keys(next).forEach((id) => {
        if (!notes.some((n) => String(n.id) === String(id))) {
          delete next[id];
        }
      });

      return next;
    });
  }, [notes]);

  useEffect(() => {
    if (!activeNoteId) return;
    const stillExists = notes.some((entry) => String(entry.id) === String(activeNoteId));
    if (!stillExists) {
      setActiveNoteId(null);
      setContextTab('details');
      setCommentDraft('');
    }
  }, [activeNoteId, notes]);

  useEffect(() => {
    if (!activeCanvasTextId) return;
    const exists = canvasTexts.some((entry) => String(entry.id) === String(activeCanvasTextId));
    if (!exists) setActiveCanvasTextId(null);
  }, [activeCanvasTextId, canvasTexts]);

  useEffect(() => {
    if (!editingCanvasTextId) return;
    const exists = canvasTexts.some((entry) => String(entry.id) === String(editingCanvasTextId));
    if (!exists) setEditingCanvasTextId(null);
  }, [editingCanvasTextId, canvasTexts]);

  useEffect(() => {
    if (!notes.length || !canvasTexts.length) return;
    const noteIds = new Set(notes.map((note) => String(note.id)));
    setCanvasTexts((prev) => prev.map((entry) => {
      if (!entry.attached_note_id) return entry;
      if (noteIds.has(String(entry.attached_note_id))) return entry;
      const currentPos = getCanvasTextPosition(entry);
      return {
        ...entry,
        attached_note_id: null,
        offset_x: 0,
        offset_y: 0,
        x: Math.round(currentPos.x),
        y: Math.round(currentPos.y),
      };
    }));
  }, [notes]);

  // Register wheel event with passive: false and zoom to mouse position
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const wheelHandler = (e) => {
      if (e.ctrlKey || e.metaKey) return;

      e.preventDefault();
      e.stopPropagation();
      didManualZoomRef.current = true;

      const zoomStep = e.deltaMode === 1 ? 8 : 5;
      const direction = e.deltaY > 0 ? -1 : 1;
      const currentZoom = zoomRef.current;
      const scaleBefore = currentZoom / 100;
      const newZoom = applyZoom(currentZoom + direction * zoomStep);
      const scaleAfter = newZoom / 100;

      if (newZoom === currentZoom) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const scrollLeftAfter = (canvas.scrollLeft + mouseX) * (scaleAfter / scaleBefore) - mouseX;
      const scrollTopAfter  = (canvas.scrollTop  + mouseY) * (scaleAfter / scaleBefore) - mouseY;

      canvas.scrollLeft = scrollLeftAfter;
      canvas.scrollTop  = scrollTopAfter;

      commitZoom();
    };

    canvas.addEventListener('wheel', wheelHandler, { passive: false, capture: true });
    return () => canvas.removeEventListener('wheel', wheelHandler, { capture: true });
  }, []); // no deps — uses zoomRef, no re-registration needed

  // Save note position on change
  const updateNotePosition = (noteId, x, y, persist = false) => {
    setNotePositions((prev) => ({
      ...prev,
      [noteId]: { x, y },
    }));

    if (persist) {
      updateNote(noteId, { x, y }).catch(() => {});
    }
  };

  const updatePeopleForNote = (noteId, patch) => {
    const key = String(noteId);
    setNotePeopleMap((prev) => {
      const current = prev[key] || { participant_ids: [], responsible_user_id: null };
      const nextResponsible = Object.prototype.hasOwnProperty.call(patch || {}, 'responsible_user_id')
        ? (patch.responsible_user_id || null)
        : current.responsible_user_id;
      const nextParticipants = Array.isArray(patch?.participant_ids) ? patch.participant_ids : current.participant_ids;
      const mergedParticipants = nextResponsible && !nextParticipants.includes(String(nextResponsible))
        ? [...nextParticipants, String(nextResponsible)]
        : nextParticipants;
      return {
        ...prev,
        [key]: {
          participant_ids: mergedParticipants,
          responsible_user_id: nextResponsible,
        },
      };
    });
  };

  const getPeopleForNote = (noteId) => {
    const key = String(noteId);
    const stored = notePeopleMap[key] || {};
    return {
      participant_ids: Array.isArray(stored.participant_ids) ? stored.participant_ids.map(String) : [],
      responsible_user_id: stored.responsible_user_id ? String(stored.responsible_user_id) : null,
    };
  };

  const friendOptions = useMemo(
    () => {
      const options = friends
        .map((friend) => ({
          id: String(friend.friend_user_id || friend.id),
          name: friend.name || `User ${friend.friend_user_id || friend.id}`,
        }))
        .filter((friend) => !!friend.id);

      if (currentUser?.id) {
        options.unshift({
          id: String(currentUser.id),
          name: currentUser.name || 'Du',
        });
      }

      const deduped = new Map();
      options.forEach((entry) => {
        if (!entry?.id || deduped.has(entry.id)) return;
        deduped.set(entry.id, entry);
      });
      return [...deduped.values()];
    },
    [currentUser, friends]
  );

  const canManageNote = (note) => {
    if (!note) return false;
    const currentUserId = String(currentUser?.id || '');
    const noteOwnerId = String(note.user_id || '');
    const responsibleId = String(note.responsible_user_id || getPeopleForNote(note.id).responsible_user_id || '');
    const permission = String(note.shared_permission || note.permission || '');
    return currentUserId !== '' && (currentUserId === noteOwnerId || currentUserId === responsibleId || permission === 'edit');
  };

  const isResponsibleForNote = (note) => {
    if (!note || !currentUser?.id) return false;
    const responsibleId = String(note.responsible_user_id || getPeopleForNote(note.id).responsible_user_id || '');
    return responsibleId !== '' && responsibleId === String(currentUser.id);
  };

  const resolvePersonName = (personId) => {
    const idText = String(personId || '');
    const found = friendOptions.find((entry) => entry.id === idText);
    if (found?.name) return found.name;
    if (currentUser?.id && String(currentUser.id) === idText) return currentUser.name || 'Du';
    return 'Verantwortlicher unbekannt';
  };

  const getPersonAvatarColor = (personId) => {
    const palette = ['#0A84FF', '#34C759', '#FF9F0A', '#FF375F', '#64D2FF', '#5856D6', '#FF6B6B', '#30B0C7'];
    const source = String(personId || '0');
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
      hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
    }
    return palette[hash % palette.length];
  };

  const toggleDraftParticipant = (setter, state, personId) => {
    const idText = String(personId);
    const current = Array.isArray(state.participant_ids) ? state.participant_ids.map(String) : [];
    const has = current.includes(idText);
    const nextParticipantIds = has ? current.filter((id) => id !== idText) : [...current, idText];

    const nextResponsible = state.responsible_user_id && !nextParticipantIds.includes(String(state.responsible_user_id))
      ? null
      : state.responsible_user_id;

    setter({
      ...state,
      participant_ids: nextParticipantIds,
      responsible_user_id: nextResponsible,
    });
  };

  const clampZoom = (value) => Math.min(220, Math.max(25, value));

  // Apply zoom directly to DOM — no React re-render during gestures
  const applyZoom = (newZoom) => {
    const clamped = clampZoom(newZoom);
    zoomRef.current = clamped;
    if (canvasContentRef.current) {
      canvasContentRef.current.style.transform = `scale(${clamped / 100})`;
    }
    return clamped;
  };

  // Commit zoom to React state after gesture ends (debounced)
  const commitZoom = () => {
    if (commitZoomTimerRef.current) clearTimeout(commitZoomTimerRef.current);
    commitZoomTimerRef.current = setTimeout(() => {
      setZoom(Math.round(zoomRef.current));
    }, 120);
  };

  const updateCanvasViewport = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = zoom / 100;
    const left = canvas.scrollLeft / scale;
    const top = canvas.scrollTop / scale;
    const right = left + (canvas.clientWidth / scale);
    const bottom = top + (canvas.clientHeight / scale);
    setCanvasViewport({ left, top, right, bottom });
  };

  const moveDragging = (clientX, clientY) => {
    const drag = isDraggingRef.current;
    if (!drag) return;

    if (drag.isPan && canvasRef.current) {
      const deltaX = clientX - drag.x;
      const deltaY = clientY - drag.y;
      canvasRef.current.scrollLeft -= deltaX;
      canvasRef.current.scrollTop -= deltaY;
      drag.x = clientX;
      drag.y = clientY;
      return;
    }

    if (drag.noteId) {
      const totalDX = clientX - drag.startClientX;
      const totalDY = clientY - drag.startClientY;
      const scale = zoomRef.current / 100;
      const el = noteElRefs.current[drag.noteId];
      if (el) {
        noteDragOccurredRef.current = true;
        el.style.transform = `translate(${totalDX / scale}px, ${totalDY / scale}px)`;
        el.style.zIndex = '999';
      }
      drag.lastClientX = clientX;
      drag.lastClientY = clientY;
    }

    if (drag.textId) {
      const totalDX = clientX - drag.startClientX;
      const totalDY = clientY - drag.startClientY;
      const scale = zoomRef.current / 100;
      const el = canvasTextElRefs.current[drag.textId];
      if (el) {
        el.style.transform = `translate(${totalDX / scale}px, ${totalDY / scale}px)`;
        el.style.zIndex = '995';
      }
      drag.lastClientX = clientX;
      drag.lastClientY = clientY;
    }
  };

  const handlePointerMove = (event) => {
    const drag = isDraggingRef.current;
    if (!drag?.isPan && !drag?.noteId && !drag?.textId) return;
    if (drag?.pointerId != null && event.pointerId !== drag.pointerId) return;
    moveDragging(event.clientX, event.clientY);
  };

  const handlePointerUp = (event) => {
    const drag = isDraggingRef.current;
    if (!drag?.isPan && !drag?.noteId && !drag?.textId) return;
    if (drag?.pointerId != null && event.pointerId !== drag.pointerId) return;

    if (drag?.noteId) {
      const el = noteElRefs.current[drag.noteId];
      const totalDX = drag.lastClientX != null ? drag.lastClientX - drag.startClientX : 0;
      const totalDY = drag.lastClientY != null ? drag.lastClientY - drag.startClientY : 0;
      const scale = zoomRef.current / 100;
      if (el) {
        el.style.transform = '';
        el.style.zIndex = '';
      }
      const base = drag.basePos;
      const finalX = Math.max(0, base.x + totalDX / scale);
      const finalY = Math.max(0, base.y + totalDY / scale);
      updateNotePosition(drag.noteId, finalX, finalY, true);
    }

    if (drag?.textId) {
      const el = canvasTextElRefs.current[drag.textId];
      const totalDX = drag.lastClientX != null ? drag.lastClientX - drag.startClientX : 0;
      const totalDY = drag.lastClientY != null ? drag.lastClientY - drag.startClientY : 0;
      const scale = zoomRef.current / 100;
      if (el) {
        el.style.transform = '';
        el.style.zIndex = '';
      }

      const finalX = Math.max(0, (drag.basePos?.x || 0) + totalDX / scale);
      const finalY = Math.max(0, (drag.basePos?.y || 0) + totalDY / scale);

      setCanvasTexts((prev) => prev.map((entry) => {
        if (String(entry.id) !== String(drag.textId)) return entry;
        if (drag.attachedNoteId) {
          const note = notes.find((n) => String(n.id) === String(drag.attachedNoteId));
          if (note) {
            const notePos = notePositions[note.id] || { x: note.x ?? 100, y: note.y ?? 100 };
            return {
              ...entry,
              offset_x: Math.round(finalX - Number(notePos.x || 0)),
              offset_y: Math.round(finalY - Number(notePos.y || 0)),
              x: Math.round(finalX),
              y: Math.round(finalY),
            };
          }
        }

        return {
          ...entry,
          x: Math.round(finalX),
          y: Math.round(finalY),
          attached_note_id: null,
          offset_x: 0,
          offset_y: 0,
        };
      }));
    }
    isDraggingRef.current = null;
    setIsDragging(null);
  };

  // Handle canvas pan
  const handleCanvasMouseDown = (e) => {
    if (e.button === 2) return;
    if (e.button !== 0) return;

    // Don't pan if clicking on a note card, button, or interactive element
    if (e.target.closest('.note-card, button, input, textarea, select, a')) return;
    if (e.target.closest('.task-preview-modal, .notes-context-panel')) return;
    
    // Pan on the canvas (including SVG connections)
    setActiveNoteId(null);
    setActiveCanvasTextId(null);
    setEditingCanvasTextId(null);
    setHoveredTaskPreview(null);
    setCanvasContextMenu(null);
    const panState = { x: e.clientX, y: e.clientY, isPan: true };
    isDraggingRef.current = panState;
    setIsDragging(panState);
  };

  const handleCanvasPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.pointerType === 'touch') return;
    if (event.target.closest('.modal-overlay')) return;
    if (event.target.closest('.note-card, button, input, textarea, select, a')) return;
    if (event.target.closest('.notes-context-panel, .task-preview-modal')) return;

    setActiveNoteId(null);
    setActiveCanvasTextId(null);
    setEditingCanvasTextId(null);
    setActionNoteId(null);
    setHoveredTaskPreview(null);
    setCanvasContextMenu(null);
    const panState = { x: event.clientX, y: event.clientY, isPan: true, pointerId: event.pointerId, pointerType: event.pointerType };
    isDraggingRef.current = panState;
    setIsDragging(panState);
  };

  const handleCanvasContextMenu = (event) => {
    if (isMobileView) return;
    if (!canvasRef.current) return;
    if (event.target.closest('.note-card, .task-preview-modal, .modal-overlay')) return;

    event.preventDefault();
    setActiveCanvasTextId(null);
    setEditingCanvasTextId(null);
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    const baseX = (clickX + canvasRef.current.scrollLeft) / (zoom / 100);
    const baseY = (clickY + canvasRef.current.scrollTop) / (zoom / 100);

    setCanvasContextMenu({
      x: event.clientX,
      y: event.clientY,
      noteX: Math.max(32, baseX - 140),
      noteY: Math.max(32, baseY - 80),
    });
  };

  const handleCanvasTouchStart = (event) => {
    if (!canvasRef.current) return;
    if (event.target.closest('.modal-overlay')) return;

    if (event.touches.length === 2) {
      const [first, second] = event.touches;
      const dx = first.clientX - second.clientX;
      const dy = first.clientY - second.clientY;
      const distance = Math.hypot(dx, dy);
      const centerX = (first.clientX + second.clientX) / 2;
      const centerY = (first.clientY + second.clientY) / 2;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const currentScale = zoomRef.current / 100;

      // Anchor canvas-coordinate under the finger center
      const tx0 = -canvas.scrollLeft;
      const ty0 = -canvas.scrollTop;
      const anchorCanvasX = (centerX - rect.left - tx0) / currentScale;
      const anchorCanvasY = (centerY - rect.top  - ty0) / currentScale;

      // Switch canvas-content to full-transform mode (no scroll during pinch)
      if (canvasContentRef.current) {
        canvasContentRef.current.style.transform =
          `translate(${tx0}px, ${ty0}px) scale(${currentScale})`;
      }
      canvas.scrollLeft = 0;
      canvas.scrollTop  = 0;
      canvas.style.overflow = 'hidden';

      pinchStateRef.current = {
        startZoom: zoomRef.current,
        startDistance: distance,
        anchorCanvasX,
        anchorCanvasY,
        lastCenterX: centerX,
        lastCenterY: centerY,
        currentTX: tx0,
        currentTY: ty0,
        rect,
      };
      isDraggingRef.current = null;
      setIsDragging(null);
      if (event.cancelable) event.preventDefault();
      return;
    }

    if (event.touches.length === 1) {
      if (event.target.closest('.note-card, .notes-context-panel')) return;
      const touch = event.touches[0];
      setActiveNoteId(null);
      setActionNoteId(null);
      const panState = { x: touch.clientX, y: touch.clientY, isPan: true, isTouch: true };
      isDraggingRef.current = panState;
      setIsDragging(panState);
    }
  };

  const handleTouchMove = (event) => {
    if (pinchStateRef.current && canvasContentRef.current && event.touches.length === 2) {
      const ps = pinchStateRef.current;
      const [first, second] = event.touches;
      const dx = first.clientX - second.clientX;
      const dy = first.clientY - second.clientY;
      const distance = Math.hypot(dx, dy);
      const centerX = (first.clientX + second.clientX) / 2;
      const centerY = (first.clientY + second.clientY) / 2;

      const rawNext = (distance / ps.startDistance) * ps.startZoom;
      const newZoom = clampZoom(rawNext);
      const newScale = newZoom / 100;
      zoomRef.current = newZoom;
      didManualZoomRef.current = true;

      // Keep anchor canvas-point fixed under fingers — pure math, no scrollLeft
      const rect = ps.rect;
      const tx = (centerX - rect.left) - ps.anchorCanvasX * newScale;
      const ty = (centerY - rect.top)  - ps.anchorCanvasY * newScale;

      ps.currentTX = tx;
      ps.currentTY = ty;
      ps.lastCenterX = centerX;
      ps.lastCenterY = centerY;

      // Single GPU-only transform update
      canvasContentRef.current.style.transform =
        `translate(${tx}px, ${ty}px) scale(${newScale})`;

      if (event.cancelable) event.preventDefault();
      return;
    }

    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    const drag = isDraggingRef.current;
    if (!drag?.isPan && !drag?.noteId && !drag?.textId) return;

    moveDragging(touch.clientX, touch.clientY);
    if (event.cancelable) event.preventDefault();
  };

  // Update refs after function definitions so useEffect always calls the latest version
  handleTouchMoveRef.current = handleTouchMove;
  handleCanvasTouchStartRef.current = handleCanvasTouchStart;

  const handleTouchEnd = () => {
    const drag = isDraggingRef.current;
    if (drag?.noteId) {
      const el = noteElRefs.current[drag.noteId];
      const totalDX = (drag.lastClientX ?? drag.startClientX) - drag.startClientX;
      const totalDY = (drag.lastClientY ?? drag.startClientY) - drag.startClientY;
      const scale = zoomRef.current / 100;
      if (el) {
        el.style.transform = '';
        el.style.zIndex = '';
      }
      const finalX = Math.max(0, drag.basePos.x + totalDX / scale);
      const finalY = Math.max(0, drag.basePos.y + totalDY / scale);
      updateNotePosition(drag.noteId, finalX, finalY, true);
    }

    if (drag?.textId) {
      const el = canvasTextElRefs.current[drag.textId];
      const totalDX = (drag.lastClientX ?? drag.startClientX) - drag.startClientX;
      const totalDY = (drag.lastClientY ?? drag.startClientY) - drag.startClientY;
      const scale = zoomRef.current / 100;
      if (el) {
        el.style.transform = '';
        el.style.zIndex = '';
      }

      const finalX = Math.max(0, (drag.basePos?.x || 0) + totalDX / scale);
      const finalY = Math.max(0, (drag.basePos?.y || 0) + totalDY / scale);

      setCanvasTexts((prev) => prev.map((entry) => {
        if (String(entry.id) !== String(drag.textId)) return entry;
        if (drag.attachedNoteId) {
          const note = notes.find((n) => String(n.id) === String(drag.attachedNoteId));
          if (note) {
            const notePos = notePositions[note.id] || { x: note.x ?? 100, y: note.y ?? 100 };
            return {
              ...entry,
              offset_x: Math.round(finalX - Number(notePos.x || 0)),
              offset_y: Math.round(finalY - Number(notePos.y || 0)),
              x: Math.round(finalX),
              y: Math.round(finalY),
            };
          }
        }

        return {
          ...entry,
          x: Math.round(finalX),
          y: Math.round(finalY),
          attached_note_id: null,
          offset_x: 0,
          offset_y: 0,
        };
      }));
    }

    if (pinchStateRef.current) {
      const ps = pinchStateRef.current;
      const canvas = canvasRef.current;
      if (canvas && canvasContentRef.current) {
        // Restore scroll+scale from the transform state
        const finalScale = zoomRef.current / 100;
        const newScrollX = Math.max(0, -ps.currentTX);
        const newScrollY = Math.max(0, -ps.currentTY);
        canvas.style.overflow = '';
        canvasContentRef.current.style.transform = `scale(${finalScale})`;
        canvas.scrollLeft = newScrollX;
        canvas.scrollTop  = newScrollY;
      }
      commitZoom();
    }
    pinchStateRef.current = null;
    isDraggingRef.current = null;
    setIsDragging(null);
  };

  const handleAutoLayout = async () => {
    if (!notes.length) return;

    const adjacency = new Map();
    notes.forEach((note) => adjacency.set(String(note.id), new Set()));

    connections.forEach((connection) => {
      const firstId = String(connection?.note_id_1 || connection?.noteId1 || '');
      const secondId = String(connection?.note_id_2 || connection?.noteId2 || '');
      if (!adjacency.has(firstId) || !adjacency.has(secondId)) return;
      adjacency.get(firstId).add(secondId);
      adjacency.get(secondId).add(firstId);
    });

    const taskById = new Map(tasks.map((task) => [String(task.id), task]));
    const visited = new Set();
    const components = [];

    notes.forEach((note) => {
      const startId = String(note.id);
      if (visited.has(startId)) return;

      const stack = [startId];
      const bucket = [];
      visited.add(startId);

      while (stack.length) {
        const currentId = stack.pop();
        bucket.push(currentId);
        const neighbors = adjacency.get(currentId) || new Set();
        neighbors.forEach((nextId) => {
          if (visited.has(nextId)) return;
          visited.add(nextId);
          stack.push(nextId);
        });
      }

      bucket.sort((left, right) => {
        const leftDegree = adjacency.get(left)?.size || 0;
        const rightDegree = adjacency.get(right)?.size || 0;
        return rightDegree - leftDegree;
      });

      const scoreByGroup = new Map();
      bucket.forEach((id) => {
        const note = notes.find((entry) => String(entry.id) === id);
        if (!note?.linked_task_id) return;
        const task = taskById.get(String(note.linked_task_id));
        const groupKey = String(task?.group_id || 'ohne-gruppe');
        scoreByGroup.set(groupKey, (scoreByGroup.get(groupKey) || 0) + 1);
      });

      const groupKey = [...scoreByGroup.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'ohne-gruppe';
      components.push({ ids: bucket, groupKey });
    });

    const grouped = components.reduce((acc, component) => {
      if (!acc.has(component.groupKey)) acc.set(component.groupKey, []);
      acc.get(component.groupKey).push(component);
      return acc;
    }, new Map());

    const layout = {};
    const dims = getNoteDimensions(window.innerWidth);
    const noteWidth = dims.width;
    const noteHeight = dims.height;
    const perRow = isMobileView ? 1 : 2;
    let baseX = 120;

    [...grouped.entries()].forEach(([, groupComponents]) => {
      let groupY = 120;

      groupComponents.forEach((component) => {
        component.ids.forEach((id, index) => {
          const row = Math.floor(index / perRow);
          const col = index % perRow;
          layout[id] = {
            x: baseX + col * (noteWidth + 46),
            y: groupY + row * (noteHeight + 54),
          };
        });

        const rows = Math.ceil(component.ids.length / perRow);
        groupY += rows * (noteHeight + 54) + 88;
      });

      baseX += perRow * (noteWidth + 46) + 170;
    });

    setNotePositions((prev) => ({ ...prev, ...layout }));

    await Promise.all(
      Object.entries(layout).map(([id, position]) =>
        updateNote(id, { x: position.x, y: position.y }).catch(() => null)
      )
    );
  };

  const handleMouseMove = (e) => {
    moveDragging(e.clientX, e.clientY);
  };

  const handleMouseUp = () => {
    if (isDragging?.noteId) {
      const pos = notePositions[isDragging.noteId];
      if (pos) {
        updateNotePosition(isDragging.noteId, pos.x, pos.y, true);
      }
    }
    setIsDragging(null);
  };

  const handleNoteMouseDown = (e, noteId) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, input, textarea, select, a')) return;
    e.stopPropagation();
    setIsDragging({ noteId, startX: e.clientX, startY: e.clientY });
  };

  const handleNotePointerDown = (event, noteId) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target.closest('button, input, textarea, select, a')) return;
    if (event.pointerType === 'touch' && event.isPrimary === false) return;

    event.stopPropagation();
    setActionNoteId(String(noteId));
    const note = notes.find((n) => String(n.id) === String(noteId));
    const basePos = notePositions[noteId] || { x: note?.x ?? 100, y: note?.y ?? 100 };
    const dragState = {
      noteId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      basePos,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    };
    isDraggingRef.current = dragState;
    setIsDragging(dragState);
  };

  const handleNoteTouchStart = (event, noteId) => {
    if (event.touches.length !== 1) return;
    if (event.target.closest('button, input, textarea, select, a')) return;

    const touch = event.touches[0];
    setActionNoteId(String(noteId));
    const note = notes.find((n) => String(n.id) === String(noteId));
    const basePos = notePositions[noteId] || { x: note?.x ?? 100, y: note?.y ?? 100 };
    const dragState = { noteId, startClientX: touch.clientX, startClientY: touch.clientY, lastClientX: touch.clientX, lastClientY: touch.clientY, basePos, isTouch: true };
    isDraggingRef.current = dragState;
    setIsDragging(dragState);
    event.stopPropagation();
  };

  const createNewNote = async () => {
    if (!newNote.title.trim()) return;

    try {
      const fallbackPosition = {
        x: 100 + notes.length * 40,
        y: 100 + notes.length * 40,
      };
      const targetPosition = quickCreatePosition || fallbackPosition;
      const newDims = getNewNoteDimensions(window.innerWidth);
      const noteData = {
        ...newNote,
        x: targetPosition.x,
        y: targetPosition.y,
        width: newDims.width,
        height: newDims.height,
      };
      const created = await createNote(noteData);
      if (created?.id) {
        const participantIds = Array.isArray(newNote.participant_ids) ? newNote.participant_ids.map(Number) : [];
        const responsibleId = newNote.responsible_user_id ? Number(newNote.responsible_user_id) : null;
        updatePeopleForNote(created.id, {
          participant_ids: participantIds.map(String),
          responsible_user_id: responsibleId ? String(responsibleId) : null,
        });
        // Backend already handled shares via participant_ids in the INSERT
      }
      setNewNote({ title: '', content: '', importance: 'medium', date: '', linked_task_id: null, participant_ids: [], responsible_user_id: null });
      setTaskSearch('');
      setQuickCreatePosition(null);
      setShowCreateModal(false);
    } catch (err) {
      console.error('Create note error:', err);
    }
  };

  const handleDeleteNote = async (id) => {
    if (confirm('Diese Note wirklich löschen?')) {
      try {
        await deleteNote(id);
      } catch (err) {
        console.error('Delete note error:', err);
      }
    }
  };

  const handleShareNote = async (noteId, friendId, permission) => {
    try {
      await shareNoteWithFriend(noteId, friendId, permission);
      setShowShareModal(null);
    } catch (err) {
      console.error('Share note error:', err);
    }
  };

  const handleConnectNotes = async (noteId1, noteId2) => {
    try {
      await connectNotes(noteId1, noteId2, connectionType);
      await refreshConnections();
      setSelectedNote(null);
      setQuickConnectMode(false);
      setShowConnectModal(null);
    } catch (err) {
      console.error('Connect notes error:', err);
    }
  };

  const handleDisconnectNotes = async (noteId1, noteId2) => {
    try {
      await disconnectNotes(noteId1, noteId2);
      await refreshConnections();
    } catch (err) {
      console.error('Disconnect notes error:', err);
    }
  };

  const handleAddComment = () => {
    if (!activeNoteId || !commentDraft.trim()) return;
    const payload = {
      id: `${Date.now()}`,
      text: commentDraft.trim(),
      createdAt: new Date().toISOString(),
    };

    setNoteComments((prev) => {
      const key = String(activeNoteId);
      return {
        ...prev,
        [key]: [...(prev[key] || []), payload],
      };
    });
    setCommentDraft('');
  };

  const syncParticipantsToShare = async (noteId, participantIds = [], responsibleId = null) => {
    if (!noteId) return;

    const ids = [...new Set([
      ...((participantIds || []).map(String)),
      responsibleId ? String(responsibleId) : null,
    ].filter(Boolean))];

    if (ids.length === 0) return;

    await Promise.all(
      ids.map((personId) =>
        shareNoteWithFriend(
          noteId,
          personId,
          String(personId) === String(responsibleId || '') ? 'edit' : 'view'
        ).catch(() => null)
      )
    );
  };

  const syncRemovedParticipants = async (
    noteId,
    previousParticipantIds = [],
    previousResponsibleId = null,
    nextParticipantIds = [],
    nextResponsibleId = null
  ) => {
    if (!noteId) return;

    const previousIds = new Set(
      [
        ...((previousParticipantIds || []).map(String)),
        previousResponsibleId ? String(previousResponsibleId) : null,
      ].filter(Boolean)
    );
    const nextIds = new Set(
      [
        ...((nextParticipantIds || []).map(String)),
        nextResponsibleId ? String(nextResponsibleId) : null,
      ].filter(Boolean)
    );

    const removedIds = [...previousIds].filter((id) => !nextIds.has(id));
    if (removedIds.length === 0) return;

    await Promise.all(
      removedIds.map((personId) =>
        unshareNoteForFriend(noteId, personId).catch(() => null)
      )
    );
  };

  const openBlankCreateModal = (position = null) => {
    setQuickCreatePosition(position);
    setNewNote({ title: '', content: '', importance: 'medium', date: '', linked_task_id: null, participant_ids: [], responsible_user_id: null });
    setTaskSearch('');
    setShowCreateModal(true);
    setToolboxOpen(false);
  };

  const createCanvasTextAtViewport = () => {
    const canvas = canvasRef.current;
    const scale = (zoomRef.current || 100) / 100;
    const centerX = canvas ? (canvas.scrollLeft + canvas.clientWidth / 2) / scale : 300;
    const centerY = canvas ? (canvas.scrollTop + canvas.clientHeight / 2) / scale : 300;
    createCanvasTextAt(centerX, centerY);
  };

  const openBlankCreateModalAtViewport = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      openBlankCreateModal();
      return;
    }

    const scale = (zoomRef.current || 100) / 100;
    const dims = getNewNoteDimensions(typeof window !== 'undefined' ? window.innerWidth : 1024);
    const centerX = (canvas.scrollLeft + canvas.clientWidth / 2) / scale;
    const centerY = (canvas.scrollTop + canvas.clientHeight / 2) / scale;

    openBlankCreateModal({
      x: Math.max(32, centerX - dims.width / 2),
      y: Math.max(32, centerY - dims.height / 2),
    });
  };

  const openCreateFromTask = (task, position = null) => {
    setQuickCreatePosition(position);
    setNewNote({
      title: task?.title || '',
      content: '',
      importance: 'medium',
      date: task?.date ? String(task.date).slice(0, 10) : '',
      linked_task_id: task?.id || null,
      participant_ids: [],
      responsible_user_id: null,
    });
    setTaskSearch(task?.title || '');
    setShowCreateModal(true);
    setToolboxOpen(false);
  };

  const applyContentCommand = (textareaRef, currentValue, setValue, command) => {
    const value = String(currentValue || '');
    const textarea = textareaRef?.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    let insertText = selected;
    let selectionStart = start;
    let selectionEnd = end;

    if (command === 'h1' || command === 'h2' || command === 'list' || command === 'checkbox') {
      const prefix = command === 'h1'
        ? '# '
        : command === 'h2'
          ? '## '
          : command === 'list'
            ? '- '
            : '- [ ] ';
      const lines = (selected || '').split('\n');
      insertText = (selected ? lines : ['']).map((line) => `${prefix}${line}`.trimEnd()).join('\n');
      if (!selected) {
        insertText = prefix;
      }
    } else if (command === 'bold') {
      insertText = `**${selected || 'Text'}**`;
      if (!selected) {
        selectionStart = start + 2;
        selectionEnd = start + 6;
      }
    } else if (command === 'italic') {
      insertText = `*${selected || 'Text'}*`;
      if (!selected) {
        selectionStart = start + 1;
        selectionEnd = start + 5;
      }
    }

    const next = value.slice(0, start) + insertText + value.slice(end);
    setValue(next);

    requestAnimationFrame(() => {
      const t = textareaRef?.current;
      if (!t) return;
      t.focus();
      const finalStart = selected ? start : selectionStart;
      const finalEnd = selected
        ? start + insertText.length
        : (selectionEnd > selectionStart ? selectionEnd : start + insertText.length);
      t.setSelectionRange(finalStart, finalEnd);
    });
  };

  const insertImageIntoContent = (event, textareaRef, currentValue, setValue) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl.startsWith('data:image/')) return;

      const value = String(currentValue || '');
      const textarea = textareaRef?.current;
      const start = textarea?.selectionStart ?? value.length;
      const end = textarea?.selectionEnd ?? value.length;
      const snippet = `\n![Bild](${dataUrl})\n`;
      const next = value.slice(0, start) + snippet + value.slice(end);
      setValue(next);

      requestAnimationFrame(() => {
        const t = textareaRef?.current;
        if (!t) return;
        const pos = start + snippet.length;
        t.focus();
        t.setSelectionRange(pos, pos);
      });
    };
    reader.readAsDataURL(file);

    event.target.value = '';
  };

  const generateChecklistForDraft = async (draft, setDraft, setStatus) => {
    const contentSource = String(draft?.content || '').trim();
    const titleSource = String(draft?.title || '').trim();
    const input = contentSource || titleSource;

    if (!input) {
      setStatus({ loading: false, error: 'Bitte zuerst Text in den Inhalt schreiben.' });
      return;
    }

    setStatus({ loading: true, error: '' });

    try {
      const response = await api.parseNoteChecklist(input);
      const aiItems = Array.isArray(response?.parsed?.items)
        ? response.parsed.items
            .map((entry) => String(entry?.text || '').trim())
            .filter(Boolean)
        : [];

      const fallbackItems = aiItems.length > 0 ? [] : fallbackChecklistFromText(input);
      const mergedItems = aiItems.length > 0 ? aiItems : fallbackItems;

      if (mergedItems.length === 0) {
        setStatus({ loading: false, error: 'Keine sinnvollen To-do-Punkte erkannt.' });
        return;
      }

      const checklistMarkdown = checklistItemsToMarkdown(mergedItems);
      setDraft({ ...draft, content: checklistMarkdown });
      setStatus({ loading: false, error: '' });
    } catch (_err) {
      const fallbackItems = fallbackChecklistFromText(input);
      if (fallbackItems.length === 0) {
        setStatus({ loading: false, error: 'KI derzeit nicht erreichbar und keine Liste erkennbar.' });
        return;
      }
      const checklistMarkdown = checklistItemsToMarkdown(fallbackItems);
      setDraft({ ...draft, content: checklistMarkdown });
      setStatus({ loading: false, error: '' });
    }
  };

  const handleChecklistToggle = async (event, note, canManage) => {
    const target = event.target?.closest?.('.note-md-checkbox');
    if (!target) return;

    event.preventDefault();
    event.stopPropagation();

    if (!canManage || !note) return;

    const lineIndex = Number(target.getAttribute('data-line-index'));
    if (!Number.isInteger(lineIndex)) return;

    const current = String(note.content || '');
    const nextContent = toggleChecklistLine(current, lineIndex);
    if (nextContent === current) return;

    try {
      await updateNote(note.id, { content: nextContent });
    } catch {
      // ignore toggle errors to keep UI interaction lightweight
    }
  };

  const createCanvasTextAt = (x, y) => {
    const id = `txt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      id,
      text: 'Neuer Text',
      x: Math.round(x),
      y: Math.round(y),
      font_family: CANVAS_TEXT_FONT_OPTIONS[0].value,
      font_size: 32,
      font_weight: 600,
      font_color: '',
      attached_note_id: null,
      offset_x: 0,
      offset_y: 0,
      created_at: Date.now(),
    };
    setCanvasTexts((prev) => [...prev, payload]);
    setActiveCanvasTextId(id);
    setEditingCanvasTextId(id);
  };

  const updateCanvasTextText = (textId, text) => {
    setCanvasTexts((prev) => prev.map((entry) => (
      String(entry.id) === String(textId)
        ? { ...entry, text: String(text || '') }
        : entry
    )));
  };

  const updateCanvasTextStyle = (textId, patch = {}) => {
    setCanvasTexts((prev) => prev.map((entry) => {
      if (String(entry.id) !== String(textId)) return entry;

      const nextSize = Number.isFinite(Number(patch.font_size))
        ? Math.min(72, Math.max(12, Number(patch.font_size)))
        : Number(entry.font_size || 28);

      return {
        ...entry,
        ...patch,
        font_size: nextSize,
      };
    }));
  };

  const removeCanvasText = (textId) => {
    setCanvasTexts((prev) => prev.filter((entry) => String(entry.id) !== String(textId)));
    if (String(activeCanvasTextId || '') === String(textId)) setActiveCanvasTextId(null);
    if (String(editingCanvasTextId || '') === String(textId)) setEditingCanvasTextId(null);
  };

  const attachCanvasTextToNote = (textId, noteId) => {
    setCanvasTexts((prev) => prev.map((entry) => {
      if (String(entry.id) !== String(textId)) return entry;

      const currentPos = getCanvasTextPosition(entry);
      if (!noteId) {
        return {
          ...entry,
          x: Math.round(currentPos.x),
          y: Math.round(currentPos.y),
          attached_note_id: null,
          offset_x: 0,
          offset_y: 0,
        };
      }

      const note = notes.find((n) => String(n.id) === String(noteId));
      if (!note) return entry;
      const notePos = notePositions[note.id] || { x: note.x ?? 100, y: note.y ?? 100 };

      return {
        ...entry,
        x: Math.round(currentPos.x),
        y: Math.round(currentPos.y),
        attached_note_id: String(noteId),
        offset_x: Math.round(currentPos.x - Number(notePos.x || 0)),
        offset_y: Math.round(currentPos.y - Number(notePos.y || 0)),
      };
    }));
  };

  const handleCanvasTextPointerDown = (event, textEntry) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target.closest('button, select, option, textarea, input')) return;
    event.stopPropagation();

    const resolved = getCanvasTextPosition(textEntry);
    const dragState = {
      textId: textEntry.id,
      attachedNoteId: textEntry.attached_note_id || null,
      basePos: resolved,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    };
    isDraggingRef.current = dragState;
    setIsDragging(dragState);
    setActiveCanvasTextId(textEntry.id);
    setCanvasContextMenu(null);
  };

  const handleQuickConnectToggle = () => {
    setQuickConnectMode((prev) => {
      if (prev) setSelectedNote(null);
      return !prev;
    });
  };

  const handleNoteDoubleClick = (event, noteId) => {
    if (event.target.closest('button, input, textarea, select, a')) return;
    if (noteDragOccurredRef.current) return;
    setActionNoteId(String(noteId));
    setActiveNoteId(noteId);
  };

  const handleNoteCardClick = async (event, noteId) => {
    if (event.target.closest('button, input, textarea, select, a')) return;

    // Ignore click if a note drag just occurred
    if (noteDragOccurredRef.current) {
      noteDragOccurredRef.current = false;
      return;
    }

    setActionNoteId(String(noteId));

    if (!quickConnectMode) return;

    event.stopPropagation();

    if (!selectedNote) {
      setSelectedNote(noteId);
      return;
    }

    if (String(selectedNote) === String(noteId)) {
      setSelectedNote(null);
      return;
    }

    await handleConnectNotes(selectedNote, noteId);
  };

  const handleTaskShortcutDragStart = (event, taskId) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/thoughts-task-id', String(taskId));
  };

  const handleCanvasDrop = (event) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/thoughts-task-id');
    if (!taskId || !canvasRef.current) return;

    const task = tasks.find((entry) => String(entry.id) === String(taskId));
    if (!task) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left + canvasRef.current.scrollLeft) / (zoom / 100) - 150;
    const y = (event.clientY - rect.top + canvasRef.current.scrollTop) / (zoom / 100) - 90;
    openCreateFromTask(task, { x: Math.max(40, x), y: Math.max(40, y) });
  };

  const getImportanceColor = (importance) => {
    const colors = {
      high: { bg: 'rgba(255, 149, 0, 0.15)', border: '#FF9500', text: '#FF9500' },
      medium: { bg: 'rgba(0, 122, 255, 0.15)', border: '#007AFF', text: '#007AFF' },
      low: { bg: 'rgba(199, 199, 204, 0.15)', border: '#c7c7cc', text: '#c7c7cc' },
    };
    return colors[importance] || colors.medium;
  };

  const isUrgent = (date) => {
    if (!date) return false;
    const noteDate = new Date(date);
    const now = new Date();
    const diffTime = noteDate - now;
    const diffDays = diffTime / (1000 * 60 * 60 * 24);
    return diffDays <= 1 && diffDays >= 0;
  };

  const linkedTask = (noteId) => {
    const note = notes.find(n => n.id === noteId);
    return note?.linked_task_id ? tasks.find(t => t.id === note.linked_task_id) : null;
  };

  const isNoteCompletedByData = (noteId) => {
    const note = notesById.get(String(noteId));
    if (!note) return false;

    if (note.completed === true || note.is_done === true) return true;

    const status = String(note.status || '').toLowerCase();
    if (status === 'done' || status === 'completed') return true;

    if (!note.linked_task_id) return false;
    const linked = tasksById.get(String(note.linked_task_id));
    return !!linked?.completed;
  };

  const toggleNoteCompletion = async (noteId, allowComplete = true) => {
    const currentlyCompleted = isNoteCompletedByData(noteId);

    if (!currentlyCompleted && !allowComplete) return;

    try {
      await updateNote(noteId, {
        completed: !currentlyCompleted,
        status: currentlyCompleted ? 'open' : 'done',
        completed_at: currentlyCompleted ? null : new Date().toISOString(),
      });
    } catch (err) {
      console.error('Toggle note completion error:', err);
    }
  };

  const notesById = useMemo(() => {
    const map = new Map();
    notes.forEach((note) => map.set(String(note.id), note));
    return map;
  }, [notes]);

  const tasksById = useMemo(() => {
    const map = new Map();
    tasks.forEach((task) => map.set(String(task.id), task));
    return map;
  }, [tasks]);

  const dependencyStateByNote = useMemo(() => {
    const state = {};

    notes.forEach((note) => {
      state[String(note.id)] = {
        blockerIds: [],
        unresolvedIds: [],
        resolvedIds: [],
        dependentIds: [],
        belongsToParentId: null,
        childIds: [],
      };
    });

    const isNoteCompleted = (noteId) => isNoteCompletedByData(noteId);

    connections.forEach((connection) => {
      const relationshipType = String(connection?.relationship_type || 'related');
      const noteId1 = String(connection?.note_id_1 || connection?.noteId1 || '');
      const noteId2 = String(connection?.note_id_2 || connection?.noteId2 || '');
      if (!noteId1 || !noteId2) return;

      if (relationshipType === 'belongs_to') {
        // noteId1 gehoert zu noteId2 (Kind -> Parent)
        if (state[noteId1]) state[noteId1].belongsToParentId = noteId2;
        if (state[noteId2]) state[noteId2].childIds.push(noteId1);
        return;
      }

      if (!['depends_on', 'blocks'].includes(relationshipType)) return;

      // blocks: note1 blockiert note2
      // depends_on: note1 haengt von note2 ab
      const blockerId = relationshipType === 'depends_on' ? noteId2 : noteId1;
      const blockedId = relationshipType === 'depends_on' ? noteId1 : noteId2;

      if (!state[blockedId] || !state[blockerId]) return;

      state[blockedId].blockerIds.push(blockerId);
      state[blockerId].dependentIds.push(blockedId);
    });

    Object.keys(state).forEach((noteId) => {
      const uniqueBlockers = [...new Set(state[noteId].blockerIds)].filter((id) => id !== noteId);
      const uniqueDependents = [...new Set(state[noteId].dependentIds)].filter((id) => id !== noteId);
      const uniqueChildren = [...new Set(state[noteId].childIds)].filter((id) => id !== noteId);
      state[noteId].blockerIds = uniqueBlockers;
      state[noteId].dependentIds = uniqueDependents;
      state[noteId].childIds = uniqueChildren;
      state[noteId].resolvedIds = uniqueBlockers.filter((id) => isNoteCompleted(id));
      state[noteId].unresolvedIds = uniqueBlockers.filter((id) => !isNoteCompleted(id));
    });

    return state;
  }, [connections, notes, notesById, tasksById]);

  const formatTaskDate = (task) => {
    const startDate = task?.date ? new Date(task.date) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) return 'Ohne Datum';

    const start = startDate.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    if (!task?.date_end) return start;

    const endDate = new Date(task.date_end);
    if (Number.isNaN(endDate.getTime())) return start;

    return `${start} bis ${endDate.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })}`;
  };

  const normalizedTaskSearch = taskSearch.trim().toLowerCase();
  const pickerTasks = useMemo(() => {
    const cleaned = deduplicatePickerTasks(tasks).filter((task) => {
      if (task.completed) return false;
      if (isPickerEventEnded(task)) return false;
      return true;
    });

    return cleaned.sort((left, right) => {
      const leftIsEvent = left.type === 'event' ? 0 : 1;
      const rightIsEvent = right.type === 'event' ? 0 : 1;
      if (leftIsEvent !== rightIsEvent) return leftIsEvent - rightIsEvent;

      const leftDate = left.date ? new Date(left.date).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDate = right.date ? new Date(right.date).getTime() : Number.MAX_SAFE_INTEGER;
      return leftDate - rightDate;
    });
  }, [tasks]);

  const visibleTasks = pickerTasks.filter((task) => {
    if (!normalizedTaskSearch) return true;

    const searchable = [task.title, task.date, task.date_end, task.type]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return searchable.includes(normalizedTaskSearch);
  });

  const selectedLinkedTask = newNote.linked_task_id
    ? pickerTasks.find((task) => String(task.id) === String(newNote.linked_task_id))
      || tasks.find((task) => String(task.id) === String(newNote.linked_task_id))
    : null;
  const shortcutTasks = visibleTasks.slice(0, 10);

  const connectedNoteIds = new Set();
  if (hoveredNoteId) {
    connections.forEach((connection) => {
      const firstId = String(connection?.note_id_1 || connection?.noteId1 || '');
      const secondId = String(connection?.note_id_2 || connection?.noteId2 || '');
      const current = String(hoveredNoteId);

      if (firstId === current) connectedNoteIds.add(secondId);
      if (secondId === current) connectedNoteIds.add(firstId);
    });
  }

  const modalConnectedEntries = showConnectModal
    ? connections
      .map((connection) => {
        const firstId = String(connection?.note_id_1 || connection?.noteId1 || '');
        const secondId = String(connection?.note_id_2 || connection?.noteId2 || '');
        const current = String(showConnectModal);
        const otherId = firstId === current ? secondId : secondId === current ? firstId : null;
        if (!otherId) return null;

        const otherNote = notes.find((entry) => String(entry.id) === otherId);
        if (!otherNote) return null;

        return {
          connectionKey: connection.id || `${firstId}-${secondId}`,
          otherId,
          otherNote,
          relationshipType: String(connection?.relationship_type || 'related'),
        };
      })
      .filter(Boolean)
    : [];

  const modalConnectedIds = new Set(modalConnectedEntries.map((entry) => String(entry.otherId)));
  const modalSourceNote = showConnectModal
    ? notes.find((entry) => String(entry.id) === String(showConnectModal))
    : null;
  const normalizedConnectSearch = String(connectSearch || '').trim().toLowerCase();
  const modalAvailableNotes = showConnectModal
    ? notes
      .filter((n) => String(n.id) !== String(showConnectModal))
      .filter((n) => !modalConnectedIds.has(String(n.id)))
      .filter((n) => {
        if (!normalizedConnectSearch) return true;
        const text = [n.title, n.content]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return text.includes(normalizedConnectSearch);
      })
    : [];

  const activeNote = activeNoteId
    ? notes.find((entry) => String(entry.id) === String(activeNoteId))
    : null;
  const activePeople = activeNote ? getPeopleForNote(activeNote.id) : { participant_ids: [], responsible_user_id: null };
  const activeDependencyState = activeNote ? (dependencyStateByNote[String(activeNote.id)] || { unresolvedIds: [] }) : { unresolvedIds: [] };
  const activeCanCompleteNow = activeDependencyState.unresolvedIds.length === 0;
  const activeIsCompleted = activeNote ? isNoteCompletedByData(activeNote.id) : false;
  const activeCanManage = activeNote ? canManageNote(activeNote) : false;
  const activeIsResponsible = activeNote ? isResponsibleForNote(activeNote) : false;
  const activeLinkedTask = activeNote ? linkedTask(activeNote.id) : null;
  const activeConnections = activeNote
    ? connections
      .map((connection) => {
        const firstId = String(connection?.note_id_1 || connection?.noteId1 || '');
        const secondId = String(connection?.note_id_2 || connection?.noteId2 || '');
        const current = String(activeNote.id);
        const otherId = firstId === current ? secondId : secondId === current ? firstId : null;
        if (!otherId) return null;
        const otherNote = notes.find((entry) => String(entry.id) === otherId);
        if (!otherNote) return null;
        return {
          id: connection.id || `${firstId}-${secondId}`,
          relationshipType: String(connection?.relationship_type || 'related'),
          otherId,
          otherNote,
        };
      })
      .filter(Boolean)
    : [];
  const activeNoteComments = activeNote ? (noteComments[String(activeNote.id)] || []) : [];
  const selectedNoteTitle = selectedNote
    ? (notesById.get(String(selectedNote))?.title || 'ausgewaehlte Note')
    : null;

  const quickConnectHeadline = !selectedNote
    ? 'Start-Note waehlen'
    : connectionType === 'depends_on'
      ? `Wovon haengt "${selectedNoteTitle}" ab?`
      : connectionType === 'blocks'
        ? `Was wird von "${selectedNoteTitle}" blockiert?`
        : connectionType === 'belongs_to'
          ? `Wozu gehoert "${selectedNoteTitle}"?`
          : `Womit ist "${selectedNoteTitle}" verwandt?`;

  const quickConnectHint = connectionType === 'depends_on'
    ? 'Reihenfolge: 1) abhaengige Note, 2) Voraussetzung/Blocker.'
    : connectionType === 'blocks'
      ? 'Reihenfolge: 1) blockierende Note, 2) blockierte Note.'
      : connectionType === 'belongs_to'
        ? 'Reihenfolge: 1) Kind-Note, 2) Parent-Note.'
        : 'Reihenfolge: 1) Start-Note, 2) verknuepfte Note.';

  const getNoteGeometry = (noteId) => {
    const note = notes.find((entry) => String(entry.id) === String(noteId));
    if (!note) return null;

    const position = notePositions[note.id] || { x: note.x ?? 100, y: note.y ?? 100 };
    const width = note.width || 300;
    const height = note.height || 150;

    return {
      x: position.x,
      y: position.y,
      width,
      height,
      centerX: position.x + width / 2,
      centerY: position.y + height / 2,
    };
  };

  const visibleNoteIds = useMemo(() => {
    const padding = 160;
    const ids = new Set();
    notes.forEach((note) => {
      const position = notePositions[note.id] || { x: note.x ?? 100, y: note.y ?? 100 };
      const width = note.width || 300;
      const height = note.height || 150;
      const noteLeft = position.x;
      const noteTop = position.y;
      const noteRight = noteLeft + width;
      const noteBottom = noteTop + height;

      const outside =
        noteRight < canvasViewport.left - padding ||
        noteLeft > canvasViewport.right + padding ||
        noteBottom < canvasViewport.top - padding ||
        noteTop > canvasViewport.bottom + padding;

      if (!outside) ids.add(String(note.id));
    });
    return ids;
  }, [notes, notePositions, canvasViewport]);

  const visibleConnections = useMemo(() => {
    return connections.filter((connection) => {
      const firstId = String(connection?.note_id_1 || connection?.noteId1 || '');
      const secondId = String(connection?.note_id_2 || connection?.noteId2 || '');
      return firstId && secondId && visibleNoteIds.has(firstId) && visibleNoteIds.has(secondId);
    });
  }, [connections, visibleNoteIds]);

  useEffect(() => {
    updateCanvasViewport();
  }, [zoom, notes.length, notePositions]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onScroll = () => {
      updateCanvasViewport();
      persistNoteViewState();
    };
    const onResize = () => updateCanvasViewport();

    canvas.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    return () => {
      canvas.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    persistNoteViewState();
  }, [mobileViewMode, zoom]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persistNoteViewState();
    };
    const onBeforeUnload = () => persistNoteViewState();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onBeforeUnload);
    };
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => {
      const active = document.fullscreenElement || document.webkitFullscreenElement;
      setIsCanvasFullscreen(active === containerRef.current);
    };

    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);
    syncFullscreenState();

    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    if (!isCanvasPseudoFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isCanvasPseudoFullscreen]);

  const canvasFullscreenActive = isCanvasFullscreen || isCanvasPseudoFullscreen;

  useEffect(() => {
    if (!showCreateModal) {
      setNewChecklistStatus({ loading: false, error: '' });
    }
  }, [showCreateModal]);

  useEffect(() => {
    if (!editingNote) {
      setEditChecklistStatus({ loading: false, error: '' });
    }
  }, [editingNote]);

  const renderConnection = (connection, index) => {
    const firstId = connection?.note_id_1 || connection?.noteId1;
    const secondId = connection?.note_id_2 || connection?.noteId2;
    const start = getNoteGeometry(firstId);
    const end = getNoteGeometry(secondId);

    if (!start || !end) return null;

    const deltaX = end.centerX - start.centerX;
    const curveOffset = Math.max(80, Math.min(Math.abs(deltaX) * 0.35, 220));
    const controlX1 = start.centerX + curveOffset;
    const controlX2 = end.centerX - curveOffset;
    const path = `M ${start.centerX} ${start.centerY} C ${controlX1} ${start.centerY - 28}, ${controlX2} ${end.centerY + 28}, ${end.centerX} ${end.centerY}`;
    const pulseDelay = `${(index % 6) * 0.35}s`;
    const isActive = hoveredNoteId && [String(firstId), String(secondId)].includes(String(hoveredNoteId));
    const isMuted = hoveredNoteId && !isActive;
    const relationshipType = String(connection?.relationship_type || 'related');

    return (
      <g
        key={connection.id || `${firstId}-${secondId}`}
        className={`connection-group type-${relationshipType} ${isActive ? 'active' : ''} ${isMuted ? 'muted' : ''}`}
        style={{ animationDelay: pulseDelay }}
      >
        <path className="connection-path connection-path-glow" d={path} />
        <path className="connection-path connection-path-core" d={path} />
        <circle className="connection-node" cx={start.centerX} cy={start.centerY} r="4.5" />
        <circle className="connection-node" cx={end.centerX} cy={end.centerY} r="4.5" />
      </g>
    );
  };

  return (
    <div
      ref={containerRef}
      className={`notes-container ${isCanvasPseudoFullscreen ? 'notes-pseudo-fullscreen' : ''}`}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* Header */}
      <div className="page-header notes-page-header">
        <div className="notes-header-main">
          <div className="notes-desktop-title">
            <h2>Notizen</h2>
            <p>Visuell planen, verbinden und direkt aus vorhandenen Terminen weiterdenken</p>
          </div>

          {/* Mobile Header Tools */}
          {isMobileView && (
            <div className="notes-mobile-tools">
              <div className="notes-mobile-view-toggle">
                <button
                  type="button"
                  className={`nmvt-btn ${mobileViewMode === 'grid' ? 'active' : ''}`}
                  onClick={() => setMobileViewMode('grid')}
                >
                  <LayoutGrid size={15} />
                  <span>Liste</span>
                </button>
                <button
                  type="button"
                  className={`nmvt-btn ${mobileViewMode === 'canvas' ? 'active' : ''}`}
                  onClick={() => setMobileViewMode('canvas')}
                >
                  <Maximize2 size={15} />
                  <span>Tafel</span>
                </button>
              </div>
              {mobileViewMode === 'canvas' && (
                <>
                  <button type="button" className="header-tool-btn" onClick={openBlankCreateModalAtViewport} title="Neue Note">
                    <Plus size={16} />
                  </button>
                  <button type="button" className="header-tool-btn" onClick={createCanvasTextAtViewport} title="Text hinzufügen">
                    <Type size={16} />
                  </button>
                  <button type="button" className={`header-tool-btn header-tool-btn-fullscreen ${canvasFullscreenActive ? 'active' : ''}`} onClick={toggleCanvasFullscreen} title={canvasFullscreenActive ? 'Vollbild schließen' : 'Vollbild öffnen'}>
                    {canvasFullscreenActive ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    <span>{canvasFullscreenActive ? 'Schließen' : 'Vollbild'}</span>
                  </button>
                  <button type="button" className={`header-tool-btn ${quickConnectMode ? 'active' : ''}`} onClick={handleQuickConnectToggle}>
                    <Link2 size={16} />
                  </button>
                  <button type="button" className="header-tool-btn" onClick={handleAutoLayout}>
                    <LayoutGrid size={16} />
                  </button>
                </>
              )}
            </div>
          )}

          {/* Desktop Mobile Tools */}
          {!isMobileView && (
            <div className="notes-mobile-tools" style={{ display: 'none' }} />
          )}

          {quickConnectMode && (
            <div className="notes-compact-status">
              {selectedNote ? 'Zweite Note wählen' : 'Quick Connect aktiv'}
            </div>
          )}
        </div>
        {/* Zoom controls — desktop only */}
        {!isMobileView && (
          <div className="notes-controls">
            <button className="zoom-btn" onClick={() => setZoomManual(zoom - 10)} title="Zoom out">
              <ZoomOut size={18} />
            </button>
            <span className="zoom-display">{zoom}%</span>
            <button className="zoom-btn" onClick={() => setZoomManual(zoom + 10)} title="Zoom in">
              <ZoomIn size={18} />
            </button>
            <button className="zoom-btn" onClick={handleAutoLayout} title="Ordnen">
              <LayoutGrid size={18} />
            </button>
            <button className="zoom-btn" onClick={resetZoomToViewport} title="Ansicht anpassen">
              <Maximize2 size={18} />
            </button>
            <button className={`zoom-btn ${canvasFullscreenActive ? 'active' : ''}`} onClick={toggleCanvasFullscreen} title={canvasFullscreenActive ? 'Vollbild schließen' : 'Vollbild öffnen'}>
              {canvasFullscreenActive ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          </div>
        )}
      </div>

      {/* ── Mobile Grid View ────────────────────────────────────────── */}
      {isMobileView && mobileViewMode === 'grid' && (() => {
        const q = mobileSearch.toLowerCase();
        const filtered = notes.filter((n) => {
          if (mobileFilter !== 'all' && n.importance !== mobileFilter) return false;
          if (q && !n.title?.toLowerCase().includes(q) && !n.content?.toLowerCase().includes(q)) return false;
          return true;
        });

        return (
          <div className="notes-mobile-list-view">
            {/* Search */}
            <div className="nmlv-search-bar">
              <input
                className="nmlv-search-input"
                placeholder="Notizen suchen…"
                value={mobileSearch}
                onChange={(e) => setMobileSearch(e.target.value)}
              />
              {mobileSearch && (
                <button className="nmlv-search-clear" onClick={() => setMobileSearch('')} type="button">
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Filter chips */}
            <div className="nmlv-filters">
              {[
                { value: 'all',    label: 'Alle' },
                { value: 'high',   label: '🔥 Hoch' },
                { value: 'medium', label: '● Mittel' },
                { value: 'low',    label: '− Niedrig' },
              ].map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className={`nmlv-filter-chip ${mobileFilter === f.value ? 'active' : ''}`}
                  onClick={() => setMobileFilter(f.value)}
                >
                  {f.label}
                </button>
              ))}
              <span className="nmlv-count">{filtered.length} Notiz{filtered.length !== 1 ? 'en' : ''}</span>
            </div>

            {/* Notes grid */}
            {filtered.length === 0 ? (
              <div className="nmlv-empty">
                <div className="nmlv-empty-icon">📝</div>
                <p>{notes.length === 0 ? 'Noch keine Notizen' : 'Keine Treffer'}</p>
                {notes.length === 0 && (
                  <button className="nmlv-empty-btn" onClick={() => openBlankCreateModal()} type="button">
                    <Plus size={16} /> Erste Notiz erstellen
                  </button>
                )}
              </div>
            ) : (
              <div className="nmlv-grid">
                {filtered.map((note) => {
                  const notePeople = getPeopleForNote(note.id);
                  const responsibleName = notePeople.responsible_user_id
                    ? resolvePersonName(notePeople.responsible_user_id)
                    : null;
                  const linked = linkedTask(note.id);
                  const urgent = isUrgent(note.date);
                  const mobileCanManage = canManageNote(note);
                  const mobileIsCompleted = isNoteCompletedByData(note.id);
                  const mobileDependencyState = dependencyStateByNote[String(note.id)] || { unresolvedIds: [] };
                  const mobileCanCompleteNow = mobileDependencyState.unresolvedIds.length === 0;
                  const mobileIsOwner = String(note.user_id || '') === String(currentUser?.id || '');
                  const mobileIsResponsible = isResponsibleForNote(note);
                  const isConnected = connections.some((c) =>
                    String(c.note_id_1 || c.noteId1) === String(note.id) ||
                    String(c.note_id_2 || c.noteId2) === String(note.id)
                  );
                  const allParticipants = notePeople.participant_ids.slice(0, 3);
                  return (
                    <div
                      key={note.id}
                      className={`nmlv-card nmlv-card-${note.importance} ${urgent ? 'nmlv-card-urgent' : ''} ${mobileIsCompleted ? 'nmlv-card-done' : ''}`}
                    >
                      <div className={`nmlv-card-strip imp-${note.importance}`} />
                      <div className="nmlv-card-body">

                        {/* Header row: title + icon actions */}
                        <div className="nmlv-card-header">
                          <h3 className="nmlv-card-title">{note.title}</h3>
                          <div className="nmlv-card-icon-actions">
                            <button
                              type="button"
                              className={`nmlv-icon-btn ${mobileIsCompleted ? 'check-done' : 'check'}`}
                              disabled={!mobileCanManage || (!mobileIsCompleted && !mobileCanCompleteNow)}
                              onClick={(e) => { e.stopPropagation(); toggleNoteCompletion(note.id, mobileCanCompleteNow); }}
                              title={mobileIsCompleted ? 'Offen' : 'Abhaken'}
                            >
                              {mobileIsCompleted ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                            </button>
                            {mobileCanManage && (
                              <button
                                type="button"
                                className="nmlv-icon-btn edit"
                                onClick={(e) => { e.stopPropagation(); const p = getPeopleForNote(note.id); setEditingNote({ ...note, participant_ids: p.participant_ids, responsible_user_id: p.responsible_user_id }); }}
                                title="Bearbeiten"
                              >
                                <Edit2 size={15} />
                              </button>
                            )}
                            {mobileIsOwner && (
                              <button
                                type="button"
                                className="nmlv-icon-btn del"
                                onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
                                title="Löschen"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Content preview */}
                        {note.content && (
                          <div
                            className="nmlv-card-content note-content-renderer"
                            dangerouslySetInnerHTML={{ __html: markdownToHtml(note.content, { interactiveChecklist: mobileCanManage }) }}
                            onClick={(event) => handleChecklistToggle(event, note, mobileCanManage)}
                          />
                        )}

                        {/* Footer row */}
                        <div className="nmlv-card-footer">
                          {note.date && (
                            <span className={`nmlv-foot-chip ${urgent ? 'urgent' : ''}`}>
                              📅 {new Date(note.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                            </span>
                          )}
                          {linked && (
                            <span className="nmlv-foot-chip">📌 {linked.title?.slice(0, 16)}</span>
                          )}
                          {isConnected && (
                            <span className="nmlv-foot-chip connect"><Link2 size={9} /> Verbunden</span>
                          )}
                          {allParticipants.length > 0 && (
                            <div className="nmlv-foot-avatars">
                              {allParticipants.map((id) => (
                                <AvatarBadge
                                  key={id}
                                  name={resolvePersonName(id)}
                                  color={id === String(notePeople.responsible_user_id) ? '#F59E0B' : '#8E8E93'}
                                  size={20}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* FAB */}
            <button className="nmlv-fab" onClick={() => openBlankCreateModal()} type="button">
              <Plus size={24} />
            </button>
          </div>
        );
      })()}

      {/* ── Canvas / Desktop Workspace ───────────────────────────────── */}
      {(!isMobileView || mobileViewMode === 'canvas') && (
      <div className="notes-workspace">
        <aside className={`notes-toolbox ${toolboxOpen ? 'open' : ''}`}>
          <div className="toolbox-header">
            <div>
              <div className="toolbox-kicker">Werkzeuge</div>
              <h2 className="toolbox-title">Schnellaktionen</h2>
            </div>
            <button className="toolbox-toggle" onClick={() => setToolboxOpen((prev) => !prev)} type="button">
              <PanelsTopLeft size={16} />
            </button>
          </div>

          <div className="toolbox-actions-grid">
            <button className="toolbox-action-card emphasis" type="button" onClick={() => openBlankCreateModal()}>
              <Plus size={18} />
              <span>Neue Note</span>
            </button>
            <button className={`toolbox-action-card ${quickConnectMode ? 'active' : ''}`} type="button" onClick={handleQuickConnectToggle}>
              <Workflow size={18} />
              <span>{quickConnectMode ? 'Connect aktiv' : 'Quick Connect'}</span>
            </button>
          </div>

          <div className="toolbox-section">
            <div className="toolbox-section-head">
              <h3>Verbindungstyp</h3>
            </div>
            <div className="connection-type-grid">
              {CONNECTION_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  className={`connection-type-option ${connectionType === type.value ? 'active' : ''}`}
                  onClick={() => setConnectionType(type.value)}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {quickConnectMode && (
            <div className="toolbox-status-card">
              <Sparkles size={16} />
              <div>
                <strong>{quickConnectHeadline}</strong>
                <span>
                  Typ: {CONNECTION_TYPE_LABELS[connectionType] || CONNECTION_TYPE_LABELS.related}. {quickConnectHint}
                </span>
              </div>
            </div>
          )}

          <div className="toolbox-section">
            <div className="toolbox-section-head">
              <h3>Termine & Aufgaben</h3>
              <span>{shortcutTasks.length}</span>
            </div>
            <p className="toolbox-helper">Desktop: auf das Board ziehen. Mobile: antippen, um daraus direkt eine Note zu bauen.</p>
            <div className="toolbox-shortcut-list">
              {shortcutTasks.length === 0 ? (
                <div className="toolbox-empty">Keine offenen Termine oder Aufgaben gefunden.</div>
              ) : (
                shortcutTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="toolbox-shortcut-card"
                    draggable
                    onDragStart={(event) => handleTaskShortcutDragStart(event, task.id)}
                    onClick={() => openCreateFromTask(task)}
                  >
                    <div className="toolbox-shortcut-topline">
                      <span className="toolbox-shortcut-title">{task.title}</span>
                      <span className={`task-picker-badge ${task.type === 'event' ? 'event' : 'task'}`}>
                        {task.type === 'event' ? 'Termin' : 'Aufgabe'}
                      </span>
                    </div>
                    <div className="toolbox-shortcut-meta">
                      <CalendarDays size={13} />
                      <span>{formatTaskDate(task)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>

        <div ref={canvasShellRef} className="notes-canvas-shell" style={{ position: 'relative' }}>
          {/* Quick Connect Banner */}
          <AnimatePresence>
            {quickConnectMode && (
              <motion.div
                className="quick-connect-banner"
                initial={{ opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ type: 'spring', damping: 22, stiffness: 300 }}
              >
                <Workflow size={16} />
                <span>{selectedNote ? '2. Note wählen zum Verbinden' : 'Quick Connect aktiv — 1. Note wählen'}</span>
                <div className="quick-connect-type-pills">
                  {CONNECTION_TYPES.map((ct) => (
                    <button
                      key={ct.value}
                      type="button"
                      className={`qc-type-pill ${connectionType === ct.value ? 'active' : ''}`}
                      onClick={() => setConnectionType(ct.value)}
                    >
                      {ct.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="qc-cancel-btn" onClick={() => { setQuickConnectMode(false); setSelectedNote(null); }}>
                  <X size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

      {/* Canvas */}
      <div
        className="notes-canvas"
        ref={canvasRef}
        onPointerDown={handleCanvasPointerDown}
        onContextMenu={handleCanvasContextMenu}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleCanvasDrop}
        style={{ cursor: isDragging?.isPan ? 'grabbing' : 'grab', touchAction: 'none' }}
      >
        <div ref={canvasContentRef} className="canvas-content" style={{ transform: `scale(${zoom / 100})`, transformOrigin: '0 0' }}>
          {/* SVG Connections */}
          <svg className="connections-svg" aria-hidden="true">
            <defs>
              <linearGradient id="connectionGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="rgba(0, 224, 255, 0.95)" />
                <stop offset="50%" stopColor="rgba(122, 92, 255, 0.9)" />
                <stop offset="100%" stopColor="rgba(255, 87, 199, 0.92)" />
              </linearGradient>
            </defs>
            {visibleConnections.map(renderConnection)}
          </svg>

          {/* Freier Canvas-Text */}
          {canvasTexts.map((entry) => {
            const attachedNote = entry.attached_note_id ? notesById.get(String(entry.attached_note_id)) : null;
            const position = attachedNote
              ? (() => { const pos = notePositions[attachedNote.id] || { x: attachedNote.x ?? 100, y: attachedNote.y ?? 100 }; return { x: Number(pos.x || 0) + Number(entry.offset_x || 0), y: Number(pos.y || 0) + Number(entry.offset_y || 0) }; })()
              : { x: Number(entry.x || 0), y: Number(entry.y || 0) };
            const isActive = String(activeCanvasTextId || '') === String(entry.id);
            const isEditing = String(editingCanvasTextId || '') === String(entry.id);
            const textStyle = {
              fontFamily: entry.font_family || CANVAS_TEXT_FONT_OPTIONS[0].value,
              fontSize: `${Math.min(72, Math.max(12, Number(entry.font_size || 32)))}px`,
              fontWeight: Number(entry.font_weight || 600) >= 700 ? 700 : Number(entry.font_weight || 600),
              color: entry.font_color || undefined,
              letterSpacing: '-0.02em',
              WebkitFontSmoothing: 'antialiased',
              MozOsxFontSmoothing: 'grayscale',
            };

            return (
              <div
                key={entry.id}
                ref={(el) => { canvasTextElRefs.current[entry.id] = el; }}
                className={`canvas-text-node ${isActive ? 'active' : ''} ${attachedNote ? 'attached' : ''}`}
                style={{ left: `${position.x}px`, top: `${position.y}px` }}
                onPointerDown={(event) => handleCanvasTextPointerDown(event, entry)}
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveCanvasTextId(entry.id);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  setActiveCanvasTextId(entry.id);
                  setEditingCanvasTextId(entry.id);
                }}
              >
                {isEditing ? (
                  <textarea
                    className="canvas-text-editor"
                    value={entry.text || ''}
                    style={textStyle}
                    onChange={(event) => updateCanvasTextText(entry.id, event.target.value)}
                    onBlur={() => setEditingCanvasTextId(null)}
                    onPointerDown={(event) => event.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <div className="canvas-text-content" style={textStyle}>{entry.text || 'Text eingeben'}</div>
                )}

                {isActive && (
                  <div className="canvas-text-toolbar" onPointerDown={(event) => event.stopPropagation()}>
                    <select
                      className="canvas-text-font-select"
                      value={entry.font_family || CANVAS_TEXT_FONT_OPTIONS[0].value}
                      onChange={(event) => updateCanvasTextStyle(entry.id, { font_family: event.target.value })}
                    >
                      {CANVAS_TEXT_FONT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      className="canvas-text-size-input"
                      min="12"
                      max="72"
                      value={Number(entry.font_size || 28)}
                      onChange={(event) => updateCanvasTextStyle(entry.id, { font_size: Number(event.target.value || 28) })}
                    />
                    <button
                      type="button"
                      className={`canvas-text-tool-btn ${Number(entry.font_weight || 500) >= 700 ? 'active' : ''}`}
                      onClick={() => updateCanvasTextStyle(entry.id, { font_weight: Number(entry.font_weight || 500) >= 700 ? 500 : 700 })}
                    >
                      Bold
                    </button>
                    <label className="canvas-text-color-label" title="Textfarbe">
                      <span className="canvas-text-color-swatch" style={{ background: entry.font_color || '#e2e8f0' }} />
                      <input
                        type="color"
                        className="canvas-text-color-input"
                        value={entry.font_color || '#e2e8f0'}
                        onChange={(event) => updateCanvasTextStyle(entry.id, { font_color: event.target.value })}
                      />
                    </label>
                    <select
                      className="canvas-text-attach-select"
                      value={entry.attached_note_id || ''}
                      onChange={(event) => attachCanvasTextToNote(entry.id, event.target.value || null)}
                    >
                      <option value="">Nicht angeheftet</option>
                      {notes.map((note) => (
                        <option key={note.id} value={note.id}>{note.title}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="canvas-text-tool-btn"
                      onClick={() => setEditingCanvasTextId(entry.id)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="canvas-text-tool-btn danger"
                      onClick={() => removeCanvasText(entry.id)}
                    >
                      X
                    </button>
                  </div>
                )}

                {attachedNote && <div className="canvas-text-anchor">An Note: {attachedNote.title}</div>}
              </div>
            );
          })}

          {/* Notes */}
          {notes.map((note) => {
              const noteId = String(note.id);
              const isHovered = hoveredNoteId && noteId === String(hoveredNoteId);
              const isConnected = hoveredNoteId && connectedNoteIds.has(noteId);
              const isMuted = hoveredNoteId && !isHovered && !isConnected;
              const dependencyState = dependencyStateByNote[noteId] || { blockerIds: [], unresolvedIds: [], resolvedIds: [] };
              const hasDependency = dependencyState.blockerIds.length > 0;
              const isBlockedByDependency = hasDependency && dependencyState.unresolvedIds.length > 0;
              const isDependencyReady = hasDependency && dependencyState.unresolvedIds.length === 0;
              const isCompleted = isNoteCompletedByData(noteId);
              const canCompleteNow = !isBlockedByDependency;
              const dependentCount = dependencyState.dependentIds?.length || 0;
              const parentNoteTitle = dependencyState.belongsToParentId
                ? (notesById.get(String(dependencyState.belongsToParentId))?.title || 'unbekannt')
                : null;
              const childCount = dependencyState.childIds?.length || 0;
              const unresolvedNames = dependencyState.unresolvedIds
                .map((id) => notesById.get(String(id))?.title || `Note ${id}`)
                .slice(0, 2);
              const moreUnresolved = Math.max(0, dependencyState.unresolvedIds.length - unresolvedNames.length);
              const notePeople = getPeopleForNote(note.id);
              const participantOnlyIds = notePeople.participant_ids.filter((id) => id !== String(notePeople.responsible_user_id));
              const visibleParticipantIds = participantOnlyIds.slice(0, 3);
              const hiddenParticipantCount = Math.max(0, participantOnlyIds.length - visibleParticipantIds.length);
              const responsibleName = notePeople.responsible_user_id ? resolvePersonName(notePeople.responsible_user_id) : null;
              const canManageThisNote = canManageNote(note);
              const isOwnerNote = String(note.user_id || '') === String(currentUser?.id || '');
              const isResponsibleNote = isResponsibleForNote(note);
              const showActions = String(actionNoteId) === String(note.id) || String(isDragging?.noteId || '') === String(note.id);

              return (
                <div
                  key={note.id}
                  ref={(el) => { noteElRefs.current[note.id] = el; }}
                  className={`note-card note-${note.importance} ${isUrgent(note.date) ? 'note-urgent' : ''} ${isHovered ? 'note-focus' : ''} ${isConnected ? 'note-connected' : ''} ${isMuted ? 'note-muted' : ''} ${isBlockedByDependency ? 'note-dependency-blocked' : ''} ${isDependencyReady ? 'note-dependency-ready' : ''} ${isCompleted ? 'note-completed' : ''}`}
                  style={{
                    left: `${(notePositions[note.id]?.x ?? note.x ?? 100)}px`,
                    top: `${(notePositions[note.id]?.y ?? note.y ?? 100)}px`,
                    width: `${note.width || getNoteDimensions(window.innerWidth).width}px`,
                    minHeight: `${note.height || getNoteDimensions(window.innerWidth).height}px`,
                  }}
                  onMouseEnter={() => setHoveredNoteId(note.id)}
                  onMouseLeave={() => setHoveredNoteId(null)}
                  onPointerDown={(event) => handleNotePointerDown(event, note.id)}
                  onClick={(event) => handleNoteCardClick(event, note.id)}
                  onDoubleClick={(event) => handleNoteDoubleClick(event, note.id)}
                >
                  <div className="note-header">
                    <h3 className="note-title">{note.title}</h3>
                    <div className="note-header-actions">
                      <button
                        type="button"
                        className={`note-complete-toggle ${isCompleted ? 'done' : ''}`}
                        title={isCompleted ? 'Als offen markieren' : (canCompleteNow ? 'Als erledigt markieren' : 'Erst Blocker erledigen')}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleNoteCompletion(note.id, canCompleteNow);
                        }}
                        disabled={!canManageThisNote || (!isCompleted && !canCompleteNow)}
                      >
                        {isCompleted ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                      </button>
                      <div
                        className="note-importance"
                        style={{ borderColor: getImportanceColor(note.importance).border }}
                      >
                        {note.importance === 'high' && '⭐'}
                        {note.importance === 'medium' && '●'}
                        {note.importance === 'low' && '−'}
                      </div>
                    </div>
                  </div>

                  <div
                    className="note-content note-content-renderer"
                    dangerouslySetInnerHTML={{ __html: markdownToHtml(note.content, { interactiveChecklist: canManageThisNote }) }}
                    onClick={(event) => handleChecklistToggle(event, note, canManageThisNote)}
                  />

                  {isResponsibleNote && (
                    <div className="note-responsible-badge">Du bist verantwortlich</div>
                  )}

                  {hasDependency && (
                    <div className={`note-dependency-state ${isBlockedByDependency ? 'blocked' : 'ready'}`}>
                      {isBlockedByDependency ? (
                        <>
                          <strong>Blockiert von</strong>
                          <span>
                            {unresolvedNames.join(', ')}
                            {moreUnresolved > 0 ? ` +${moreUnresolved}` : ''}
                          </span>
                        </>
                      ) : (
                        <>
                          <strong>Aktiv</strong>
                          <span>Abhängigkeiten erfüllt</span>
                        </>
                      )}
                    </div>
                  )}

                  {dependentCount > 0 && (
                    <div className="note-relation-state blocking" title="Diese Note blockiert andere Notes">
                      <strong>Blockiert</strong>
                      <span>{dependentCount} {dependentCount === 1 ? 'Note' : 'Notes'}</span>
                    </div>
                  )}

                  {parentNoteTitle && (
                    <div className="note-relation-state hierarchy" title={`Diese Note gehoert zu ${parentNoteTitle}`}>
                      <strong>Gehoert zu</strong>
                      <span>{parentNoteTitle}</span>
                    </div>
                  )}

                  {childCount > 0 && (
                    <div className="note-relation-state children" title="Untergeordnete Notes">
                      <strong>Enthaelt</strong>
                      <span>{childCount} {childCount === 1 ? 'Unter-Note' : 'Unter-Notes'}</span>
                    </div>
                  )}

                  {linkedTask(note.id) && (
                    <button
                      type="button"
                      className="note-linked-task"
                      onMouseEnter={(e) => {
                        const task = linkedTask(note.id);
                        const rect = e.currentTarget.getBoundingClientRect();
                        setHoveredTaskPreview({ task, noteId: note.id, x: rect.left, y: rect.bottom + 8 });
                      }}
                      onMouseLeave={() => setHoveredTaskPreview(null)}
                      onClick={() => {
                        const task = linkedTask(note.id);
                        if (task) setSelectedTask(task);
                        setHoveredTaskPreview(null);
                      }}
                      title={`Hover für Übersicht, Klick für Details: ${linkedTask(note.id)?.title}`}
                    >
                      📌 {linkedTask(note.id)?.title || 'Task verknüpft'}
                    </button>
                  )}

                  {note.date && (
                    <div className={`note-date ${isUrgent(note.date) ? 'urgent' : ''}`}>
                      📅 {new Date(note.date).toLocaleDateString('de-DE')}
                    </div>
                  )}

                  {(responsibleName || notePeople.participant_ids.length > 0) && (
                    <div className="note-people-meta">
                      <div className="note-people-avatars" aria-label="Beteiligte Personen">
                        {responsibleName && (
                          <span className="note-avatar-responsible-wrap" title={`Verantwortlich: ${responsibleName}`}>
                            <AvatarBadge
                              className="note-person-avatar note-person-avatar-responsible"
                              name={responsibleName}
                              color={getPersonAvatarColor(notePeople.responsible_user_id)}
                              size={22}
                            />
                            <span className="note-avatar-crown" aria-hidden="true">👑</span>
                          </span>
                        )}
                        {visibleParticipantIds.map((id) => (
                          <AvatarBadge
                            key={id}
                            className="note-person-avatar"
                            name={resolvePersonName(id)}
                            color={getPersonAvatarColor(id)}
                            size={22}
                          />
                        ))}
                        {hiddenParticipantCount > 0 && (
                          <span className="note-person-avatar note-avatar-more" title={`${hiddenParticipantCount} weitere Teilnehmer`}>
                            +{hiddenParticipantCount}
                          </span>
                        )}
                      </div>
                      {responsibleName && <span className="note-people-responsible-name">Verantwortlich: {responsibleName}</span>}
                    </div>
                  )}

                  <div className={`note-actions ${showActions ? 'visible' : ''}`}>
                    <button
                      className="action-btn"
                      disabled={!canManageThisNote}
                      onClick={() => {
                        const people = getPeopleForNote(note.id);
                        setEditingNote({
                          ...note,
                          participant_ids: people.participant_ids,
                          responsible_user_id: people.responsible_user_id,
                        });
                      }}
                      title="Bearbeiten"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      className="action-btn"
                      disabled={!canManageThisNote}
                      onClick={() => {
                        setConnectSearch('');
                        setShowConnectModal(note.id);
                      }}
                      title="Verknüpfen"
                    >
                      <Link2 size={14} />
                    </button>
                    {isOwnerNote && (
                      <button
                        className="action-btn"
                        onClick={() => setShowShareModal(note.id)}
                        title="Teilen"
                      >
                        <Share2 size={14} />
                      </button>
                    )}
                    {isOwnerNote && (
                      <button
                        className="action-btn delete-btn"
                        onClick={() => handleDeleteNote(note.id)}
                        title="Löschen"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {notes.length === 0 && (
          <motion.div
            key="empty-overlay"
            className="canvas-empty-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="empty-state">
              <p className="empty-state-text">Keine Notes vorhanden</p>
              <p className="empty-state-subtitle">Klicke "Neue Note", um zu beginnen</p>
            </div>
          </motion.div>
        )}
      </div>

      <motion.button
        type="button"
        className="canvas-quick-create-btn"
        title="Neue Note in der Tafel erstellen"
        onClick={openBlankCreateModalAtViewport}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.94 }}
      >
        <Plus size={18} />
      </motion.button>

      <motion.button
        type="button"
        className="canvas-fullscreen-btn"
        title={canvasFullscreenActive ? 'Vollbild beenden' : 'Tafel im Vollbild'}
        onClick={toggleCanvasFullscreen}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.94 }}
      >
        {canvasFullscreenActive ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
      </motion.button>

      {canvasFullscreenActive && (
        <div
          ref={fsToolbarRef}
          className="notes-fs-toolbar"
          style={{ left: `${fsToolbarPos.x}px`, top: `${fsToolbarPos.y}px` }}
        >
          <div className="notes-fs-toolbar-drag" onPointerDown={startFsToolbarDrag} onTouchStart={startFsToolbarTouchDrag}>
            <span className="notes-fs-toolbar-handle" />
            <span>Werkzeuge</span>
          </div>
          <div className="notes-fs-toolbar-actions">
            <button type="button" className="notes-fs-tool-btn" title="Text hinzufügen" onClick={createCanvasTextAtViewport}>
              <Type size={16} />
            </button>
            <button type="button" className="notes-fs-tool-btn" title="Neue Note" onClick={openBlankCreateModalAtViewport}>
              <Plus size={16} />
            </button>
            <button type="button" className={`notes-fs-tool-btn ${quickConnectMode ? 'active' : ''}`} title="Quick Connect" onClick={handleQuickConnectToggle}>
              <Link2 size={16} />
            </button>
            <button type="button" className="notes-fs-tool-btn" title="Auto-Layout" onClick={handleAutoLayout}>
              <LayoutGrid size={16} />
            </button>
            <button type="button" className="notes-fs-tool-btn notes-fs-tool-close" title="Vollbild schließen" onClick={toggleCanvasFullscreen}>
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {hoveredTaskPreview && hoveredTaskPreview.task && (
        <div
          className="task-preview-modal"
          style={{
            position: 'fixed',
            left: `${hoveredTaskPreview.x}px`,
            top: `${hoveredTaskPreview.y}px`,
            zIndex: 1000,
            cursor: 'pointer',
          }}
          onClick={() => {
            setSelectedTask(hoveredTaskPreview.task);
            setHoveredTaskPreview(null);
          }}
          onMouseLeave={() => setHoveredTaskPreview(null)}
        >
          <div className="task-preview-header">
            <div className="task-preview-title">{hoveredTaskPreview.task.title}</div>
            <div className="task-preview-importance" style={{ background: getImportanceColor(hoveredTaskPreview.task.importance || 'medium').bg }}>
              {hoveredTaskPreview.task.importance === 'high' && '⭐'}
              {hoveredTaskPreview.task.importance === 'medium' && '●'}
              {hoveredTaskPreview.task.importance === 'low' && '−'}
            </div>
          </div>
          <div className="task-preview-grid">
            <div className="task-preview-row">
              <span className="task-preview-label">📅 Datum:</span>
              <span className="task-preview-value">{formatTaskDate(hoveredTaskPreview.task)}</span>
            </div>
            {hoveredTaskPreview.task.type && (
              <div className="task-preview-row">
                <span className="task-preview-label">📌 Typ:</span>
                <span className="task-preview-value">{hoveredTaskPreview.task.type === 'event' ? 'Termin' : 'Aufgabe'}</span>
              </div>
            )}
            {hoveredTaskPreview.task.category && (
              <div className="task-preview-row">
                <span className="task-preview-label">🏷️ Kategorie:</span>
                <span className="task-preview-value">{hoveredTaskPreview.task.category}</span>
              </div>
            )}
          </div>
          <div className="task-preview-footer">Klick für vollständige Details</div>
        </div>
      )}

      {canvasContextMenu && (
        <div
          className="notes-canvas-context-menu"
          style={{ left: `${canvasContextMenu.x}px`, top: `${canvasContextMenu.y}px` }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="notes-canvas-menu-item"
            onClick={() => {
              openBlankCreateModal({ x: canvasContextMenu.noteX, y: canvasContextMenu.noteY });
              setCanvasContextMenu(null);
            }}
          >
            Neue Note erstellen
          </button>
          <button
            type="button"
            className="notes-canvas-menu-item"
            onClick={() => {
              createCanvasTextAt(canvasContextMenu.noteX, canvasContextMenu.noteY);
              setCanvasContextMenu(null);
            }}
          >
            Text hinzufügen
          </button>
          <button
            type="button"
            className="notes-canvas-menu-item"
            onClick={() => {
              handleQuickConnectToggle();
              setCanvasContextMenu(null);
            }}
          >
            {quickConnectMode ? 'Quick Connect beenden' : 'Quick Connect starten'}
          </button>
          <button
            type="button"
            className="notes-canvas-menu-item"
            onClick={() => {
              handleAutoLayout();
              setCanvasContextMenu(null);
            }}
          >
            Auto-Layout
          </button>
          <button
            type="button"
            className="notes-canvas-menu-item"
            onClick={() => {
              resetZoomToViewport();
              setCanvasContextMenu(null);
            }}
          >
            Zoom automatisch
          </button>
          <div className="notes-canvas-menu-divider" />
          <div className="notes-canvas-menu-hint">Weitere Optionen folgen</div>
        </div>
      )}

      <TaskDetailModal
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onUpdated={() => fetchTasks?.({ limit: '2000', completed: 'false' }, { force: true })}
      />

        <aside className={`notes-context-panel ${activeNote ? 'open' : ''}`}>
          {!activeNote ? (
            <div className="context-empty">
              <h3>Kontext</h3>
              <p>Klicke eine Note an, um Details, Kommentare, Verbindungen und Termine zu sehen.</p>
            </div>
          ) : (
            <>
              <div className="context-panel-header">
                <div>
                  <div className="context-kicker">Kontext</div>
                  <h3>{activeNote.title || 'Ohne Titel'}</h3>
                  {activeIsResponsible && <div className="context-responsible-badge">Du bist verantwortlich</div>}
                </div>
                <button type="button" className="context-close" onClick={() => setActiveNoteId(null)}>
                  <X size={14} />
                </button>
              </div>

              <div className="context-tabs" role="tablist" aria-label="Note Kontext Tabs">
                {[
                  { key: 'details', label: 'Details' },
                  { key: 'comments', label: 'Kommentare' },
                  { key: 'connections', label: 'Verbindungen' },
                  { key: 'events', label: 'Termine' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={`context-tab ${contextTab === tab.key ? 'active' : ''}`}
                    onClick={() => setContextTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {contextTab === 'details' && (
                <div className="context-pane">
                  <div className="context-detail-pill">Priorität: {activeNote.importance || 'medium'}</div>
                  <button
                    type="button"
                    className={`context-complete-toggle ${activeIsCompleted ? 'done' : ''}`}
                    onClick={() => toggleNoteCompletion(activeNote.id, activeCanCompleteNow)}
                    disabled={!activeCanManage || (!activeIsCompleted && !activeCanCompleteNow)}
                  >
                    {activeIsCompleted ? 'Erledigt' : 'Als erledigt markieren'}
                  </button>
                  {activeNote.content ? (
                    <div
                      className="context-note-body note-content-renderer"
                      dangerouslySetInnerHTML={{ __html: markdownToHtml(activeNote.content, { interactiveChecklist: activeCanManage }) }}
                      onClick={(event) => handleChecklistToggle(event, activeNote, activeCanManage)}
                    />
                  ) : (
                    <p className="context-note-body">Kein Inhalt hinterlegt.</p>
                  )}
                  <div className="context-meta-list">
                    <span>Status: {activeIsCompleted ? 'Erledigt' : 'Offen'}</span>
                    <span>Blocker offen: {activeDependencyState.unresolvedIds.length}</span>
                    <span>Deadline: {activeNote.date ? new Date(activeNote.date).toLocaleDateString('de-DE') : 'Keine'}</span>
                    <span>Verknüpft: {activeConnections.length} Notes</span>
                    <span>
                      Verantwortlich: {activePeople.responsible_user_id ? resolvePersonName(activePeople.responsible_user_id) : 'Nicht gesetzt'}
                    </span>
                    <span>
                      Teilnehmer: {activePeople.participant_ids.length > 0
                        ? activePeople.participant_ids.map((id) => resolvePersonName(id)).join(', ')
                        : 'Keine'}
                    </span>
                  </div>
                </div>
              )}

              {contextTab === 'comments' && (
                <div className="context-pane">
                  <div className="context-comments-list">
                    {activeNoteComments.length === 0 ? (
                      <p className="context-empty-line">Noch keine Kommentare zu dieser Note.</p>
                    ) : (
                      activeNoteComments.map((comment) => (
                        <div key={comment.id} className="context-comment-item">
                          <p>{comment.text}</p>
                          <span>{new Date(comment.createdAt).toLocaleString('de-DE')}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <textarea
                    className="form-textarea context-comment-input"
                    rows="3"
                    placeholder="Kommentar eingeben..."
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                  />
                  <button type="button" className="btn-primary context-comment-add" onClick={handleAddComment}>
                    Kommentar hinzufügen
                  </button>
                </div>
              )}

              {contextTab === 'connections' && (
                <div className="context-pane">
                  {activeConnections.length === 0 ? (
                    <p className="context-empty-line">Keine Verbindungen vorhanden.</p>
                  ) : (
                    <div className="context-connection-list">
                      {activeConnections.map((entry) => (
                        <div key={entry.id} className="context-connection-item">
                          <div>
                            <strong>{entry.otherNote.title}</strong>
                            <span className={`connection-type-badge type-${entry.relationshipType}`}>
                              {CONNECTION_TYPE_LABELS[entry.relationshipType] || CONNECTION_TYPE_LABELS.related}
                            </span>
                          </div>
                          <button type="button" className="unlink-btn" disabled={!activeCanManage} onClick={() => handleDisconnectNotes(activeNote.id, entry.otherId)}>
                            Entfernen
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {contextTab === 'events' && (
                <div className="context-pane">
                  {activeLinkedTask ? (
                    <div className="context-task-card">
                      <strong>{activeLinkedTask.title}</strong>
                      <span>{formatTaskDate(activeLinkedTask)}</span>
                      <button type="button" className="btn-secondary" disabled={!activeCanManage} onClick={() => updateNote(activeNote.id, { linked_task_id: null })}>
                        Termin lösen
                      </button>
                    </div>
                  ) : (
                    <p className="context-empty-line">Kein Termin verknüpft.</p>
                  )}

                  <div className="context-task-list">
                    {pickerTasks.slice(0, 6).map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        className="context-task-item"
                        onClick={() => linkNoteToTask(activeNote.id, task.id)}
                      >
                        <span>{task.title}</span>
                        <small>{formatTaskDate(task)}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
      </div>
      )} {/* end canvas/desktop workspace */}

      {/* Create Button — Desktop only */}
      <motion.button
        className="create-note-btn"
        onClick={() => openBlankCreateModal()}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <Plus size={24} />
        <span>Neue Note</span>
      </motion.button>

      {/* Create Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            className="modal-overlay note-full-overlay"
            onClick={() => setShowCreateModal(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-content create-note-modal note-editor-modal"
              onClick={(e) => e.stopPropagation()}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'tween', duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            >
              <div className="note-editor-head">
                <div className="note-editor-handle" aria-hidden="true" />
                <div className="note-editor-topbar">
                  <button type="button" className="note-editor-back-btn" onClick={() => setShowCreateModal(false)} aria-label="Zurück">
                    <ChevronLeft size={18} />
                  </button>
                  <h2 className="modal-title note-editor-title">Neue Note</h2>
                </div>
              </div>

              <div className="note-editor-body">
              <div className="form-group">
                <label className="form-label">Titel</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Note-Titel..."
                  value={newNote.title}
                  onChange={(e) => setNewNote({ ...newNote, title: e.target.value })}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">Inhalt</label>
                <div className="note-rich-toolbar" role="toolbar" aria-label="Textformatierung">
                  <button type="button" className="note-rich-btn" onClick={() => applyContentCommand(newNoteContentRef, newNote.content, (content) => setNewNote({ ...newNote, content }), 'h1')}>H1</button>
                  <button type="button" className="note-rich-btn" onClick={() => applyContentCommand(newNoteContentRef, newNote.content, (content) => setNewNote({ ...newNote, content }), 'h2')}>H2</button>
                  <button type="button" className="note-rich-btn" onClick={() => applyContentCommand(newNoteContentRef, newNote.content, (content) => setNewNote({ ...newNote, content }), 'list')}>Liste</button>
                  <button type="button" className="note-rich-btn" onClick={() => applyContentCommand(newNoteContentRef, newNote.content, (content) => setNewNote({ ...newNote, content }), 'checkbox')}>Checkbox</button>
                  <button type="button" className="note-rich-btn" onClick={() => applyContentCommand(newNoteContentRef, newNote.content, (content) => setNewNote({ ...newNote, content }), 'bold')}>Fett</button>
                  <button type="button" className="note-rich-btn" onClick={() => applyContentCommand(newNoteContentRef, newNote.content, (content) => setNewNote({ ...newNote, content }), 'italic')}>Kursiv</button>
                  <button
                    type="button"
                    className="note-rich-btn"
                    disabled={newChecklistStatus.loading}
                    onClick={() => generateChecklistForDraft(newNote, setNewNote, setNewChecklistStatus)}
                  >
                    {newChecklistStatus.loading ? 'KI ...' : 'KI To-do'}
                  </button>
                  <button type="button" className="note-rich-btn" onClick={() => newNoteImageInputRef.current?.click()}>Bild</button>
                </div>
                {newChecklistStatus.error && <div className="note-rich-status error">{newChecklistStatus.error}</div>}
                <textarea
                  ref={newNoteContentRef}
                  className="form-textarea"
                  placeholder="Deine Gedanken..."
                  value={newNote.content}
                  onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
                  rows="4"
                />
                <input
                  ref={newNoteImageInputRef}
                  type="file"
                  accept="image/*"
                  className="note-rich-image-input"
                  onChange={(event) => insertImageIntoContent(event, newNoteContentRef, newNote.content, (content) => setNewNote({ ...newNote, content }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Wichtigkeit</label>
                <div className="importance-selector">
                  {['high', 'medium', 'low'].map((level) => (
                    <label key={level} className={`importance-option ${newNote.importance === level ? 'active' : ''}`}>
                      <input
                        type="radio"
                        name="importance"
                        value={level}
                        checked={newNote.importance === level}
                        onChange={(e) => setNewNote({ ...newNote, importance: e.target.value })}
                      />
                      <span className="importance-icon">
                        {level === 'high' && '⭐ Hoch'}
                        {level === 'medium' && '● Mittel'}
                        {level === 'low' && '− Niedrig'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Deadline (optional)</label>
                <input
                  type="date"
                  className="form-input"
                  value={newNote.date}
                  onChange={(e) => setNewNote({ ...newNote, date: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Teilnehmer</label>
                <div className="people-picker-grid">
                  {friendOptions.length === 0 ? (
                    <div className="people-empty">Keine Freunde verfügbar.</div>
                  ) : (
                    friendOptions.map((friend) => {
                      const isActive = (newNote.participant_ids || []).includes(friend.id);
                      return (
                        <button
                          key={friend.id}
                          type="button"
                          className={`person-option ${isActive ? 'active' : ''}`}
                          onClick={() => toggleDraftParticipant(setNewNote, newNote, friend.id)}
                        >
                          {friend.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Verantwortlich</label>
                <select
                  className="form-input"
                  value={newNote.responsible_user_id || ''}
                  onChange={(e) => setNewNote({ ...newNote, responsible_user_id: e.target.value || null })}
                >
                  <option value="">Niemand</option>
                  {(newNote.participant_ids || []).map((personId) => (
                    <option key={personId} value={personId}>
                      {resolvePersonName(personId)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Termin verknüpfen (optional)</label>
                <div className="task-picker-shell">
                  <div className="task-picker-toolbar">
                    <input
                      type="text"
                      className="form-input task-search-input"
                      placeholder="Termin oder Aufgabe suchen..."
                      value={taskSearch}
                      onChange={(e) => setTaskSearch(e.target.value)}
                    />
                    <div className="task-picker-meta">
                      {visibleTasks.length} Einträge
                    </div>
                  </div>

                  {selectedLinkedTask && (
                    <button
                      type="button"
                      className="selected-task-pill"
                      onClick={() => setNewNote({ ...newNote, linked_task_id: null })}
                    >
                      <span>{selectedLinkedTask.title}</span>
                      <span>{formatTaskDate(selectedLinkedTask)}</span>
                      <X size={14} />
                    </button>
                  )}

                  <div className="task-picker-list" role="listbox" aria-label="Eigene Termine und Aufgaben">
                    <button
                      type="button"
                      className={`task-picker-card task-picker-clear ${!newNote.linked_task_id ? 'active' : ''}`}
                      onClick={() => setNewNote({ ...newNote, linked_task_id: null })}
                    >
                      <div className="task-picker-card-header">
                        <span className="task-picker-title">Ohne Verknüpfung</span>
                        <span className="task-picker-badge neutral">Frei</span>
                      </div>
                      <div className="task-picker-subline">Diese Note bleibt unabhängig von einem Termin.</div>
                    </button>

                    {visibleTasks.map((task) => {
                      const isSelected = String(newNote.linked_task_id || '') === String(task.id);
                      return (
                        <button
                          key={task.id}
                          type="button"
                          className={`task-picker-card ${isSelected ? 'active' : ''}`}
                          onClick={() => setNewNote({ ...newNote, linked_task_id: task.id })}
                        >
                          <div className="task-picker-card-header">
                            <span className="task-picker-title">{task.title}</span>
                            <span className={`task-picker-badge ${task.type === 'event' ? 'event' : 'task'}`}>
                              {task.type === 'event' ? 'Termin' : 'Aufgabe'}
                            </span>
                          </div>
                          <div className="task-picker-subline">{formatTaskDate(task)}</div>
                        </button>
                      );
                    })}

                    {visibleTasks.length === 0 && (
                      <div className="task-picker-empty">
                        Keine Termine oder Aufgaben passen zur Suche.
                      </div>
                    )}
                  </div>
                </div>
              </div>
              </div>{/* end note-editor-body */}

              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Abbrechen
                </button>
                <button className="btn-primary" onClick={createNewNote}>
                  Note erstellen
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingNote && (
          <motion.div
            className="modal-overlay note-full-overlay"
            onClick={() => setEditingNote(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-content note-editor-modal edit-note-modal"
              onClick={(e) => e.stopPropagation()}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'tween', duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            >
              <div className="note-editor-head">
                <div className="note-editor-handle" aria-hidden="true" />
                <div className="note-editor-topbar">
                  <button type="button" className="note-editor-back-btn" onClick={() => setEditingNote(null)} aria-label="Zurück">
                    <ChevronLeft size={18} />
                  </button>
                  <h2 className="modal-title note-editor-title">Note bearbeiten</h2>
                </div>
              </div>

              <div className="note-editor-body">
              <div className="form-group">
                <label className="form-label">Titel</label>
                <input
                  type="text"
                  className="form-input"
                  value={editingNote.title}
                  onChange={(e) => setEditingNote({ ...editingNote, title: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Inhalt</label>
                <div className="note-rich-toolbar" role="toolbar" aria-label="Textformatierung">
                  <button type="button" className="note-rich-btn" onClick={() => applyContentCommand(editNoteContentRef, editingNote.content, (content) => setEditingNote({ ...editingNote, content }), 'h1')}>H1</button>
                  <button type="button" className="note-rich-btn" onClick={() => applyContentCommand(editNoteContentRef, editingNote.content, (content) => setEditingNote({ ...editingNote, content }), 'h2')}>H2</button>
                  <button type="button" className="note-rich-btn" onClick={() => applyContentCommand(editNoteContentRef, editingNote.content, (content) => setEditingNote({ ...editingNote, content }), 'list')}>Liste</button>
                  <button type="button" className="note-rich-btn" onClick={() => applyContentCommand(editNoteContentRef, editingNote.content, (content) => setEditingNote({ ...editingNote, content }), 'checkbox')}>Checkbox</button>
                  <button type="button" className="note-rich-btn" onClick={() => applyContentCommand(editNoteContentRef, editingNote.content, (content) => setEditingNote({ ...editingNote, content }), 'bold')}>Fett</button>
                  <button type="button" className="note-rich-btn" onClick={() => applyContentCommand(editNoteContentRef, editingNote.content, (content) => setEditingNote({ ...editingNote, content }), 'italic')}>Kursiv</button>
                  <button
                    type="button"
                    className="note-rich-btn"
                    disabled={editChecklistStatus.loading}
                    onClick={() => generateChecklistForDraft(editingNote, setEditingNote, setEditChecklistStatus)}
                  >
                    {editChecklistStatus.loading ? 'KI ...' : 'KI To-do'}
                  </button>
                  <button type="button" className="note-rich-btn" onClick={() => editNoteImageInputRef.current?.click()}>Bild</button>
                </div>
                {editChecklistStatus.error && <div className="note-rich-status error">{editChecklistStatus.error}</div>}
                <textarea
                  ref={editNoteContentRef}
                  className="form-textarea"
                  value={editingNote.content}
                  onChange={(e) => setEditingNote({ ...editingNote, content: e.target.value })}
                  rows="4"
                />
                <input
                  ref={editNoteImageInputRef}
                  type="file"
                  accept="image/*"
                  className="note-rich-image-input"
                  onChange={(event) => insertImageIntoContent(event, editNoteContentRef, editingNote.content, (content) => setEditingNote({ ...editingNote, content }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Wichtigkeit</label>
                <div className="importance-selector">
                  {['high', 'medium', 'low'].map((level) => (
                    <label key={level} className={`importance-option ${editingNote.importance === level ? 'active' : ''}`}>
                      <input
                        type="radio"
                        name="importance"
                        value={level}
                        checked={editingNote.importance === level}
                        onChange={(e) => setEditingNote({ ...editingNote, importance: e.target.value })}
                      />
                      <span className="importance-icon">
                        {level === 'high' && '⭐ Hoch'}
                        {level === 'medium' && '● Mittel'}
                        {level === 'low' && '− Niedrig'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Deadline</label>
                <input
                  type="date"
                  className="form-input"
                  value={editingNote.date}
                  onChange={(e) => setEditingNote({ ...editingNote, date: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Teilnehmer</label>
                <div className="people-picker-grid">
                  {friendOptions.length === 0 ? (
                    <div className="people-empty">Keine Freunde verfügbar.</div>
                  ) : (
                    friendOptions.map((friend) => {
                      const selected = Array.isArray(editingNote.participant_ids) ? editingNote.participant_ids.map(String) : [];
                      const isActive = selected.includes(friend.id);
                      return (
                        <button
                          key={friend.id}
                          type="button"
                          className={`person-option ${isActive ? 'active' : ''}`}
                          onClick={() => toggleDraftParticipant(setEditingNote, editingNote, friend.id)}
                        >
                          {friend.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Verantwortlich</label>
                <select
                  className="form-input"
                  value={editingNote.responsible_user_id || ''}
                  onChange={(e) => setEditingNote({ ...editingNote, responsible_user_id: e.target.value || null })}
                >
                  <option value="">Niemand</option>
                  {(editingNote.participant_ids || []).map((personId) => (
                    <option key={personId} value={personId}>
                      {resolvePersonName(personId)}
                    </option>
                  ))}
                </select>
              </div>
              </div>{/* end note-editor-body */}

              <div className="modal-actions">
                <button
                  className="btn-secondary"
                  onClick={() => setEditingNote(null)}
                >
                  Abbrechen
                </button>
                <button
                  className="btn-primary"
                  onClick={async () => {
                    try {
                      const nextParticipantIds = Array.isArray(editingNote.participant_ids) ? editingNote.participant_ids.map(Number) : [];
                      const nextResponsibleId = editingNote.responsible_user_id ? Number(editingNote.responsible_user_id) : null;

                      await updateNote(editingNote.id, {
                        title: editingNote.title,
                        content: editingNote.content,
                        importance: editingNote.importance,
                        date: editingNote.date || null,
                        participant_ids: nextParticipantIds,
                        responsible_user_id: nextResponsibleId,
                      });
                      updatePeopleForNote(editingNote.id, {
                        participant_ids: nextParticipantIds.map(String),
                        responsible_user_id: nextResponsibleId ? String(nextResponsibleId) : null,
                      });
                      setEditingNote(null);
                    } catch (err) {
                      console.error('Update error:', err);
                    }
                  }}
                >
                  Speichern
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share Modal */}
      <AnimatePresence>
        {showShareModal && (
          <motion.div
            className="modal-overlay"
            onClick={() => setShowShareModal(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-content"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <h2 className="modal-title">Note teilen</h2>
              <p className="modal-description">Mit welchem Freund möchtest du diese Note teilen?</p>

              <div className="friends-list">
                {friends.length === 0 ? (
                  <p className="no-friends">Keine Freunde verfügbar</p>
                ) : (
                  friends.map((friend) => (
                    <div key={friend.id} className="friend-item">
                      <div className="friend-info">
                        <span className="friend-name">{friend.name}</span>
                      </div>
                      <div className="permission-buttons">
                        <button
                          className="perm-btn view"
                          onClick={() => handleShareNote(showShareModal, friend.id, 'view')}
                        >
                          Ansicht
                        </button>
                        <button
                          className="perm-btn comment"
                          onClick={() => handleShareNote(showShareModal, friend.id, 'comment')}
                        >
                          Kommentar
                        </button>
                        <button
                          className="perm-btn edit"
                          onClick={() => handleShareNote(showShareModal, friend.id, 'edit')}
                        >
                          Bearbeiten
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowShareModal(null)}>
                  Schließen
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Connect Notes Modal */}
      <AnimatePresence>
        {showConnectModal && (
          <motion.div
            className="modal-overlay"
            onClick={() => {
              setShowConnectModal(null);
              setConnectSearch('');
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-content note-editor-modal connect-note-modal"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <div className="note-editor-head connect-modal-head">
                <div className="note-editor-handle" aria-hidden="true" />
                <div className="note-editor-topbar">
                  <button
                    type="button"
                    className="note-editor-back-btn"
                    onClick={() => {
                      setShowConnectModal(null);
                      setConnectSearch('');
                    }}
                    aria-label="Zurück"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <h2 className="modal-title note-editor-title">Note verknüpfen</h2>
                </div>
              </div>

              <div className="note-editor-body">

              <p className="modal-description">Mit welcher anderen Note möchtest du diese verknüpfen?</p>

              {modalSourceNote && (
                <div className="connect-source-note">
                  <div className="connect-source-kicker">Ausgangs-Note</div>
                  <div className="connect-source-title">{modalSourceNote.title}</div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Verbindungstyp</label>
                <div className="connection-type-grid">
                  {CONNECTION_TYPES.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      className={`connection-type-option ${connectionType === type.value ? 'active' : ''}`}
                      onClick={() => setConnectionType(type.value)}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Note suchen</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Titel oder Inhalt"
                  value={connectSearch}
                  onChange={(e) => setConnectSearch(e.target.value)}
                />
              </div>

              {modalConnectedEntries.length > 0 && (
                <>
                  <p className="modal-description">Bestehende Verknüpfungen</p>
                  <div className="notes-list">
                    {modalConnectedEntries.map((entry) => (
                      <div key={entry.connectionKey} className="note-item note-item-connected">
                        <div>
                          <div className="note-item-title">{entry.otherNote.title}</div>
                          <div className={`connection-type-badge type-${entry.relationshipType}`}>
                            {CONNECTION_TYPE_LABELS[entry.relationshipType] || CONNECTION_TYPE_LABELS.related}
                          </div>
                          <div className="note-item-preview">{markdownToPlainText(entry.otherNote.content).substring(0, 50)}...</div>
                        </div>
                        <button
                          type="button"
                          className="unlink-btn"
                          onClick={() => handleDisconnectNotes(showConnectModal, entry.otherId)}
                        >
                          Entfernen
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="notes-list">
                {modalAvailableNotes.map((note) => (
                  <div
                    key={note.id}
                    className="note-item note-item-connectable"
                  >
                    <div>
                      <div className="note-item-title">{note.title}</div>
                      <div className="note-item-preview">{markdownToPlainText(note.content).substring(0, 50)}...</div>
                    </div>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => handleConnectNotes(showConnectModal, note.id)}
                    >
                      Verbinden
                    </button>
                  </div>
                ))}

                {modalAvailableNotes.length === 0 && (
                  <div className="task-picker-empty">Keine passenden Notes gefunden.</div>
                )}
              </div>

              </div>{/* end note-editor-body */}

              <div className="modal-actions">
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setShowConnectModal(null);
                    setConnectSearch('');
                  }}
                >
                  Abbrechen
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

