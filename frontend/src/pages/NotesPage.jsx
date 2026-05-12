import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, useDragControls } from 'framer-motion';
import { Plus, ZoomIn, ZoomOut, X, CalendarDays, Pin, CheckSquare, Calendar, Check, Archive, RotateCcw, Trash2, LayoutGrid } from 'lucide-react';
import { useOpenTask } from '../hooks/useOpenTask';
import TaskDetailModal from '../components/TaskDetailModal';
import { useNotesStore } from '../store/notesStore';
import { useTaskStore } from '../store/taskStore';
import '../styles/notes.css';

const NOTE_COLORS = [
  { name: 'Gelb', bg: '#FFFE94', border: '#E6D35C', shadow: '#D4AC0D' },
  { name: 'Blau', bg: '#B3D9F7', border: '#5DADE2', shadow: '#2E86AB' },
  { name: 'Grün', bg: '#A9F5A9', border: '#58D68D', shadow: '#27AE60' },
  { name: 'Rosa', bg: '#FFB3BA', border: '#F1948A', shadow: '#E74C3C' },
  { name: 'Orange', bg: '#FFCC99', border: '#F39C12', shadow: '#D35400' },
  { name: 'Lila', bg: '#E8DAEF', border: '#BB8FCE', shadow: '#8E44AD' },
];

function StickyNote({ note, onUpdate, onDelete, onComplete, onPositionChange, isSelected, onSelect, tasks = [], onOpenTask, boardScaleRef }) {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(note.content || '');
  const [isDragging, setIsDragging] = useState(false);
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const noteRef = useRef(null);
  const dragStartPos = useRef({ x: 0, y: 0 });
  // Drag-Controls für swipe-to-close des Termin-Pickers — Drag startet
  // nur vom Handle/Header, damit Scrollen in der Liste nicht blockiert wird.
  const taskPickerDragControls = useDragControls();

  const noteColor = useMemo(() => {
    const contentStr = note.content || '';
    const colorMatch = contentStr.match(/^\[COLOR:([^\]]+)\]/);
    if (colorMatch) {
      const colorName = colorMatch[1];
      return NOTE_COLORS.find(c => c.name === colorName) || NOTE_COLORS[0];
    }
    return NOTE_COLORS[0];
  }, [note.content]);

  const actualContent = useMemo(() => {
    const contentStr = note.content || '';
    return contentStr.replace(/^\[COLOR:[^\]]+\]\s*/, '');
  }, [note.content]);

  const isLongText = useMemo(() => {
    return actualContent.length > 100;
  }, [actualContent]);

  const displayContent = useMemo(() => {
    if (!isLongText || isExpanded) return actualContent;
    return actualContent.slice(0, 100) + '...';
  }, [actualContent, isLongText, isExpanded]);

  // 0 = pin+curl-BR, 1 = sheen, 2 = tape, 3 = clip+curl-BL
  const variantIndex = useMemo(() => {
    const id = String(note?.id ?? Math.random());
    const sum = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return sum % 4;
  }, [note?.id]);

  const linkedTasks = useMemo(() => {
    if (!Array.isArray(tasks) || !note.linked_task_id) return [];
    return tasks.filter(task => task != null && task.id === note.linked_task_id);
  }, [tasks, note.linked_task_id]);

  const availableTasks = useMemo(() => {
    if (!Array.isArray(tasks)) return [];
    return tasks.filter(task => task != null && task.id !== note.linked_task_id && !task.completed);
  }, [tasks, note.linked_task_id]);

  const handleSave = useCallback(async () => {
    const contentWithColor = `[COLOR:${noteColor.name}] ${content.trim()}`;
    if (contentWithColor !== note.content) {
      await onUpdate(note.id, { content: contentWithColor });
    }
    setIsEditing(false);
  }, [content, note.content, note.id, onUpdate, noteColor.name]);

  const handlePointerDown = useCallback((e) => {
    if (
      e.target.closest('.note-content') ||
      e.target.closest('.note-actions') ||
      e.target.closest('.note-linked-tasks') ||
      e.target.closest('.task-picker-overlay')
    ) return;
    
    // Support both mouse and touch
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    setIsDragging(true);
    onSelect(note.id);
    
    dragStartPos.current = {
      noteX: note.x || 100,
      noteY: note.y || 100,
      startX: clientX,
      startY: clientY
    };

    e.preventDefault();
  }, [note.id, note.x, note.y, onSelect]);

  const handlePointerMove = useCallback((e) => {
    if (!isDragging) return;
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const deltaX = clientX - dragStartPos.current.startX;
    const deltaY = clientY - dragStartPos.current.startY;
    
    const newX = Math.max(0, dragStartPos.current.noteX + deltaX);
    const newY = Math.max(0, dragStartPos.current.noteY + deltaY);
    
    if (noteRef.current) {
      noteRef.current.style.left = `${newX}px`;
      noteRef.current.style.top = `${newY}px`;
    }
  }, [isDragging]);

  const handlePointerUp = useCallback(() => {
    if (!isDragging) return;
    
    const rect = noteRef.current.getBoundingClientRect();
    const boardRect = noteRef.current.closest('.notes-board').getBoundingClientRect();
    const zoomFactor = boardScaleRef?.current ?? 1;
    
    const newX = (rect.left - boardRect.left) / zoomFactor;
    const newY = (rect.top - boardRect.top) / zoomFactor;
    
    onPositionChange(note.id, Math.max(0, newX), Math.max(0, newY));
    setIsDragging(false);
  }, [isDragging, note.id, onPositionChange]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handlePointerMove);
      document.addEventListener('mouseup', handlePointerUp);
      document.addEventListener('touchmove', handlePointerMove, { passive: false });
      document.addEventListener('touchend', handlePointerUp);
      return () => {
        document.removeEventListener('mousemove', handlePointerMove);
        document.removeEventListener('mouseup', handlePointerUp);
        document.removeEventListener('touchmove', handlePointerMove);
        document.removeEventListener('touchend', handlePointerUp);
      };
    }
  }, [isDragging, handlePointerMove, handlePointerUp]);

  const handleLinkTask = useCallback(async (taskId) => {
    try {
      await onUpdate(note.id, { linked_task_id: taskId });
      setShowTaskPicker(false);
    } catch (error) {
      console.error('Task-Linking fehlgeschlagen:', error);
      alert('Termin konnte nicht angeheftet werden. Versuche es später erneut.');
      setShowTaskPicker(false);
    }
  }, [note.id, onUpdate]);

  const handleUnlinkTask = useCallback(async () => {
    await onUpdate(note.id, { linked_task_id: null });
  }, [note.id, onUpdate]);

  const getRandomRotation = () => {
    const rotations = [-3, -2, -1, 0, 1, 2, 3];
    return rotations[Math.floor(Math.random() * rotations.length)];
  };

  useEffect(() => {
    if (noteRef.current) {
      const rotation = getRandomRotation();
      noteRef.current.style.transform = `rotate(${rotation}deg)`;
    }
  }, []);

  useEffect(() => {
    setContent(actualContent);
  }, [actualContent]);

  return (
    <div
      ref={noteRef}
      className={`sticky-note ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${linkedTasks.length > 0 ? 'has-linked-task' : ''}`}
      data-variant={variantIndex}
      style={{
        position: 'absolute',
        left: note.x || 100,
        top: note.y || 100,
        // Vollflächige Note-Farbe ohne Transparenz — Kork darf nicht durchscheinen.
        backgroundColor: noteColor.bg,
        boxShadow: `2px 4px 8px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255,255,255,0.28)`,
        borderColor: noteColor.border,
        zIndex: isSelected ? 15 : isDragging ? 20 : 1,
      }}
      onMouseDown={handlePointerDown}
      onTouchStart={handlePointerDown}>
      
      {/* Visual indicator for linked tasks */}
      {linkedTasks.length > 0 && (
        <div className="note-linked-task-visual" title={`Verknüpft mit: ${linkedTasks.map(t => t.title).join(', ')}`}>
          <div className="task-visual-icon">📅</div>
          <div className="task-visual-info">
            <span className="task-count">{linkedTasks.length}</span>
          </div>
        </div>
      )}

      <div className="sticky-note-header">
        <span className="note-attach-anchor">
          {variantIndex === 0 && <span className="thumbtack" aria-hidden="true" />}
        </span>
        {variantIndex === 3 && <span className="paperclip-icon" aria-hidden="true" />}
        <div className="note-actions">
          <button
            className="note-action-btn complete"
            onClick={(e) => {
              e.stopPropagation();
              onComplete?.(note.id);
            }}
            title="Erledigt → ins Archiv"
          >
            <Check size={12} />
          </button>
          <button
            className="note-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowTaskPicker(true);
            }}
            title="Termin anheften"
          >
            <CalendarDays size={12} />
          </button>
          <button
            className="note-action-btn delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(note.id);
            }}
            title="Löschen"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      <div className="note-content">
        {isEditing ? (
          <textarea
            className="note-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) {
                handleSave();
              }
              if (e.key === 'Escape') {
                setContent(actualContent);
                setIsEditing(false);
              }
            }}
            placeholder="Notiz schreiben..."
            autoFocus
          />
        ) : (
          <div
            className="note-display"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            {displayContent || ''}
            {isLongText && !isExpanded && (
              <button 
                className="expand-text-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(true);
                }}
                title="Vollständigen Text anzeigen"
              >
                ...mehr
              </button>
            )}
            {isLongText && isExpanded && (
              <button 
                className="collapse-text-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(false);
                }}
                title="Text einklappen"
              >
                ᵕ
              </button>
            )}
          </div>
        )}
      </div>

      {linkedTasks.length > 0 && (
        <div className="note-linked-tasks">
          {linkedTasks.filter(Boolean).map((task) => (
            <div key={task.id} className="linked-task-item" onClick={(e) => { e.stopPropagation(); onOpenTask?.(task); }} style={{ cursor: 'pointer' }}>
              <div className="task-preview">
                <div 
                  className="task-color-indicator"
                  style={{ backgroundColor: task.color || '#4CAF50' }}
                />
                <span className="task-name" title={task.title}>
                  {task.title}
                </span>
                {task.date && (
                  <span className="task-date">
                    {new Date(task.date).toLocaleDateString('de-DE', { 
                      day: '2-digit', 
                      month: '2-digit' 
                    })}
                  </span>
                )}
              </div>
              <button
                className="task-unlink-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleUnlinkTask();
                }}
                title="Termin entfernen"
              >
                <X size={8} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showTaskPicker && createPortal(
        <div
          className="task-picker-overlay"
          onPointerDown={(e) => {
            // Schließe nur, wenn direkt auf den Overlay-Backdrop geklickt/getippt wurde
            if (e.target === e.currentTarget) setShowTaskPicker(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Termin anheften"
        >
          <motion.div
            className="task-picker-modal"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            dragMomentum={false}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) setShowTaskPicker(false);
            }}
          >
            <div className="task-picker-handle" aria-hidden="true" />
            <div className="task-picker-header">
              <h3>Termin anheften</h3>
              <button
                className="close-btn"
                onClick={() => setShowTaskPicker(false)}
                aria-label="Schließen"
              >
                <X size={18} />
              </button>
            </div>
            <div className="task-picker-list">
              {availableTasks.length > 0 ? (
                availableTasks.map((task) => (
                  <button
                    type="button"
                    key={task.id}
                    className="task-picker-item"
                    onClick={() => handleLinkTask(task.id)}
                  >
                    <div
                      className="task-color-dot"
                      style={{ backgroundColor: task.color || '#007AFF' }}
                    />
                    <div className="task-type-icon">
                      {task.type === 'event' ? (
                        <Calendar size={14} color="#666" />
                      ) : (
                        <CheckSquare size={14} color="#666" />
                      )}
                    </div>
                    <div className="task-info">
                      <div className="task-title">{task.title}</div>
                      <div className="task-meta">
                        <span className="task-type-label">
                          {task.type === 'event' ? 'Termin' : 'Aufgabe'}
                        </span>
                        {task.date && (
                          <>
                            <span className="task-meta-separator">•</span>
                            <span className="task-date">
                              {new Date(task.date).toLocaleDateString('de-DE')}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="task-picker-empty">
                  <CalendarDays size={32} />
                  <p>Keine verfügbaren Aufgaben oder Termine</p>
                  <small>Erstelle zuerst Aufgaben oder Termine im Kalender</small>
                </div>
              )}
            </div>
          </motion.div>
        </div>,
        document.body
      )}
    </div>
  );
}

const BOARD_W = 3200;
const BOARD_H = 2400;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.0;

export default function NotesPage() {
  const { detailTask, openTask, closeTask } = useOpenTask();
  const {
    notes, createNote, updateNote, deleteNote, fetchNotes,
    completeNote, restoreArchivedNote, fetchArchivedNotes,
    archivedNotes, archivedLoading,
  } = useNotesStore();
  const { tasks, fetchTasks } = useTaskStore();
  const [showArchive, setShowArchive] = useState(false);

  const [scale, setScale] = useState(1);
  // Initial-Pan: grobe Schätzung der Canvas-Mitte relativ zum Viewport.
  // Verhindert das kurze Aufblitzen von oben-links beim ersten Rendern,
  // bevor centerView() den exakten Pan berechnet hat.
  const [pan, setPan] = useState(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    // Sidebar (Desktop) belegt links etwa 280 px; auf Mobile nichts.
    const sidebarOffset = window.innerWidth > 1024 ? 280 : 0;
    const vw = window.innerWidth - sidebarOffset;
    const vh = window.innerHeight - 60; // Header
    return {
      x: vw / 2 - BOARD_W / 2,
      y: vh / 2 - BOARD_H / 2,
    };
  });
  const [selectedNoteIds, setSelectedNoteIds] = useState([]);
  const [showMobileHint, setShowMobileHint] = useState(false);

  const viewportRef = useRef(null);
  const boardRef = useRef(null);

  // interaction state refs (no re-render needed)
  const interactionRef = useRef({
    isPanning: false,
    isPinching: false,
    lastPointer: { x: 0, y: 0 },
    pinchDist: 0,
    pinchMid: { x: 0, y: 0 },
    pinchScale: 1,
    pinchPan: { x: 0, y: 0 },
  });

  // Hat der Nutzer manuell ge-pannt/-zoomt? Solange nein, zentrieren wir
  // bei Mount und bei Viewport-Resize automatisch.
  const userInteractedRef = useRef(false);
  // 'none' | 'empty' | 'with-notes' — beschreibt, für welchen Zustand
  // wir zuletzt zentriert haben.
  const initialCenteredRef = useRef('none');

  // exposed so StickyNote can read current scale without re-render
  const scaleRef = useRef(scale);
  const panRef = useRef(pan);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  useEffect(() => {
    fetchNotes();
    fetchTasks();
    if ('ontouchstart' in window && !localStorage.getItem('notes-mobile-hint-shown')) {
      setShowMobileHint(true);
      localStorage.setItem('notes-mobile-hint-shown', 'true');
      setTimeout(() => setShowMobileHint(false), 4000);
    }
  }, [fetchNotes, fetchTasks]);

  // ── helpers ──────────────────────────────────────────────────────────────
  const clampPan = useCallback((x, y, s) => {
    if (!viewportRef.current) return { x, y };
    const vw = viewportRef.current.clientWidth;
    const vh = viewportRef.current.clientHeight;
    const maxX = 0;
    const minX = vw - BOARD_W * s;
    const maxY = 0;
    const minY = vh - BOARD_H * s;
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y)),
    };
  }, []);

  const applyTransform = useCallback((s, p) => {
    if (boardRef.current) {
      boardRef.current.style.transform = `translate(${p.x}px,${p.y}px) scale(${s})`;
    }
  }, []);

  // ── zoom buttons ──────────────────────────────────────────────────────────
  const handleZoomIn = useCallback(() => {
    userInteractedRef.current = true;
    setScale(prev => {
      const next = Math.min(MAX_SCALE, parseFloat((prev + 0.2).toFixed(2)));
      const vp = viewportRef.current;
      if (!vp) return next;
      const cx = vp.clientWidth / 2;
      const cy = vp.clientHeight / 2;
      const p = panRef.current;
      const canvasX = (cx - p.x) / prev;
      const canvasY = (cy - p.y) / prev;
      const np = clampPan(cx - canvasX * next, cy - canvasY * next, next);
      setPan(np);
      applyTransform(next, np);
      return next;
    });
  }, [clampPan, applyTransform]);

  const handleZoomOut = useCallback(() => {
    userInteractedRef.current = true;
    setScale(prev => {
      const next = Math.max(MIN_SCALE, parseFloat((prev - 0.2).toFixed(2)));
      const vp = viewportRef.current;
      if (!vp) return next;
      const cx = vp.clientWidth / 2;
      const cy = vp.clientHeight / 2;
      const p = panRef.current;
      const canvasX = (cx - p.x) / prev;
      const canvasY = (cy - p.y) / prev;
      const np = clampPan(cx - canvasX * next, cy - canvasY * next, next);
      setPan(np);
      applyTransform(next, np);
      return next;
    });
  }, [clampPan, applyTransform]);

  // ── create note in visible center ─────────────────────────────────────────
  const handleCreateNote = useCallback(async () => {
    const randomColor = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
    const vp = viewportRef.current;
    let x = 100 + Math.random() * 300;
    let y = 100 + Math.random() * 300;
    if (vp) {
      const s = scaleRef.current;
      const p = panRef.current;
      const vw = vp.clientWidth;
      const vh = vp.clientHeight;
      const visX = -p.x / s;
      const visY = -p.y / s;
      const visW = vw / s;
      const visH = vh / s;
      const noteW = 190, noteH = 190, margin = 24;
      x = visX + margin + Math.random() * Math.max(0, visW - noteW - margin * 2);
      y = visY + margin + Math.random() * Math.max(0, visH - noteH - margin * 2);
    }
    await createNote({
      title: 'Neue Notiz',
      content: `[COLOR:${randomColor.name}] `,
      x: Math.round(x),
      y: Math.round(y),
    });
  }, [createNote]);

  const handleUpdateNote = useCallback(async (noteId, updates) => {
    try {
      await updateNote(noteId, updates);
    } catch (error) {
      console.error('Note update failed:', error);
      if (!('x' in updates || 'y' in updates)) {
        alert('Notiz-Update fehlgeschlagen. Versuche es später erneut.');
      }
      throw error;
    }
  }, [updateNote]);

  const handleDeleteNote = useCallback(async (noteId) => {
    if (window.confirm('Notiz wirklich löschen?')) {
      try {
        await deleteNote(noteId);
        setSelectedNoteIds(prev => prev.filter(id => id !== noteId));
      } catch (error) {
        console.error('Note deletion failed:', error);
        alert('Notiz löschen fehlgeschlagen. Versuche es später erneut.');
      }
    }
  }, [deleteNote]);

  const handleCompleteNote = useCallback(async (noteId) => {
    try {
      await completeNote(noteId);
      setSelectedNoteIds(prev => prev.filter(id => id !== noteId));
    } catch (error) {
      console.error('Note complete failed:', error);
    }
  }, [completeNote]);

  const handleRestoreArchived = useCallback(async (noteId) => {
    try { await restoreArchivedNote(noteId); }
    catch (error) { console.error('Restore failed:', error); }
  }, [restoreArchivedNote]);

  // Beim Öffnen des Archivs frisch laden
  useEffect(() => {
    if (showArchive) fetchArchivedNotes();
  }, [showArchive, fetchArchivedNotes]);

  const handlePositionChange = useCallback(async (noteId, x, y) => {
    try {
      await updateNote(noteId, { x, y });
    } catch (error) {
      console.error('Position update failed:', error);
    }
  }, [updateNote]);

  const handleSelectNote = useCallback((noteId) => {
    setSelectedNoteIds([noteId]);
  }, []);

  // ── "fit all" button ──────────────────────────────────────────────────────
  const handleFitAll = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || notes.length === 0) return;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    const pad = 48;
    const minX = Math.min(...notes.map(n => n.x ?? 0));
    const minY = Math.min(...notes.map(n => n.y ?? 0));
    const maxX = Math.max(...notes.map(n => (n.x ?? 0) + 190));
    const maxY = Math.max(...notes.map(n => (n.y ?? 0) + 190));
    const cw = maxX - minX + pad * 2;
    const ch = maxY - minY + pad * 2;
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(vw / cw, vh / ch)));
    const np = clampPan((vw - cw * s) / 2 - (minX - pad) * s, (vh - ch * s) / 2 - (minY - pad) * s, s);
    setScale(s);
    setPan(np);
    applyTransform(s, np);
    userInteractedRef.current = false; // expliziter Klick = wieder „auto-center"
  }, [notes, clampPan, applyTransform]);

  // ── Auto-zentrieren: Notizen sollen auf jedem Bildschirm sichtbar sein ────
  const centerView = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    if (vw === 0 || vh === 0) return;

    if (notes.length > 0) {
      const pad = 64;
      const minX = Math.min(...notes.map(n => n.x ?? 0));
      const minY = Math.min(...notes.map(n => n.y ?? 0));
      const maxX = Math.max(...notes.map(n => (n.x ?? 0) + 190));
      const maxY = Math.max(...notes.map(n => (n.y ?? 0) + 190));
      const cw = maxX - minX + pad * 2;
      const ch = maxY - minY + pad * 2;
      // Auf Mobile/Tablet: nicht über 1.0 hochskalieren (sonst zu groß), auf Desktop genauso.
      const s = Math.min(1, Math.max(MIN_SCALE, Math.min(vw / cw, vh / ch)));
      const px = (vw - cw * s) / 2 - (minX - pad) * s;
      const py = (vh - ch * s) / 2 - (minY - pad) * s;
      const np = clampPan(px, py, s);
      setScale(s);
      setPan(np);
      applyTransform(s, np);
    } else {
      // Leere Pinnwand: Mitte des Canvas in die Viewport-Mitte legen
      const s = 1;
      const np = clampPan(vw / 2 - (BOARD_W / 2) * s, vh / 2 - (BOARD_H / 2) * s, s);
      setScale(s);
      setPan(np);
      applyTransform(s, np);
    }
  }, [notes, clampPan, applyTransform]);

  // Auto-Zentrierung:
  //  • beim allerersten Mount, sobald Viewport gemessen ist (useLayoutEffect
  //    läuft synchron vor dem Paint → kein Aufblitzen von oben-links)
  //  • erneut, wenn aus 0 Notizen → ≥1 wird (also nach fetchNotes)
  //  • nicht mehr nach manueller Interaktion (Pan/Zoom/Pinch)
  useLayoutEffect(() => {
    if (userInteractedRef.current) return;
    const vp = viewportRef.current;
    if (!vp || vp.clientWidth === 0 || vp.clientHeight === 0) return;

    const newState = notes.length > 0 ? 'with-notes' : 'empty';
    if (initialCenteredRef.current === newState) return;

    centerView();
    initialCenteredRef.current = newState;
  }, [notes.length, centerView]);

  // Resize/Orientation + ResizeObserver auf dem Viewport (fängt auch Layout-
  // Wechsel ein, die kein window.resize feuern — z. B. Sidebar-Collapse).
  // Solange der User noch nicht selbst gepant/gezoomt hat, wird neu zentriert.
  useEffect(() => {
    const onResize = () => {
      if (userInteractedRef.current) return;
      centerView();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    let ro = null;
    const vp = viewportRef.current;
    if (vp && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onResize);
      ro.observe(vp);
    }

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (ro) ro.disconnect();
    };
  }, [centerView]);

  // ── viewport touch/pointer handlers ──────────────────────────────────────
  const onViewportPointerDown = useCallback((e) => {
    // only pan on direct board clicks (not on notes or buttons)
    const target = e.target;
    if (
      target.closest('.sticky-note') ||
      target.closest('.board-controls') ||
      target.closest('.notes-board-header') ||
      target.closest('.empty-board-content') ||
      target.closest('button, a, input, textarea, select, label, [role="button"]')
    ) return;
    if (e.touches) return; // handled by touch events
    interactionRef.current.isPanning = true;
    interactionRef.current.lastPointer = { x: e.clientX, y: e.clientY };
    userInteractedRef.current = true;
    viewportRef.current?.setPointerCapture?.(e.pointerId);
  }, []);

  const onViewportPointerMove = useCallback((e) => {
    if (!interactionRef.current.isPanning) return;
    const dx = e.clientX - interactionRef.current.lastPointer.x;
    const dy = e.clientY - interactionRef.current.lastPointer.y;
    interactionRef.current.lastPointer = { x: e.clientX, y: e.clientY };
    setPan(prev => {
      const np = clampPan(prev.x + dx, prev.y + dy, scaleRef.current);
      applyTransform(scaleRef.current, np);
      panRef.current = np;
      return np;
    });
  }, [clampPan, applyTransform]);

  const onViewportPointerUp = useCallback(() => {
    interactionRef.current.isPanning = false;
  }, []);

  // ── touch events (pan + pinch) ────────────────────────────────────────────
  const onTouchStart = useCallback((e) => {
    const ir = interactionRef.current;
    if (e.touches.length === 2) {
      ir.isPinching = true;
      ir.isPanning = false;
      const t1 = e.touches[0], t2 = e.touches[1];
      ir.pinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      ir.pinchMid = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
      ir.pinchScale = scaleRef.current;
      ir.pinchPan = { ...panRef.current };
      userInteractedRef.current = true;
      e.preventDefault();
    } else if (e.touches.length === 1) {
      const target = e.touches[0].target;
      if (
        target.closest('.sticky-note') ||
        target.closest('.board-controls') ||
        target.closest('.notes-board-header') ||
        target.closest('.empty-board-content') ||
        target.closest('button, a, input, textarea, select, label, [role="button"]')
      ) return;
      ir.isPanning = true;
      ir.lastPointer = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      userInteractedRef.current = true;
    }
  }, []);

  const onTouchMove = useCallback((e) => {
    const ir = interactionRef.current;
    if (ir.isPinching && e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const mid = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
      const ratio = dist / ir.pinchDist;
      const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, ir.pinchScale * ratio));
      // focal-point pan: keep pinch midpoint fixed in canvas space
      const canvasX = (ir.pinchMid.x - ir.pinchPan.x) / ir.pinchScale;
      const canvasY = (ir.pinchMid.y - ir.pinchPan.y) / ir.pinchScale;
      const panDx = mid.x - ir.pinchMid.x;
      const panDy = mid.y - ir.pinchMid.y;
      const np = clampPan(mid.x - canvasX * ns + panDx, mid.y - canvasY * ns + panDy, ns);
      setScale(ns);
      setPan(np);
      scaleRef.current = ns;
      panRef.current = np;
      applyTransform(ns, np);
    } else if (ir.isPanning && e.touches.length === 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - ir.lastPointer.x;
      const dy = e.touches[0].clientY - ir.lastPointer.y;
      ir.lastPointer = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setPan(prev => {
        const np = clampPan(prev.x + dx, prev.y + dy, scaleRef.current);
        applyTransform(scaleRef.current, np);
        panRef.current = np;
        return np;
      });
    }
  }, [clampPan, applyTransform]);

  const onTouchEnd = useCallback((e) => {
    const ir = interactionRef.current;
    if (e.touches.length < 2) ir.isPinching = false;
    if (e.touches.length === 0) ir.isPanning = false;
  }, []);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    vp.addEventListener('touchstart', onTouchStart, { passive: false });
    vp.addEventListener('touchmove', onTouchMove, { passive: false });
    vp.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      vp.removeEventListener('touchstart', onTouchStart);
      vp.removeEventListener('touchmove', onTouchMove);
      vp.removeEventListener('touchend', onTouchEnd);
    };
  }, [onTouchStart, onTouchMove, onTouchEnd]);

  if (detailTask) {
    return <TaskDetailModal task={detailTask} onClose={closeTask} />;
  }

  return (
    <div className="notes-board-container">
      <div className="notes-board-header">
        <div className="board-title">
          <h1>
            <LayoutGrid className="board-title-icon" size={18} aria-hidden="true" />
            <span>Notizen Board</span>
          </h1>
          <span className="notes-count">{notes.length} Notizen</span>
        </div>

        <div className="board-controls">
          <button className="board-control-btn" onClick={handleZoomOut} disabled={scale <= MIN_SCALE} title="Verkleinern">
            <ZoomOut size={16} />
          </button>
          <span className="zoom-indicator">{Math.round(scale * 100)}%</span>
          <button className="board-control-btn" onClick={handleZoomIn} disabled={scale >= MAX_SCALE} title="Vergrößern">
            <ZoomIn size={16} />
          </button>
          {notes.length > 0 && (
            <button className="board-control-btn" onClick={handleFitAll} title="Alle Notizen anzeigen">
              <ZoomOut size={14} /><ZoomIn size={14} />
            </button>
          )}
          <button
            className="board-control-btn"
            onClick={() => setShowArchive(true)}
            title="Archiv (erledigte Notizen)"
          >
            <Archive size={16} />
          </button>
          <button className="board-control-btn primary large" onClick={handleCreateNote} title="Neue Notiz erstellen">
            <Plus size={18} />
            <span className="btn-label">Neue Notiz</span>
          </button>
        </div>
      </div>

      {/* Viewport: clips canvas, captures pointer/touch */}
      <div
        ref={viewportRef}
        className="notes-viewport"
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        onPointerCancel={onViewportPointerUp}
      >
        {/* Canvas: panned + scaled */}
        <div
          ref={boardRef}
          className="notes-board"
          style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${scale})` }}
          onClick={(e) => {
            if (e.target === boardRef.current || e.target.classList.contains('board-background') || e.target.classList.contains('cork-board-background')) {
              setSelectedNoteIds([]);
            }
          }}
        >
          <div className="board-background" />
          <div className="cork-board-background" />

          {notes.filter(note => note != null && note.id != null).map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              onUpdate={handleUpdateNote}
              onDelete={handleDeleteNote}
              onComplete={handleCompleteNote}
              onPositionChange={handlePositionChange}
              isSelected={selectedNoteIds.includes(note.id)}
              onSelect={handleSelectNote}
              tasks={tasks}
              onOpenTask={openTask}
              boardScaleRef={scaleRef}
            />
          ))}

          {notes.length === 0 && (
            <div className="empty-board">
              <div className="empty-board-content">
                <Pin size={48} />
                <h2>Keine Notizen vorhanden</h2>
                <p>Klicke auf "Neue Notiz" um deine erste Notiz zu erstellen!</p>
                <button className="board-control-btn primary large" onClick={handleCreateNote}>
                  <Plus size={18} />
                  Erste Notiz erstellen
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showMobileHint && (
        <div className="mobile-hint">
          💡 Mit einem Finger verschieben · Zwei Finger zum Zoomen
        </div>
      )}

      {showArchive && createPortal(
        <div
          className="notes-archive-overlay"
          onPointerDown={(e) => { if (e.target === e.currentTarget) setShowArchive(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="Notizen-Archiv"
        >
          <div className="notes-archive-modal" onPointerDown={(e) => e.stopPropagation()}>
            <div className="notes-archive-handle" aria-hidden="true" />
            <div className="notes-archive-header">
              <div className="notes-archive-title-wrap">
                <Archive size={18} />
                <h3>Archiv</h3>
                <span className="notes-archive-count">{archivedNotes.length}</span>
              </div>
              <button
                className="close-btn"
                onClick={() => setShowArchive(false)}
                aria-label="Schließen"
              >
                <X size={18} />
              </button>
            </div>

            <div className="notes-archive-body">
              {archivedLoading && archivedNotes.length === 0 ? (
                <div className="notes-archive-empty">
                  <p>Wird geladen…</p>
                </div>
              ) : archivedNotes.length === 0 ? (
                <div className="notes-archive-empty">
                  <Archive size={36} />
                  <p>Keine erledigten Notizen</p>
                  <small>Erledigte Notizen landen hier — du kannst sie wiederherstellen oder endgültig löschen.</small>
                </div>
              ) : (
                <ul className="notes-archive-list">
                  {archivedNotes.map((note) => {
                    const colorMatch = (note.content || '').match(/^\[COLOR:([^\]]+)\]/);
                    const colorName = colorMatch ? colorMatch[1] : 'Gelb';
                    const color = NOTE_COLORS.find((c) => c.name === colorName) || NOTE_COLORS[0];
                    const text = (note.content || '').replace(/^\[COLOR:[^\]]+\]\s*/, '').trim() || '(leer)';
                    const completedAt = note.completed_at
                      ? new Date(note.completed_at).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '';
                    return (
                      <li key={note.id} className="notes-archive-item" style={{ borderLeftColor: color.border }}>
                        <div className="notes-archive-item-swatch" style={{ background: color.bg }} aria-hidden="true" />
                        <div className="notes-archive-item-body">
                          <p className="notes-archive-item-text" title={text}>{text}</p>
                          {completedAt && <span className="notes-archive-item-meta">Erledigt am {completedAt}</span>}
                        </div>
                        <div className="notes-archive-item-actions">
                          <button
                            type="button"
                            className="notes-archive-btn restore"
                            onClick={() => handleRestoreArchived(note.id)}
                            title="Wiederherstellen"
                          >
                            <RotateCcw size={14} />
                            <span>Wiederherstellen</span>
                          </button>
                          <button
                            type="button"
                            className="notes-archive-btn danger"
                            onClick={() => {
                              if (window.confirm('Notiz endgültig löschen?')) handleDeleteNote(note.id);
                            }}
                            title="Endgültig löschen"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}