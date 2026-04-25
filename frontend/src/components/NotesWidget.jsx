import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Plus, ArrowRight, Calendar } from 'lucide-react';
import { useNotesStore } from '../store/notesStore';
import { useEffect } from 'react';
import './NotesWidget.css';

export default function NotesWidget() {
  const { notes, fetchNotes } = useNotesStore();

  useEffect(() => {
    fetchNotes?.();
  }, []);

  // Get urgent and recent notes
  const urgentNotes = notes
    .filter(n => {
      if (!n.date) return false;
      const noteDate = new Date(n.date);
      const now = new Date();
      const diffDays = (noteDate - now) / (1000 * 60 * 60 * 24);
      return diffDays <= 1 && diffDays >= 0;
    })
    .slice(0, 3);

  const recentNotes = notes
    .filter(n => n.importance === 'high')
    .slice(0, 3);

  if (notes.length === 0) {
    return (
      <motion.div
        className="notes-widget"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="widget-header">
          <h3>Thoughts Board</h3>
          <Link to="/notes" className="widget-link">
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className="widget-empty">
          <p className="empty-text">Keine Notes vorhanden</p>
          <Link to="/notes" className="widget-create-btn">
            <Plus size={16} />
            Erste Note erstellen
          </Link>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="notes-widget"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
    >
      <div className="widget-header">
        <div>
          <h3>Thoughts Board</h3>
          <p className="widget-subtitle">{notes.length} Notes</p>
        </div>
        <Link to="/notes" className="widget-link" title="Zur Notes-Seite">
          <ArrowRight size={16} />
        </Link>
      </div>

      {/* Urgent Notes */}
      {urgentNotes.length > 0 && (
        <div className="widget-section">
          <p className="section-title">🔔 Dringend</p>
          <div className="notes-list">
            {urgentNotes.map(note => (
              <div key={note.id} className="note-item urgent">
                <div className="note-item-title">{note.title}</div>
                <div className="note-item-meta">
                  <Calendar size={12} />
                  {new Date(note.date).toLocaleDateString('de-DE', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* High Priority Notes */}
      {recentNotes.length > 0 && (
        <div className="widget-section">
          <p className="section-title">⭐ Wichtig</p>
          <div className="notes-list">
            {recentNotes.map(note => (
              <div key={note.id} className="note-item">
                <div className="note-item-title">{note.title}</div>
                <div className="note-item-preview">{note.content?.substring(0, 40)}...</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Link to="/notes" className="widget-footer-btn">
        <Plus size={16} />
        Neue Note
      </Link>
    </motion.div>
  );
}
