import { useState, useRef, useEffect } from 'react';
import { Plus, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import '../styles/notes.css';

export default function NotesPage() {
  const [notes, setNotes] = useState(() => {
    const saved = localStorage.getItem('taski_notes');
    return saved ? JSON.parse(saved) : [
      {
        id: 1,
        title: 'Project Kickoff',
        content: 'Define scope, team roles, and timeline for Q2 launch',
        importance: 'high',
        date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        x: 50,
        y: 80,
        width: 300,
        height: 150,
      },
      {
        id: 2,
        title: 'Design System',
        content: 'Create comprehensive component library with Figma documentation',
        importance: 'medium',
        date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        x: 400,
        y: 100,
        width: 300,
        height: 150,
      },
      {
        id: 3,
        title: 'Client Feedback',
        content: 'Gather requirements from stakeholders about new features',
        importance: 'medium',
        x: 750,
        y: 150,
        width: 300,
        height: 150,
      },
      {
        id: 4,
        title: 'Code Review Process',
        content: 'Establish standards and documentation for peer reviews',
        importance: 'low',
        date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        x: 200,
        y: 400,
        width: 300,
        height: 150,
      },
      {
        id: 5,
        title: 'Performance Optimization',
        content: 'Reduce bundle size and improve Core Web Vitals',
        importance: 'high',
        date: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        x: 550,
        y: 350,
        width: 300,
        height: 150,
      },
    ];
  });

  const [zoom, setZoom] = useState(100);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [newNote, setNewNote] = useState({ title: '', content: '', importance: 'medium', date: '' });
  const [isDragging, setIsDragging] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef(null);

  // Save notes to localStorage
  useEffect(() => {
    localStorage.setItem('taski_notes', JSON.stringify(notes));
  }, [notes]);

  // Handle canvas pan and drag
  const handleCanvasMouseDown = (e) => {
    if (e.target === canvasRef.current || e.target.classList.contains('notes-canvas')) {
      setIsDragging({ x: e.clientX, y: e.clientY });
    }
  };

  const handleCanvasMouseMove = (e) => {
    if (isDragging && canvasRef.current) {
      const deltaX = e.clientX - isDragging.x;
      const deltaY = e.clientY - isDragging.y;
      canvasRef.current.scrollLeft -= deltaX;
      canvasRef.current.scrollTop -= deltaY;
      setIsDragging({ x: e.clientX, y: e.clientY });
    }
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(null);
  };

  // Handle note dragging
  const handleNoteMouseDown = (e, noteId) => {
    if (e.button !== 0) return; // Only left click
    e.stopPropagation();
    const note = notes.find(n => n.id === noteId);
    if (!note) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const canvasRect = canvasRef.current.getBoundingClientRect();

    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setIsDragging({ noteId, startX: e.clientX, startY: e.clientY });
  };

  const handleMouseMove = (e) => {
    if (isDragging && isDragging.noteId && canvasRef.current) {
      const deltaX = e.clientX - isDragging.startX;
      const deltaY = e.clientY - isDragging.startY;
      const canvasRect = canvasRef.current.getBoundingClientRect();

      setNotes(notes.map(n =>
        n.id === isDragging.noteId
          ? {
              ...n,
              x: Math.max(0, n.x + deltaX / (zoom / 100)),
              y: Math.max(0, n.y + deltaY / (zoom / 100)),
            }
          : n
      ));

      setIsDragging(prev => ({
        ...prev,
        startX: e.clientX,
        startY: e.clientY,
      }));
    } else if (isDragging && !isDragging.noteId) {
      handleCanvasMouseMove(e);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(null);
  };

  const createNote = () => {
    if (!newNote.title.trim()) return;

    const newNoteData = {
      id: Math.max(...notes.map(n => n.id), 0) + 1,
      title: newNote.title,
      content: newNote.content,
      importance: newNote.importance,
      date: newNote.date,
      x: 100 + notes.length * 50,
      y: 100 + notes.length * 50,
      width: 300,
      height: 150,
    };

    setNotes([...notes, newNoteData]);
    setNewNote({ title: '', content: '', importance: 'medium', date: '' });
    setShowCreateModal(false);
  };

  const updateNote = () => {
    if (!editingNote.title.trim()) return;

    setNotes(notes.map(n =>
      n.id === editingNote.id
        ? {
            ...editingNote,
            width: 300,
            height: 150,
          }
        : n
    ));
    setEditingNote(null);
  };

  const deleteNote = (id) => {
    if (confirm('Diese Note wirklich löschen?')) {
      setNotes(notes.filter(n => n.id !== id));
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

  return (
    <div className="notes-container" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      {/* Header */}
      <div className="notes-header">
        <div>
          <h1 className="notes-title">Thoughts Board</h1>
          <p className="notes-subtitle">Deine kreative Ideensammlung</p>
        </div>
        <div className="notes-controls">
          <button
            className="zoom-btn"
            onClick={() => setZoom(Math.max(50, zoom - 10))}
            title="Zoom out"
          >
            <ZoomOut size={18} />
          </button>
          <span className="zoom-display">{zoom}%</span>
          <button
            className="zoom-btn"
            onClick={() => setZoom(Math.min(200, zoom + 10))}
            title="Zoom in"
          >
            <ZoomIn size={18} />
          </button>
          <button
            className="zoom-btn"
            onClick={() => setZoom(100)}
            title="Reset zoom"
          >
            <Maximize2 size={18} />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        className="notes-canvas"
        ref={canvasRef}
        onMouseDown={handleCanvasMouseDown}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        style={{ cursor: isDragging && !isDragging.noteId ? 'grabbing' : 'grab' }}
      >
        <div className="canvas-content" style={{ transform: `scale(${zoom / 100})`, transformOrigin: '0 0' }}>
          {/* SVG Connections */}
          <svg className="connections-svg">
            {/* Example connections - can be extended */}
          </svg>

          {/* Notes Grid */}
          {notes.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-text">Keine Notes vorhanden</p>
              <p className="empty-state-subtitle">Klicke "Neue Note", um zu beginnen</p>
            </div>
          ) : (
            notes.map(note => (
              <div
                key={note.id}
                className={`note-card note-${note.importance} ${isUrgent(note.date) ? 'note-urgent' : ''}`}
                style={{
                  left: `${note.x}px`,
                  top: `${note.y}px`,
                  width: `${note.width}px`,
                  minHeight: `${note.height}px`,
                }}
                onMouseDown={e => handleNoteMouseDown(e, note.id)}
              >
                <div className="note-header">
                  <h3 className="note-title">{note.title}</h3>
                  <div className="note-importance" style={{ borderColor: getImportanceColor(note.importance).border }}>
                    {note.importance === 'high' && '⭐'}
                    {note.importance === 'medium' && '●'}
                    {note.importance === 'low' && '−'}
                  </div>
                </div>

                <p className="note-content">{note.content}</p>

                {note.date && (
                  <div className={`note-date ${isUrgent(note.date) ? 'urgent' : ''}`}>
                    📅 {new Date(note.date).toLocaleDateString('de-DE')}
                  </div>
                )}

                <div className="note-actions">
                  <button
                    className="action-btn edit-btn"
                    onClick={() => setEditingNote(note)}
                    title="Bearbeiten"
                  >
                    ✎
                  </button>
                  <button
                    className="action-btn delete-btn"
                    onClick={() => deleteNote(note.id)}
                    title="Löschen"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Create Button */}
      <button
        className="create-note-btn"
        onClick={() => setShowCreateModal(true)}
        title="Neue Note erstellen"
      >
        <Plus size={24} />
        <span>Neue Note</span>
      </button>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Neue Note</h2>

            <div className="form-group">
              <label className="form-label">Titel</label>
              <input
                type="text"
                className="form-input"
                placeholder="Note-Titel eingeben..."
                value={newNote.title}
                onChange={e => setNewNote({ ...newNote, title: e.target.value })}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Inhalt</label>
              <textarea
                className="form-textarea"
                placeholder="Deine Gedanken hier..."
                value={newNote.content}
                onChange={e => setNewNote({ ...newNote, content: e.target.value })}
                rows="4"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Wichtigkeit</label>
              <div className="importance-selector">
                {['high', 'medium', 'low'].map(level => (
                  <label key={level} className={`importance-option ${newNote.importance === level ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="importance"
                      value={level}
                      checked={newNote.importance === level}
                      onChange={e => setNewNote({ ...newNote, importance: e.target.value })}
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
                onChange={e => setNewNote({ ...newNote, date: e.target.value })}
              />
            </div>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                Abbrechen
              </button>
              <button className="btn-primary" onClick={createNote}>
                Note erstellen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingNote && (
        <div className="modal-overlay" onClick={() => setEditingNote(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Note bearbeiten</h2>

            <div className="form-group">
              <label className="form-label">Titel</label>
              <input
                type="text"
                className="form-input"
                value={editingNote.title}
                onChange={e => setEditingNote({ ...editingNote, title: e.target.value })}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Inhalt</label>
              <textarea
                className="form-textarea"
                value={editingNote.content}
                onChange={e => setEditingNote({ ...editingNote, content: e.target.value })}
                rows="4"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Wichtigkeit</label>
              <div className="importance-selector">
                {['high', 'medium', 'low'].map(level => (
                  <label key={level} className={`importance-option ${editingNote.importance === level ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="importance"
                      value={level}
                      checked={editingNote.importance === level}
                      onChange={e => setEditingNote({ ...editingNote, importance: e.target.value })}
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
                value={editingNote.date}
                onChange={e => setEditingNote({ ...editingNote, date: e.target.value })}
              />
            </div>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setEditingNote(null)}>
                Abbrechen
              </button>
              <button className="btn-primary" onClick={updateNote}>
                Änderungen speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
