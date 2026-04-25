import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckSquare, CalendarDays, Clock, X } from 'lucide-react';
import { useTaskStore } from '../store/taskStore';
import { format } from 'date-fns';

const PRIORITIES = [
  { v: 'low',    l: 'Niedrig',  c: '#34C759' },
  { v: 'medium', l: 'Mittel',   c: '#007AFF' },
  { v: 'high',   l: 'Hoch',     c: '#FF9500' },
  { v: 'urgent', l: 'Dringend', c: '#FF3B30' },
];

export default function QuickAddSheet({ open, onClose }) {
  const { createTask } = useTaskStore();
  const [title, setTitle]       = useState('');
  const [type, setType]         = useState('task');
  const [date, setDate]         = useState('');
  const [time, setTime]         = useState('');
  const [priority, setPriority] = useState('medium');
  const [saving, setSaving]     = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setType('task');
      setDate(format(new Date(), 'yyyy-MM-dd'));
      setTime('');
      setPriority('medium');
      const t = setTimeout(() => inputRef.current?.focus(), 320);
      return () => clearTimeout(t);
    }
  }, [open]);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await createTask({
        title: title.trim(),
        type,
        date: date || null,
        time: time || null,
        priority,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="qas-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />

          <motion.div
            className="qas-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
          >
            <div className="qas-handle" />

            <div className="qas-header">
              <div className="qas-type-toggle">
                <button
                  type="button"
                  className={`qas-type-btn ${type === 'task' ? 'active' : ''}`}
                  onClick={() => setType('task')}
                >
                  <CheckSquare size={15} />
                  Aufgabe
                </button>
                <button
                  type="button"
                  className={`qas-type-btn ${type === 'event' ? 'active' : ''}`}
                  onClick={() => setType('event')}
                >
                  <CalendarDays size={15} />
                  Termin
                </button>
              </div>
              <button className="qas-close" onClick={onClose} type="button">
                <X size={18} />
              </button>
            </div>

            <form className="qas-form" onSubmit={handleSubmit}>
              <input
                ref={inputRef}
                className="qas-input"
                placeholder={type === 'event' ? 'Termin benennen…' : 'Was muss erledigt werden?'}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

              <div className="qas-row">
                <label className="qas-field">
                  <CalendarDays size={14} />
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label className="qas-field">
                  <Clock size={14} />
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    placeholder="Uhrzeit"
                  />
                </label>
              </div>

              <div className="qas-priorities">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.v}
                    type="button"
                    className={`qas-pill ${priority === p.v ? 'active' : ''}`}
                    style={priority === p.v ? { background: p.c, borderColor: p.c, color: '#fff' } : {}}
                    onClick={() => setPriority(p.v)}
                  >
                    {p.l}
                  </button>
                ))}
              </div>

              <button
                type="submit"
                className="qas-submit"
                disabled={!title.trim() || saving}
              >
                {saving
                  ? 'Speichern…'
                  : type === 'event'
                  ? 'Termin speichern'
                  : 'Aufgabe speichern'}
              </button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
