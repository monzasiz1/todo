import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, ArrowUp, Calendar, Clock, Tag, Flag, Loader2, Pencil, ChevronLeft } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useTaskStore } from '../store/taskStore';
import ManualTaskForm from './ManualTaskForm';
import TaskCard from './TaskCard';
import AvatarBadge from './AvatarBadge';

const priorityLabels = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  urgent: 'Dringend',
};

export default function DayCreateModal({ date, tasks, onClose, onTaskCreated }) {
  const [mode, setMode] = useState(null); // null | 'ai' | 'manual'
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const { aiCreateTask, aiParseOnly } = useTaskStore();

  const dateStr = format(date, 'EEEE, d. MMMM yyyy', { locale: de });

  // Focus AI input when mode switches
  useEffect(() => {
    if (mode === 'ai') {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [mode]);

  // Debounced preview for AI
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (aiInput.trim().length > 3) {
      debounceRef.current = setTimeout(async () => {
        const parsed = await aiParseOnly(aiInput);
        if (parsed) {
          setPreview(parsed);
          setShowPreview(true);
        }
      }, 800);
    } else {
      setShowPreview(false);
      setPreview(null);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [aiInput]);

  const handleAiSubmit = async (e) => {
    e.preventDefault();
    if (!aiInput.trim() || aiLoading) return;
    setAiLoading(true);
    setShowPreview(false);

    // Append date context so AI knows which day
    const formattedDate = format(date, 'd. MMMM yyyy', { locale: de });
    const textWithDate = `${aiInput.trim()} am ${formattedDate}`;

    const result = await aiCreateTask(textWithDate);
    if (result) {
      setAiInput('');
      setPreview(null);
      onTaskCreated?.();
      onClose();
    }
    setAiLoading(false);
  };

  const handleManualCreated = () => {
    onTaskCreated?.();
    onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return createPortal(
    <motion.div
      className="modal-overlay"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="day-create-modal"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', damping: 28, stiffness: 350 }}
      >
        {/* Header */}
        <div className="day-create-header">
          <div>
            <div className="day-create-date">{dateStr}</div>
            <div className="day-create-count">
              {tasks.length} Aufgabe{tasks.length !== 1 ? 'n' : ''}
            </div>
          </div>
          <button className="day-create-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Existing Tasks */}
        {tasks.length > 0 && (
          <div className="day-create-tasks">
            {tasks.map((task) => (
              <div
                key={task.id}
                className={`day-create-task-item ${task.completed ? 'completed' : ''}`}
                style={{
                  borderLeft: `3px solid ${task.group_id ? (task.group_color || '#5856D6') : (task.category_color || 'var(--primary)')}`,
                  background: task.group_id
                    ? `${task.group_color || '#5856D6'}10`
                    : task.category_color ? `${task.category_color}10` : 'var(--hover)',
                }}
              >
                <div className="day-create-task-info">
                  {task.group_id && (
                    <AvatarBadge
                      name={task.group_name}
                      color={task.group_color || '#5856D6'}
                      avatarUrl={task.group_image_url}
                      size={14}
                    />
                  )}
                  <span className={`day-create-task-title ${task.completed ? 'completed' : ''}`}>
                    {task.title}
                  </span>
                </div>
                {task.time && (
                  <span className="day-create-task-time">{task.time.slice(0, 5)}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Mode Selection */}
        <AnimatePresence mode="wait">
          {!mode && (
            <motion.div
              className="day-create-actions"
              key="actions"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              <motion.button
                className="day-create-action-btn ai"
                onClick={() => setMode('ai')}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
              >
                <div className="day-create-action-icon ai">
                  <Sparkles size={20} />
                </div>
                <div className="day-create-action-text">
                  <strong>Mit KI erstellen</strong>
                  <span>Beschreib deine Aufgabe natürlich</span>
                </div>
              </motion.button>
              <motion.button
                className="day-create-action-btn manual"
                onClick={() => setMode('manual')}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
              >
                <div className="day-create-action-icon manual">
                  <Pencil size={20} />
                </div>
                <div className="day-create-action-text">
                  <strong>Manuell erstellen</strong>
                  <span>Alle Felder selbst ausfüllen</span>
                </div>
              </motion.button>
            </motion.div>
          )}

          {/* AI Mode */}
          {mode === 'ai' && (
            <motion.div
              className="day-create-form-section"
              key="ai"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              <button className="day-create-back" onClick={() => setMode(null)}>
                <ChevronLeft size={16} />
                Zurück
              </button>
              <form onSubmit={handleAiSubmit} className="day-create-ai-form">
                <div className="day-create-ai-input-row">
                  <div className="day-create-ai-icon">
                    <Sparkles size={18} />
                  </div>
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="z.B. Meeting um 14 Uhr mit Team"
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    disabled={aiLoading}
                    className="day-create-ai-input"
                    autoComplete="off"
                  />
                  <motion.button
                    type="submit"
                    className="day-create-ai-submit"
                    disabled={!aiInput.trim() || aiLoading}
                    whileTap={{ scale: 0.9 }}
                  >
                    {aiLoading ? (
                      <Loader2 size={18} className="spinner" style={{ border: 'none', animation: 'spin 0.6s linear infinite' }} />
                    ) : (
                      <ArrowUp size={18} />
                    )}
                  </motion.button>
                </div>

                {/* AI Preview Tags */}
                <AnimatePresence>
                  {showPreview && preview && (
                    <motion.div
                      className="day-create-ai-preview"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      {preview.title && (
                        <span className="ai-tag"><Tag size={12} />{preview.title}</span>
                      )}
                      {preview.date && (
                        <span className="ai-tag date"><Calendar size={12} />{preview.date}</span>
                      )}
                      {preview.time && (
                        <span className="ai-tag time"><Clock size={12} />{preview.time}</span>
                      )}
                      {preview.category && (
                        <span className="ai-tag category">{preview.category}</span>
                      )}
                      {preview.priority && preview.priority !== 'medium' && (
                        <span className="ai-tag priority">
                          <Flag size={12} />{priorityLabels[preview.priority] || preview.priority}
                        </span>
                      )}
                      {preview.group_name && (
                        <span className="ai-tag group">
                          <AvatarBadge
                            name={preview.group_name}
                            color={preview.group_color || '#5856D6'}
                            avatarUrl={preview.group_image_url}
                            size={12}
                          />
                          {preview.group_name}
                        </span>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </form>
            </motion.div>
          )}

          {/* Manual Mode */}
          {mode === 'manual' && (
            <motion.div
              className="day-create-form-section"
              key="manual"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              <button className="day-create-back" onClick={() => setMode(null)}>
                <ChevronLeft size={16} />
                Zurück
              </button>
              <ManualTaskForm
                onTaskCreated={handleManualCreated}
                defaultDate={date}
                embedded
                onCancel={() => setMode(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>,
    document.body
  );
}
