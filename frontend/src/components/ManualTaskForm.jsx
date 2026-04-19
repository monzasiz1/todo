import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Calendar, Clock, FileText, Flag, Plus, Repeat, Save, Tag, UsersRound } from 'lucide-react';
import { useTaskStore } from '../store/taskStore';
import { api } from '../utils/api';
import AvatarBadge from './AvatarBadge';

const PRIORITIES = [
  { value: 'low', label: 'Niedrig', color: 'var(--success)' },
  { value: 'medium', label: 'Mittel', color: 'var(--primary)' },
  { value: 'high', label: 'Hoch', color: 'var(--warning)' },
  { value: 'urgent', label: 'Dringend', color: 'var(--danger)' },
];

const RECURRENCE_OPTIONS = [
  { value: '', label: 'Keine Wiederholung' },
  { value: 'daily', label: 'Täglich' },
  { value: 'weekdays', label: 'Werktags (Mo-Fr)' },
  { value: 'weekly', label: 'Wöchentlich' },
  { value: 'biweekly', label: 'Alle 2 Wochen' },
  { value: 'monthly', label: 'Monatlich' },
  { value: 'yearly', label: 'Jährlich' },
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
  const [reminderAt, setReminderAt] = useState('');
  const [recurrenceRule, setRecurrenceRule] = useState('');
  const [recurrenceEnd, setRecurrenceEnd] = useState('');
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (categories.length === 0) fetchCategories();
    loadGroups();
  }, []);

  const loadGroups = async () => {
    try {
      const data = await api.getGroups();
      setGroups(data.groups || []);
    } catch {
      setGroups([]);
    }
  };

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
    setReminderAt('');
    setRecurrenceRule('');
    setRecurrenceEnd('');
    setGroupId('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || saving) return;

    setSaving(true);
    try {
      const result = await createTask({
        title: title.trim(),
        description: description.trim() || null,
        date: date || null,
        date_end: dateEnd || null,
        time: time || null,
        time_end: timeEnd || null,
        priority,
        category_id: categoryId || null,
        reminder_at: reminderAt || null,
        recurrence_rule: recurrenceRule || null,
        recurrence_interval: recurrenceRule ? 1 : null,
        recurrence_end: recurrenceEnd || null,
        group_id: groupId || null,
      });

      if (result) {
        resetForm();
        setIsOpen(false);
        onTaskCreated?.(result);
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
                Für Aufgaben und Termine mit Datum, Uhrzeit, Erinnerung, Wiederholung und Gruppe.
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

            <div className="task-edit-field" style={{ marginBottom: 0 }}>
              <label><Bell size={14} /> Erinnerung</label>
              <input
                type="datetime-local"
                value={reminderAt}
                onChange={(e) => setReminderAt(e.target.value)}
                className="task-edit-input"
              />
            </div>

            <div className="task-edit-row">
              <div className="task-edit-field flex-1" style={{ marginBottom: 0 }}>
                <label><Repeat size={14} /> Wiederholung</label>
                <select
                  value={recurrenceRule}
                  onChange={(e) => setRecurrenceRule(e.target.value)}
                  className="task-edit-input task-edit-select"
                >
                  {RECURRENCE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="task-edit-field flex-1" style={{ marginBottom: 0 }}>
                <label><Calendar size={14} /> Wiederholen bis</label>
                <input
                  type="date"
                  value={recurrenceEnd}
                  onChange={(e) => setRecurrenceEnd(e.target.value)}
                  className="task-edit-input"
                  disabled={!recurrenceRule}
                />
              </div>
            </div>

            <div className="task-edit-field" style={{ marginBottom: 0 }}>
              <label><UsersRound size={14} /> Gruppe</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div
                  className={`task-edit-shared-item addable ${!groupId ? 'selected' : ''}`}
                  onClick={() => setGroupId('')}
                  style={{ cursor: 'pointer' }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
                    <Plus size={14} style={{ transform: 'rotate(45deg)' }} />
                  </div>
                  <span className="task-edit-friend-name">Keine Gruppe</span>
                </div>
                {groups.map((group) => (
                  <div
                    key={group.id}
                    className={`task-edit-shared-item addable ${String(groupId) === String(group.id) ? 'selected' : ''}`}
                    onClick={() => setGroupId(String(group.id))}
                    style={{ cursor: 'pointer' }}
                  >
                    <AvatarBadge
                      name={group.name}
                      color={group.color || '#007AFF'}
                      avatarUrl={group.image_url}
                      size={32}
                    />
                    <span className="task-edit-friend-name">{group.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{group.member_count} Mitglieder</span>
                  </div>
                ))}
                {groups.length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Keine Gruppen vorhanden.</div>
                )}
              </div>
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
