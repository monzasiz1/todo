import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { lockScroll, unlockScroll } from '../utils/scrollLock';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, ArrowUp, Calendar, CalendarCheck, Clock, Tag, Flag, Loader2, Pencil, ChevronLeft, ChevronRight, ListTodo, Video } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useTaskStore } from '../store/taskStore';
import ManualTaskForm from './ManualTaskForm';
import TaskDetailModal from './TaskDetailModal';
import AvatarBadge from './AvatarBadge';

const isDesktopBP = () =>
  typeof window !== 'undefined' && window.matchMedia('(min-width: 1025px)').matches;

const priorityLabels = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  urgent: 'Dringend',
};

function getEventEndDate(task) {
  if (!task?.date) return null;
  const datePart = String(task.date).slice(0, 10);
  const rawEnd = String(task.time_end || task.time || '23:59').slice(0, 5);
  const parts = rawEnd.split(':');
  const hh = String(Math.min(23, Math.max(0, Number(parts[0]) || 23))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, Number(parts[1]) || 59))).padStart(2, '0');
  const dt = new Date(`${datePart}T${hh}:${mm}:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function isEventEnded(task) {
  if (task?.type !== 'event') return false;
  const end = getEventEndDate(task);
  return !!end && end.getTime() < Date.now();
}

function isHolidayEntry(task) {
  return task?.isHoliday === true;
}

export default function DayCreateModal({ date, tasks, onClose, onTaskCreated, portalTarget }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState(null); // null | 'ai' | 'manual'
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [detailTask, setDetailTask] = useState(null);
  const [localTasks, setLocalTasks] = useState(tasks || []);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const swipeRef = useRef({ startY: 0, active: false });
  const pullRafRef = useRef(null);
  const pullNextRef = useRef(0);
  const pullOffsetRef = useRef(0);
  const [pullOffset, setPullOffset] = useState(0);
  const { aiCreateTask, aiParseOnly } = useTaskStore();
  // detected once — used for animation variant
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 1024;

  const dateStr = format(date, 'EEEE, d. MMMM yyyy', { locale: de });

  useEffect(() => {
    setLocalTasks(tasks || []);
  }, [tasks]);

  // Focus AI input when mode switches
  useEffect(() => {
    if (mode === 'ai') {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [mode]);

  // Debounced preview for AI
  useEffect(() => {
    let mounted = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (aiInput.trim().length > 3) {
      debounceRef.current = setTimeout(async () => {
        const parsed = await aiParseOnly(aiInput);
        if (parsed && mounted) {
          setPreview(parsed);
          setShowPreview(true);
        }
      }, 800);
    } else {
      setShowPreview(false);
      setPreview(null);
    }
    return () => {
      mounted = false;
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

  const handleTaskClick = (task) => {
    if (isHolidayEntry(task)) return;
    if (isDesktopBP()) {
      setDetailTask(task);
    } else {
      onClose();
      navigate(`/app/tasks/${task.id}`);
    }
  };

  useEffect(() => { lockScroll(); return () => unlockScroll(); }, []);

  const queuePullOffset = (next) => {
    pullNextRef.current = next;
    if (pullRafRef.current !== null) return;
    pullRafRef.current = window.requestAnimationFrame(() => {
      pullRafRef.current = null;
      setPullOffset((prev) => (prev === pullNextRef.current ? prev : pullNextRef.current));
    });
  };

  const handleTouchStart = (e) => {
    if (!isMobile) return;
    swipeRef.current = { startY: e.touches[0].clientY, active: true };
  };

  const handleTouchMove = (e) => {
    if (!isMobile || !swipeRef.current.active) return;
    const dy = e.touches[0].clientY - swipeRef.current.startY;
    if (dy <= 0 || e.currentTarget.scrollTop > 0) {
      if (pullOffsetRef.current !== 0) {
        pullOffsetRef.current = 0;
        queuePullOffset(0);
      }
      return;
    }
    if (e.cancelable) e.preventDefault();
    const maxPull = Math.max(420, (typeof window !== 'undefined' ? window.innerHeight : 800) - 28);
    const resisted = Math.min(dy * 0.95, maxPull);
    pullOffsetRef.current = resisted;
    queuePullOffset(resisted);
  };

  const handleTouchEnd = (e) => {
    if (!isMobile || !swipeRef.current.active) return;
    const dy = e.changedTouches[0].clientY - swipeRef.current.startY;
    swipeRef.current.active = false;
    const shouldClose = dy > 120 && e.currentTarget.scrollTop <= 0;
    pullOffsetRef.current = 0;
    queuePullOffset(0);
    if (shouldClose) onClose();
  };

  useEffect(() => {
    if (!isMobile) return;
    const stopBackgroundTouchWhilePulling = (e) => {
      if (pullOffsetRef.current > 0 && e.cancelable) e.preventDefault();
    };
    document.addEventListener('touchmove', stopBackgroundTouchWhilePulling, { passive: false });
    return () => document.removeEventListener('touchmove', stopBackgroundTouchWhilePulling);
  }, [isMobile]);

  useEffect(() => {
    return () => {
      if (pullRafRef.current !== null) window.cancelAnimationFrame(pullRafRef.current);
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const modalInner = (
    <>
      <motion.div
        className={`day-create-modal${isMobile ? ' is-mobile-fullscreen day-create-fullscreen' : ''}`}
        onClick={(e) => e.stopPropagation()}
        initial={isMobile ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 16 }}
        animate={isMobile ? { y: pullOffset } : { opacity: 1, scale: 1, y: 0 }}
        exit={isMobile ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 16 }}
        transition={isMobile
          ? { type: 'tween', duration: pullOffset > 0 ? 0 : 0.16, ease: 'easeOut' }
          : { type: 'spring', damping: 28, stiffness: 350 }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag handle — mobile only */}
        <div className="modal-pull-handle day-create-drag-handle" />

        {/* Header */}
        <div className="day-create-header">
          <div>
            <div className="day-create-date">{dateStr}</div>
            {localTasks.length > 0 && (
              <div className="day-create-count">
                {localTasks.length} {localTasks.length === 1 ? 'Eintrag' : 'Einträge'}
              </div>
            )}
          </div>
          <button className="day-create-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Existing Tasks */}
        {tasks.length > 0 && (
          <div className="day-create-tasks">
            {localTasks.map((task) => (
              (() => {
                const endedEvent = isEventEnded(task);
                const holidayEntry = isHolidayEntry(task);
                const catColor = task.group_category_color || task.category_color;
                const accentColor = catColor || (task.group_id ? (task.group_color || '#5856D6') : null);
                const catName = task.group_category_name || task.category;
                return (
              <div
                key={task.id}
                className={`day-create-task-item ${task.completed ? 'completed' : ''} ${endedEvent ? 'ended-event' : ''} ${holidayEntry ? 'holiday-entry' : ''}`}
                style={{
                  borderLeft: `3px solid ${holidayEntry ? '#D92C2C' : (endedEvent ? 'rgba(142,142,147,0.28)' : (accentColor || 'var(--primary)'))}`,
                  background: holidayEntry
                    ? 'rgba(217,44,44,0.08)'
                    : endedEvent
                    ? 'rgba(142, 142, 147, 0.10)'
                    : accentColor ? `${accentColor}12` : 'var(--hover)',
                  cursor: holidayEntry ? 'default' : 'pointer',
                }}
                onClick={() => handleTaskClick(task)}
              >
                <div className="day-create-task-info">
                  <div className="day-create-task-main">
                    {task.type === 'event' && (
                      <CalendarCheck size={14} style={{ color: '#AF52DE', flexShrink: 0 }} />
                    )}
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
                    {holidayEntry && <span className="day-create-task-status">Feiertag</span>}
                    {task.teams_join_url && (
                      <span className="day-create-task-chip teams">
                        <Video size={11} /> Teams
                      </span>
                    )}
                    {endedEvent && <span className="day-create-task-status">Beendet</span>}
                  </div>
                  {catName && !endedEvent && !holidayEntry && (
                    <div className="day-create-task-cat">
                      <span
                        className="day-create-task-cat-dot"
                        style={{ background: catColor || '#8E8E93' }}
                      />
                      <span className="day-create-task-cat-label">{catName}</span>
                    </div>
                  )}
                </div>
                {task.time && (
                  <span className="day-create-task-time">{task.time.slice(0, 5)}</span>
                )}
              </div>
                );
              })()
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
                whileTap={{ scale: 0.97 }}
              >
                <div className="day-create-action-icon ai">
                  <Sparkles size={20} />
                </div>
                <div className="day-create-action-text">
                  <strong>Mit KI erstellen</strong>
                  <span>Beschreib deine Aufgabe natürlich</span>
                </div>
                <ChevronRight size={16} className="day-create-action-arrow" />
              </motion.button>
              <motion.button
                className="day-create-action-btn manual"
                onClick={() => setMode('manual')}
                whileTap={{ scale: 0.97 }}
              >
                <div className="day-create-action-icon manual">
                  <Pencil size={20} />
                </div>
                <div className="day-create-action-text">
                  <strong>Manuell erstellen</strong>
                  <span>Alle Felder selbst ausfüllen</span>
                </div>
                <ChevronRight size={16} className="day-create-action-arrow" />
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
                      {preview.type && (
                        <span className={`ai-tag ${preview.type === 'event' ? 'event-type' : 'task-type'}`}>
                          {preview.type === 'event' ? <CalendarCheck size={12} /> : <ListTodo size={12} />}
                          {preview.type === 'event' ? 'Termin' : 'Aufgabe'}
                        </span>
                      )}
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
      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          onClose={() => setDetailTask(null)}
          onUpdated={(updatedTask) => {
            if (!updatedTask?.id) return;
            setLocalTasks((prev) => prev.map((item) => item.id === updatedTask.id ? { ...item, ...updatedTask } : item));
            setDetailTask((prev) => (prev?.id === updatedTask.id ? { ...prev, ...updatedTask } : prev));
          }}
        />
      )}
    </motion.div>
    </>
  );

  if (isMobile) {
    return createPortal(modalInner, portalTarget || document.body);
  }

  return createPortal(
    <motion.div
      className="modal-overlay day-create-overlay"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {modalInner}
    </motion.div>,
    portalTarget || document.body
  );
}
