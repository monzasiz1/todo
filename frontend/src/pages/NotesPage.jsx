import { useState, useRef, useEffect } from 'react';
import { Plus, ZoomIn, ZoomOut, Maximize2, Share2, Link2, Trash2, Edit2, X, CalendarDays, Sparkles, PanelsTopLeft, Workflow } from 'lucide-react';
import { useNotesStore } from '../store/notesStore';
import { useFriendsStore } from '../store/friendsStore';
import { useTaskStore } from '../store/taskStore';
import '../styles/notes.css';
import { motion, AnimatePresence } from 'framer-motion';

export default function NotesPage() {
  const { notes, createNote, updateNote, deleteNote, linkNoteToTask, shareNoteWithFriend, connectNotes, getNoteConnections } = useNotesStore();
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
    fetchTasks?.({ limit: '1000' }, { force: true });
  }, [fetchTasks]);

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
      setIsDragging({ x: e.clientX, y: e.clientY, isPan: true });
    }
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
      await connectNotes(noteId1, noteId2, 'related');
      await refreshConnections();
      setSelectedNote(null);
      setQuickConnectMode(false);
      setShowConnectModal(null);
    } catch (err) {
      console.error('Connect notes error:', err);
    }
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
  const sortedTasks = [...tasks].sort((left, right) => {
    const leftIsEvent = left.type === 'event' ? 0 : 1;
    const rightIsEvent = right.type === 'event' ? 0 : 1;
    if (leftIsEvent !== rightIsEvent) return leftIsEvent - rightIsEvent;

    const leftDate = left.date ? new Date(left.date).getTime() : Number.MAX_SAFE_INTEGER;
    const rightDate = right.date ? new Date(right.date).getTime() : Number.MAX_SAFE_INTEGER;
    return leftDate - rightDate;
  });

  const visibleTasks = sortedTasks.filter((task) => {
    if (!normalizedTaskSearch) return true;

    const searchable = [task.title, task.date, task.date_end, task.type]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return searchable.includes(normalizedTaskSearch);
  });

  const selectedTask = newNote.linked_task_id
    ? tasks.find((task) => String(task.id) === String(newNote.linked_task_id))
    : null;
  const shortcutTasks = visibleTasks.filter((task) => !task.completed).slice(0, 10);

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

    return (
      <g
        key={connection.id || `${firstId}-${secondId}`}
        className={`connection-group ${isActive ? 'active' : ''} ${isMuted ? 'muted' : ''}`}
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
      <div className="notes-header">
        <div className="notes-header-main">
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
          <button className="zoom-btn" onClick={() => setZoom(Math.max(50, zoom - 10))} title="Zoom out">
            <ZoomOut size={18} />
          </button>
          <span className="zoom-display">{zoom}%</span>
          <button className="zoom-btn" onClick={() => setZoom(Math.min(200, zoom + 10))} title="Zoom in">
            <ZoomIn size={18} />
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
              <h2 className="toolbox-title">Board Control</h2>
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

          {quickConnectMode && (
            <div className="toolbox-status-card">
              <Sparkles size={16} />
              <div>
                <strong>{selectedNote ? 'Ziel-Note wählen' : 'Start-Note wählen'}</strong>
                <span>Tippe nacheinander zwei Notes an, um sofort einen Verbindungsstrang zu bauen.</span>
              </div>
            </div>
          )}

          <div className="toolbox-section">
            <div className="toolbox-section-head">
              <h3>Schnelle Termine</h3>
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
                    width: `${note.width || 300}px`,
                    minHeight: `${note.height || 150}px`,
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
              className="modal-content share-modal"
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

              <div className="notes-list">
                {notes
                  .filter((n) => n.id !== showConnectModal)
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

