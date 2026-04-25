import { useState, useRef, useEffect, useMemo } from 'react';
import { Plus, ZoomIn, ZoomOut, Maximize2, Share2, Link2, Trash2, Edit2, X, CalendarDays, Sparkles, PanelsTopLeft, Workflow, LayoutGrid } from 'lucide-react';
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

export default function NotesPage() {
  const { notes, createNote, updateNote, deleteNote, linkNoteToTask, shareNoteWithFriend, connectNotes, disconnectNotes, getNoteConnections } = useNotesStore();
  const { friends } = useFriendsStore();
  const { tasks, fetchTasks } = useTaskStore();

  const [zoom, setZoom] = useState(100);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [selectedNote, setSelectedNote] = useState(null);
  const [showShareModal, setShowShareModal] = useState(null);
  const [showConnectModal, setShowConnectModal] = useState(null);
  const [newNote, setNewNote] = useState({ title: '', content: '', importance: 'medium', date: '', linked_task_id: null });
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
  const [isMobileView, setIsMobileView] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 640 : false));
  const canvasRef = useRef(null);

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

  // Load notes on mount
  useEffect(() => {
    useNotesStore.getState().fetchNotes?.();
    fetchTasks?.({ limit: '2000', completed: 'false' }, { force: true });
  }, [fetchTasks]);

  useEffect(() => {
    const syncViewport = () => {
      setIsMobileView(window.innerWidth < 640);
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

  // Handle canvas pan
  const handleCanvasMouseDown = (e) => {
    if (e.target === canvasRef.current || e.target.classList.contains('notes-canvas')) {
      setActiveNoteId(null);
      setIsDragging({ x: e.clientX, y: e.clientY, isPan: true });
    }
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
    if (isDragging?.isPan && canvasRef.current) {
      const deltaX = e.clientX - isDragging.x;
      const deltaY = e.clientY - isDragging.y;
      canvasRef.current.scrollLeft -= deltaX;
      canvasRef.current.scrollTop -= deltaY;
      setIsDragging({ x: e.clientX, y: e.clientY, isPan: true });
    } else if (isDragging?.noteId && canvasRef.current) {
      const deltaX = e.clientX - isDragging.startX;
      const deltaY = e.clientY - isDragging.startY;
      const note = notes.find(n => n.id === isDragging.noteId);
      
      if (note) {
        const current = notePositions[isDragging.noteId] || { x: note.x ?? 100, y: note.y ?? 100 };
        const newX = Math.max(0, current.x + deltaX / (zoom / 100));
        const newY = Math.max(0, current.y + deltaY / (zoom / 100));
        updateNotePosition(isDragging.noteId, newX, newY, false);
      }

      setIsDragging(prev => ({
        ...prev,
        startX: e.clientX,
        startY: e.clientY,
      }));
    }
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
        width: 300,
        height: 150,
      };
      await createNote(noteData);
      setNewNote({ title: '', content: '', importance: 'medium', date: '', linked_task_id: null });
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

  const openBlankCreateModal = (position = null) => {
    setQuickCreatePosition(position);
    setNewNote({ title: '', content: '', importance: 'medium', date: '', linked_task_id: null });
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

  const activeNote = activeNoteId
    ? notes.find((entry) => String(entry.id) === String(activeNoteId))
    : null;
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
    <div className="notes-container" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      {/* Header */}
      <div className="page-header notes-page-header">
        <div className="notes-header-main">
          <div className="notes-desktop-title">
            <h2>Notizen</h2>
            <p>Visuell planen, verbinden und direkt aus vorhandenen Terminen weiterdenken</p>
          </div>
          <div className="notes-mobile-tools">
            <button type="button" className={`header-tool-btn ${toolboxOpen ? 'active' : ''}`} onClick={() => setToolboxOpen((prev) => !prev)}>
              <PanelsTopLeft size={16} />
              <span>Tools</span>
            </button>
            <button type="button" className="header-tool-btn primary" onClick={() => openBlankCreateModal()}>
              <Plus size={16} />
              <span>Neu</span>
            </button>
            <button type="button" className={`header-tool-btn ${quickConnectMode ? 'active' : ''}`} onClick={handleQuickConnectToggle}>
              <Link2 size={16} />
              <span>Connect</span>
            </button>
          </div>
          {quickConnectMode && (
            <div className="notes-compact-status">
              {selectedNote ? 'Zweite Note wählen' : 'Quick Connect aktiv'}
            </div>
          )}
        </div>
        <div className="notes-controls">
          <button className="zoom-btn" onClick={() => setZoom(Math.max(25, zoom - 10))} title="Zoom out">
            <ZoomOut size={18} />
          </button>
          <span className="zoom-display">{zoom}%</span>
          <button className="zoom-btn" onClick={() => setZoom(Math.min(200, zoom + 10))} title="Zoom in">
            <ZoomIn size={18} />
          </button>
          <button className="zoom-btn" onClick={handleAutoLayout} title="Ordnen">
            <LayoutGrid size={18} />
          </button>
          <button className="zoom-btn" onClick={() => setZoom(100)} title="Reset zoom">
            <Maximize2 size={18} />
          </button>
        </div>
      </div>

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

        <div className="notes-canvas-shell">
      {/* Canvas */}
      <div
        className="notes-canvas"
        ref={canvasRef}
        onMouseDown={handleCanvasMouseDown}
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
            {notes.length === 0 ? (
              <motion.div
                key="empty"
                className="empty-state"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <p className="empty-state-text">Keine Notes vorhanden</p>
                <p className="empty-state-subtitle">Klicke "Neue Note", um zu beginnen</p>
              </motion.div>
            ) : (
              notes.map((note) => (
                (() => {
                  const noteId = String(note.id);
                  const isHovered = hoveredNoteId && noteId === String(hoveredNoteId);
                  const isConnected = hoveredNoteId && connectedNoteIds.has(noteId);
                  const isMuted = hoveredNoteId && !isHovered && !isConnected;

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

                  <div className="note-actions">
                    <button
                      className="action-btn"
                      onClick={() => setEditingNote(note)}
                      title="Bearbeiten"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      className="action-btn"
                      onClick={() => setShowConnectModal(note.id)}
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
              ))
            )}
          </AnimatePresence>
        </div>
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

      {/* Create Button */}
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
              className="modal-content share-modal create-note-modal"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <h2 className="modal-title">Neue Note</h2>

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
              className="modal-content"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <h2 className="modal-title">Note bearbeiten</h2>

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
                      await updateNote(editingNote.id, {
                        title: editingNote.title,
                        content: editingNote.content,
                        importance: editingNote.importance,
                        date: editingNote.date || null,
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
            onClick={() => setShowConnectModal(null)}
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
              <h2 className="modal-title">Note verknüpfen</h2>
              <p className="modal-description">Mit welcher anderen Note möchtest du diese verknüpfen?</p>

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
                {notes
                  .filter((n) => n.id !== showConnectModal)
                  .filter((n) => !modalConnectedIds.has(String(n.id)))
                  .map((note) => (
                    <div
                      key={note.id}
                      className="note-item"
                      onClick={() => handleConnectNotes(showConnectModal, note.id)}
                    >
                      <div className="note-item-title">{note.title}</div>
                      <div className="note-item-preview">{note.content?.substring(0, 50)}...</div>
                    </div>
                  ))}
              </div>

              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowConnectModal(null)}>
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

