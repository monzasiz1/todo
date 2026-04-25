import { useState, useRef, useEffect, useMemo } from 'react';
import { Plus, ZoomIn, ZoomOut, Maximize2, Share2, Link2, Trash2, Edit2, X, CalendarDays, Sparkles, PanelsTopLeft, Workflow, LayoutGrid, ChevronLeft } from 'lucide-react';
import { useNotesStore } from '../store/notesStore';
import { useFriendsStore } from '../store/friendsStore';
import { useTaskStore } from '../store/taskStore';
import '../styles/notes.css';
import { motion, AnimatePresence } from 'framer-motion';

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

const NOTE_PEOPLE_CACHE_KEY = 'taski_note_people_v1';

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

export default function NotesPage() {
  const { notes, createNote, updateNote, deleteNote, linkNoteToTask, shareNoteWithFriend, unshareNoteForFriend, connectNotes, disconnectNotes, getNoteConnections } = useNotesStore();
  const { friends, fetchFriends } = useFriendsStore();
  const { tasks, fetchTasks } = useTaskStore();

  const [zoom, setZoom] = useState(() => {
    if (typeof window === 'undefined') return 80;
    const w = window.innerWidth;
    if (w >= 1920) return 72;
    if (w >= 1600) return 74;
    if (w >= 1440) return 76;
    if (w >= 1200) return 80;
    if (w >= 640)  return 86;
    return 100;
  });
  const [mobileViewMode, setMobileViewMode] = useState('grid'); // 'grid' | 'canvas'
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
  const [taskSearch, setTaskSearch] = useState('');
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [quickCreatePosition, setQuickCreatePosition] = useState(null);
  const [quickConnectMode, setQuickConnectMode] = useState(false);
  const [connectionType, setConnectionType] = useState('related');
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [contextTab, setContextTab] = useState('details');
  const [noteComments, setNoteComments] = useState({});
  const [commentDraft, setCommentDraft] = useState('');
  const [notePeopleMap, setNotePeopleMap] = useState(() => readNotePeopleCache());
  const [isMobileView, setIsMobileView] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 640 : false));
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const pinchStateRef = useRef(null);
  // Store latest handlers in refs so the non-passive listeners always see current closures
  const handleTouchMoveRef = useRef(null);
  const handleCanvasTouchStartRef = useRef(null);
  const didManualZoomRef = useRef(false);
  const didInitialViewportFitRef = useRef(false);

  const getAdaptiveZoom = (screenWidth) => {
    if (screenWidth >= 1920) return 72;
    if (screenWidth >= 1600) return 74;
    if (screenWidth >= 1440) return 76;
    if (screenWidth >= 1200) return 80;
    if (screenWidth >= 640) return 86;
    return 100;
  };

  const setZoomManual = (nextZoom) => {
    didManualZoomRef.current = true;
    setZoom(Math.round(clampZoom(nextZoom)));
  };

  const resetZoomToViewport = () => {
    didManualZoomRef.current = false;
    if (typeof window === 'undefined') {
      setZoom(100);
      return;
    }
    setZoom(window.innerWidth < 640 ? 100 : getAdaptiveZoom(window.innerWidth));
  };

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
    const syncViewport = () => {
      setIsMobileView(window.innerWidth < 640);
      if (!didManualZoomRef.current) {
        setZoom(window.innerWidth < 640 ? 100 : getAdaptiveZoom(window.innerWidth));
      }
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

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
          // Always overwrite with DB data when available — this is the source of truth
          patch[key] = {
            participant_ids: rawParticipants,
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
      return {
        ...prev,
        [key]: {
          participant_ids: Array.isArray(patch?.participant_ids) ? patch.participant_ids : current.participant_ids,
          responsible_user_id: Object.prototype.hasOwnProperty.call(patch || {}, 'responsible_user_id')
            ? (patch.responsible_user_id || null)
            : current.responsible_user_id,
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
    () => friends
      .map((friend) => ({
        id: String(friend.friend_user_id || friend.id),
        name: friend.name || `User ${friend.friend_user_id || friend.id}`,
      }))
      .filter((friend) => !!friend.id),
    [friends]
  );

  const resolvePersonName = (personId) => {
    const idText = String(personId || '');
    const found = friendOptions.find((entry) => entry.id === idText);
    return found?.name || 'Unbekannt';
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

  const moveDragging = (clientX, clientY) => {
    if (isDragging?.isPan && canvasRef.current) {
      const deltaX = clientX - isDragging.x;
      const deltaY = clientY - isDragging.y;
      canvasRef.current.scrollLeft -= deltaX;
      canvasRef.current.scrollTop -= deltaY;
      setIsDragging({ x: clientX, y: clientY, isPan: true });
      return;
    }

    if (isDragging?.noteId && canvasRef.current) {
      const deltaX = clientX - isDragging.startX;
      const deltaY = clientY - isDragging.startY;
      const note = notes.find((n) => n.id === isDragging.noteId);

      if (note) {
        const current = notePositions[isDragging.noteId] || { x: note.x ?? 100, y: note.y ?? 100 };
        const newX = Math.max(0, current.x + deltaX / (zoom / 100));
        const newY = Math.max(0, current.y + deltaY / (zoom / 100));
        updateNotePosition(isDragging.noteId, newX, newY, false);
      }

      setIsDragging((prev) => ({
        ...prev,
        startX: clientX,
        startY: clientY,
      }));
    }
  };

  // Handle canvas pan
  const handleCanvasMouseDown = (e) => {
    if (e.target === canvasRef.current || e.target.classList.contains('notes-canvas')) {
      setActiveNoteId(null);
      setIsDragging({ x: e.clientX, y: e.clientY, isPan: true });
    }
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

      pinchStateRef.current = {
        startZoom: zoom,
        startDistance: distance,
        lastCenterX: centerX,
        lastCenterY: centerY,
      };
      setIsDragging(null);
      if (event.cancelable) event.preventDefault();
      return;
    }

    if (event.touches.length === 1) {
      if (event.target.closest('.note-card')) return;
      const touch = event.touches[0];
      setActiveNoteId(null);
      setIsDragging({ x: touch.clientX, y: touch.clientY, isPan: true, isTouch: true });
    }
  };

  const handleTouchMove = (event) => {
    if (pinchStateRef.current && canvasRef.current && event.touches.length === 2) {
      const [first, second] = event.touches;
      const dx = first.clientX - second.clientX;
      const dy = first.clientY - second.clientY;
      const distance = Math.hypot(dx, dy);
      const nextZoom = clampZoom((distance / pinchStateRef.current.startDistance) * pinchStateRef.current.startZoom);
      const centerX = (first.clientX + second.clientX) / 2;
      const centerY = (first.clientY + second.clientY) / 2;

      didManualZoomRef.current = true;
      setZoom(Math.round(nextZoom));
      canvasRef.current.scrollLeft -= centerX - pinchStateRef.current.lastCenterX;
      canvasRef.current.scrollTop -= centerY - pinchStateRef.current.lastCenterY;

      pinchStateRef.current.lastCenterX = centerX;
      pinchStateRef.current.lastCenterY = centerY;
      if (event.cancelable) event.preventDefault();
      return;
    }

    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!isDragging?.isPan && !isDragging?.noteId) return;

    moveDragging(touch.clientX, touch.clientY);
    if (event.cancelable) event.preventDefault();
  };

  // Update refs after function definitions so useEffect always calls the latest version
  handleTouchMoveRef.current = handleTouchMove;
  handleCanvasTouchStartRef.current = handleCanvasTouchStart;

  const handleTouchEnd = () => {
    if (isDragging?.noteId) {
      const pos = notePositions[isDragging.noteId];
      if (pos) {
        updateNotePosition(isDragging.noteId, pos.x, pos.y, true);
      }
    }

    pinchStateRef.current = null;
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
    const noteWidth = isMobileView ? 240 : 300;
    const noteHeight = isMobileView ? 132 : 150;
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

  const handleNoteTouchStart = (event, noteId) => {
    if (event.touches.length !== 1) return;
    if (event.target.closest('button, input, textarea, select, a')) return;

    const touch = event.touches[0];
    setActiveNoteId(noteId);
    setIsDragging({ noteId, startX: touch.clientX, startY: touch.clientY, isTouch: true });
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
      const noteData = {
        ...newNote,
        x: targetPosition.x,
        y: targetPosition.y,
        width: isMobileView ? 240 : (window.innerWidth >= 1440 ? 380 : 320),
        height: isMobileView ? 140 : (window.innerWidth >= 1440 ? 210 : 180),
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

  const handleQuickConnectToggle = () => {
    setQuickConnectMode((prev) => {
      if (prev) setSelectedNote(null);
      return !prev;
    });
  };

  const handleNoteCardClick = async (event, noteId) => {
    if (event.target.closest('button, input, textarea, select, a')) return;
    setActiveNoteId(noteId);

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

  const selectedTask = newNote.linked_task_id
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
      className="notes-container"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
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
            <button className="zoom-btn" onClick={resetZoomToViewport} title="An Bildschirm anpassen">
              <Maximize2 size={18} />
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
                  return (
                    <div
                      key={note.id}
                      className={`nmlv-card nmlv-card-${note.importance} ${urgent ? 'nmlv-card-urgent' : ''}`}
                      onClick={() => {
                        const people = getPeopleForNote(note.id);
                        setEditingNote({ ...note, participant_ids: people.participant_ids, responsible_user_id: people.responsible_user_id });
                      }}
                    >
                      {/* Importance bar */}
                      <div className={`nmlv-card-bar imp-${note.importance}`} />

                      <div className="nmlv-card-body">
                        <div className="nmlv-card-header">
                          <h3 className="nmlv-card-title">{note.title}</h3>
                          <button
                            type="button"
                            className="nmlv-card-delete"
                            onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
                          >
                            <X size={14} />
                          </button>
                        </div>

                        {note.content && (
                          <p className="nmlv-card-content">{note.content}</p>
                        )}

                        <div className="nmlv-card-meta">
                          {note.date && (
                            <span className={`nmlv-meta-chip ${urgent ? 'urgent' : ''}`}>
                              📅 {new Date(note.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                            </span>
                          )}
                          {linked && (
                            <span className="nmlv-meta-chip link">
                              📌 {linked.title?.slice(0, 20)}
                            </span>
                          )}
                          {connections.some((c) =>
                            String(c.note_id_1 || c.noteId1) === String(note.id) ||
                            String(c.note_id_2 || c.noteId2) === String(note.id)
                          ) && (
                            <span className="nmlv-meta-chip connect">
                              <Link2 size={10} /> Verbunden
                            </span>
                          )}
                        </div>

                        {(responsibleName || notePeople.participant_ids.length > 0) && (
                          <div className="nmlv-card-people">
                            {responsibleName && (
                              <span className="nmlv-person-chip responsible">👑 {responsibleName}</span>
                            )}
                            {notePeople.participant_ids
                              .filter((id) => id !== String(notePeople.responsible_user_id))
                              .slice(0, 2)
                              .map((id) => (
                                <span key={id} className="nmlv-person-chip">{resolvePersonName(id)}</span>
                              ))}
                            {notePeople.participant_ids.filter((id) => id !== String(notePeople.responsible_user_id)).length > 2 && (
                              <span className="nmlv-person-chip more">
                                +{notePeople.participant_ids.filter((id) => id !== String(notePeople.responsible_user_id)).length - 2}
                              </span>
                            )}
                          </div>
                        )}
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
                <strong>{selectedNote ? 'Ziel-Note wählen' : 'Start-Note wählen'}</strong>
                <span>
                  Typ: {CONNECTION_TYPE_LABELS[connectionType] || CONNECTION_TYPE_LABELS.related}. Tippe nacheinander zwei Notes an, um sofort einen Verbindungsstrang zu bauen.
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

        <div className="notes-canvas-shell" style={{ position: 'relative' }}>
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
        onMouseDown={handleCanvasMouseDown}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleCanvasDrop}
        style={{ cursor: isDragging?.isPan ? 'grabbing' : 'grab' }}
      >
        <div className="canvas-content" style={{ transform: `scale(${zoom / 100})`, transformOrigin: '0 0' }}>
          {/* SVG Connections */}
          <svg className="connections-svg" aria-hidden="true">
            <defs>
              <linearGradient id="connectionGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="rgba(0, 224, 255, 0.95)" />
                <stop offset="50%" stopColor="rgba(122, 92, 255, 0.9)" />
                <stop offset="100%" stopColor="rgba(255, 87, 199, 0.92)" />
              </linearGradient>
              <filter id="connectionGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="7" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {connections.map(renderConnection)}
          </svg>

          {/* Notes */}
          <AnimatePresence>
            {notes.map((note) => (
                (() => {
                  const noteId = String(note.id);
                  const isHovered = hoveredNoteId && noteId === String(hoveredNoteId);
                  const isConnected = hoveredNoteId && connectedNoteIds.has(noteId);
                  const isMuted = hoveredNoteId && !isHovered && !isConnected;
                  const notePeople = getPeopleForNote(note.id);
                  const responsibleName = notePeople.responsible_user_id ? resolvePersonName(notePeople.responsible_user_id) : null;

                  return (
                <motion.div
                  key={note.id}
                  className={`note-card note-${note.importance} ${isUrgent(note.date) ? 'note-urgent' : ''} ${isHovered ? 'note-focus' : ''} ${isConnected ? 'note-connected' : ''} ${isMuted ? 'note-muted' : ''}`}
                  style={{
                    left: `${(notePositions[note.id]?.x ?? note.x ?? 100)}px`,
                    top: `${(notePositions[note.id]?.y ?? note.y ?? 100)}px`,
                    width: `${note.width || (isMobileView ? 240 : 300)}px`,
                    minHeight: `${note.height || (isMobileView ? 132 : 150)}px`,
                  }}
                  onMouseDown={(e) => handleNoteMouseDown(e, note.id)}
                  onTouchStart={(event) => handleNoteTouchStart(event, note.id)}
                  onClick={(event) => handleNoteCardClick(event, note.id)}
                  onMouseEnter={() => setHoveredNoteId(note.id)}
                  onMouseLeave={() => setHoveredNoteId(null)}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  whileHover={{ y: -8 }}
                >
                  <div className="note-header">
                    <h3 className="note-title">{note.title}</h3>
                    <div
                      className="note-importance"
                      style={{ borderColor: getImportanceColor(note.importance).border }}
                    >
                      {note.importance === 'high' && '⭐'}
                      {note.importance === 'medium' && '●'}
                      {note.importance === 'low' && '−'}
                    </div>
                  </div>

                  <p className="note-content">{note.content}</p>

                  {linkedTask(note.id) && (
                    <div className="note-linked-task">
                      📌 {linkedTask(note.id)?.title || 'Task verknüpft'}
                    </div>
                  )}

                  {note.date && (
                    <div className={`note-date ${isUrgent(note.date) ? 'urgent' : ''}`}>
                      📅 {new Date(note.date).toLocaleDateString('de-DE')}
                    </div>
                  )}

                  {(responsibleName || notePeople.participant_ids.length > 0) && (
                    <div className="note-people-meta">
                      {responsibleName && (
                        <span className="note-people-chip note-people-responsible" title="Verantwortlich">
                          👑 {responsibleName}
                        </span>
                      )}
                      {notePeople.participant_ids
                        .filter((id) => id !== String(notePeople.responsible_user_id))
                        .slice(0, 3)
                        .map((id) => (
                          <span key={id} className="note-people-chip" title="Teilnehmer">
                            {resolvePersonName(id)}
                          </span>
                        ))}
                      {notePeople.participant_ids.filter((id) => id !== String(notePeople.responsible_user_id)).length > 3 && (
                        <span className="note-people-chip note-people-more">
                          +{notePeople.participant_ids.filter((id) => id !== String(notePeople.responsible_user_id)).length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="note-actions">
                    <button
                      className="action-btn"
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
                      onClick={() => {
                        setConnectSearch('');
                        setShowConnectModal(note.id);
                      }}
                      title="Verknüpfen"
                    >
                      <Link2 size={14} />
                    </button>
                    <button
                      className="action-btn"
                      onClick={() => setShowShareModal(note.id)}
                      title="Teilen"
                    >
                      <Share2 size={14} />
                    </button>
                    <button
                      className="action-btn delete-btn"
                      onClick={() => handleDeleteNote(note.id)}
                      title="Löschen"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </motion.div>
                  );
                })()
              ))}
          </AnimatePresence>
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
        </div>

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
                  <p className="context-note-body">{activeNote.content || 'Kein Inhalt hinterlegt.'}</p>
                  <div className="context-meta-list">
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
                          <button type="button" className="unlink-btn" onClick={() => handleDisconnectNotes(activeNote.id, entry.otherId)}>
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
                      <button type="button" className="btn-secondary" onClick={() => updateNote(activeNote.id, { linked_task_id: null })}>
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
            className="modal-overlay"
            onClick={() => setShowCreateModal(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-content create-note-modal note-editor-modal"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
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
                <textarea
                  className="form-textarea"
                  placeholder="Deine Gedanken..."
                  value={newNote.content}
                  onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
                  rows="4"
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

                  {selectedTask && (
                    <button
                      type="button"
                      className="selected-task-pill"
                      onClick={() => setNewNote({ ...newNote, linked_task_id: null })}
                    >
                      <span>{selectedTask.title}</span>
                      <span>{formatTaskDate(selectedTask)}</span>
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
            className="modal-overlay"
            onClick={() => setEditingNote(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-content note-editor-modal edit-note-modal"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
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
                <textarea
                  className="form-textarea"
                  value={editingNote.content}
                  onChange={(e) => setEditingNote({ ...editingNote, content: e.target.value })}
                  rows="4"
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
              className="modal-content connect-note-modal"
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
                          <div className="note-item-preview">{entry.otherNote.content?.substring(0, 50)}...</div>
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
                      <div className="note-item-preview">{note.content?.substring(0, 50)}...</div>
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

