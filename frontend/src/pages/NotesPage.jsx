import { useState, useRef, useEffect } from 'react';
import { Plus, ZoomIn, ZoomOut, Maximize2, Share2, Link2, Trash2, Edit2, X } from 'lucide-react';
import { useNotesStore } from '../store/notesStore';
import { useFriendsStore } from '../store/friendsStore';
import { useTaskStore } from '../store/taskStore';
import '../styles/notes.css';
import { motion, AnimatePresence } from 'framer-motion';

export default function NotesPage() {
  const { notes, createNote, updateNote, deleteNote, linkNoteToTask, shareNoteWithFriend, connectNotes } = useNotesStore();
  const { friends } = useFriendsStore();
  const { tasks } = useTaskStore();

  const [zoom, setZoom] = useState(100);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [selectedNote, setSelectedNote] = useState(null);
  const [showShareModal, setShowShareModal] = useState(null);
  const [showConnectModal, setShowConnectModal] = useState(null);
  const [newNote, setNewNote] = useState({ title: '', content: '', importance: 'medium', date: '', linked_task_id: null });
  const [isDragging, setIsDragging] = useState(null);
  const [notePositions, setNotePositions] = useState({});
  const canvasRef = useRef(null);

  // Load notes on mount
  useEffect(() => {
    useNotesStore.getState().fetchNotes?.();
  }, []);

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
      const noteData = {
        ...newNote,
        x: 100 + notes.length * 40,
        y: 100 + notes.length * 40,
        width: 300,
        height: 150,
      };
      await createNote(noteData);
      setNewNote({ title: '', content: '', importance: 'medium', date: '', linked_task_id: null });
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
      setShowConnectModal(null);
    } catch (err) {
      console.error('Connect notes error:', err);
    }
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

  return (
    <div className="notes-container" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      {/* Header */}
      <div className="notes-header">
        <div>
          <h1 className="notes-title">Thoughts Board</h1>
          <p className="notes-subtitle">Kreative Ideensammlung & Planung</p>
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

      {/* Canvas */}
      <div
        className="notes-canvas"
        ref={canvasRef}
        onMouseDown={handleCanvasMouseDown}
        style={{ cursor: isDragging?.isPan ? 'grabbing' : 'grab' }}
      >
        <div className="canvas-content" style={{ transform: `scale(${zoom / 100})`, transformOrigin: '0 0' }}>
          {/* SVG Connections */}
          <svg className="connections-svg">
            {/* Connection lines will be rendered here */}
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
                <motion.div
                  key={note.id}
                  className={`note-card note-${note.importance} ${isUrgent(note.date) ? 'note-urgent' : ''}`}
                  style={{
                    left: `${(notePositions[note.id]?.x ?? note.x ?? 100)}px`,
                    top: `${(notePositions[note.id]?.y ?? note.y ?? 100)}px`,
                    width: `${note.width || 300}px`,
                    minHeight: `${note.height || 150}px`,
                  }}
                  onMouseDown={(e) => handleNoteMouseDown(e, note.id)}
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
              ))
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Create Button */}
      <motion.button
        className="create-note-btn"
        onClick={() => setShowCreateModal(true)}
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
                <select
                  className="form-input"
                  value={newNote.linked_task_id || ''}
                  onChange={(e) => setNewNote({ ...newNote, linked_task_id: e.target.value || null })}
                >
                  <option value="">Keinen Termin wählen</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
                </select>
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

