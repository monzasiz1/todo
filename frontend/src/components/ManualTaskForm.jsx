import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Calendar, Clock, FileText, Flag, Plus, Save, Tag } from 'lucide-react';
import { useTaskStore } from '../store/taskStore';

const PRIORITIES = [
  { value: 'low', label: 'Niedrig', color: 'var(--success)' },
  { value: 'medium', label: 'Mittel', color: 'var(--primary)' },
  { value: 'high', label: 'Hoch', color: 'var(--warning)' },
  { value: 'urgent', label: 'Dringend', color: 'var(--danger)' },
];

function toDateValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.substring(0, 10);
  return value.toISOString().split('T')[0];
}

export default function ManualTaskForm({ onTaskCreated, defaultDate = null }) {
  const { createTask, categories, fetchCategories } = useTaskStore();
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(toDateValue(defaultDate));
  const [dateEnd, setDateEnd] = useState('');
  const [time, setTime] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [priority, setPriority] = useState('medium');
  const [categoryId, setCategoryId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (categories.length === 0) fetchCategories();
  }, []);

  useEffect(() => {
    if (!defaultDate) return;
    setDate((current) => current || toDateValue(defaultDate));
  }, [defaultDate]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setDate(toDateValue(defaultDate));
    setDateEnd('');
    setTime('');
    setTimeEnd('');
    setPriority('medium');
    setCategoryId('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || saving) return;

    setSaving(true);
    try {
      const task = await createTask({
        title: title.trim(),
        description: description.trim() || null,
        date: date || null,
        date_end: dateEnd || null,
        time: time || null,
        time_end: timeEnd || null,
        priority,
        category_id: categoryId || null,
      });

      if (task) {
        resetForm();
        setIsOpen(false);
        onTaskCreated?.(task);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: 16, marginBottom: 20 }}>
      <button
        className="group-action-btn"
        onClick={() => setIsOpen((current) => !current)}
        style={{ width: '100%', justifyContent: 'center' }}
      >
        <Plus size={18} />
        {isOpen ? 'Manuelle Eingabe schließen' : 'Aufgabe / Termin manuell erstellen'}
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.form
            onSubmit={handleSubmit}
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            style={{
              overflow: 'hidden',
              marginTop: 12,
              padding: 18,
              borderRadius: 20,
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Manuell erstellen</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Für Aufgaben und Termine mit Datum, Uhrzeit und optionalem Zeitraum.
              </div>
            </div>

            <div className="task-edit-field" style={{ marginBottom: 0 }}>
              <label><FileText size={14} /> Titel</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="z.B. Probe, Zahnarzt, Rechnung bezahlen"
                className="task-edit-input"
                autoFocus
              />
            </div>

            <div className="task-edit-field" style={{ marginBottom: 0 }}>
              <label><FileText size={14} /> Beschreibung</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional: Details oder Notizen"
                className="task-edit-input task-edit-textarea"
                rows={3}
              />
            </div>

            <div className="task-edit-row">
              <div className="task-edit-field flex-1" style={{ marginBottom: 0 }}>
                <label><Calendar size={14} /> Datum</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="task-edit-input" />
              </div>
              <div className="task-edit-field flex-1" style={{ marginBottom: 0 }}>
                <label><Calendar size={14} /> Enddatum</label>
                <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="task-edit-input" />
              </div>
            </div>

            <div className="task-edit-row">
              <div className="task-edit-field flex-1" style={{ marginBottom: 0 }}>
                <label><Clock size={14} /> Uhrzeit</label>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="task-edit-input" />
              </div>
              <div className="task-edit-field flex-1" style={{ marginBottom: 0 }}>
                <label><Clock size={14} /> Endzeit</label>
                <input type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} className="task-edit-input" />
              </div>
            </div>

            <div className="task-edit-field" style={{ marginBottom: 0 }}>
              <label><Flag size={14} /> Priorität</label>
              <div className="task-edit-priority-pills">
                {PRIORITIES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={`task-edit-pill ${priority === item.value ? 'active' : ''}`}
                    style={priority === item.value ? { background: item.color, color: '#fff' } : {}}
                    onClick={() => setPriority(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="task-edit-field" style={{ marginBottom: 0 }}>
              <label><Tag size={14} /> Kategorie</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="task-edit-input task-edit-select"
              >
                <option value="">Keine Kategorie</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="task-edit-cancel"
                onClick={() => {
                  resetForm();
                  setIsOpen(false);
                }}
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="task-edit-save"
                disabled={!title.trim() || saving}
              >
                <Save size={16} />
                {saving ? 'Erstellen...' : 'Erstellen'}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
