import { useState, useRef, useEffect } from 'react';
import { useTaskStore } from '../store/taskStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowUp, Calendar, CalendarCheck, Clock, Tag, Flag, Loader2, UsersRound, ListTodo, Trash2, MoveRight, Pencil, Paperclip } from 'lucide-react';
import { api } from '../utils/api';
import AvatarBadge from './AvatarBadge';

export default function AIInput({ onTaskCreated }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [aiReply, setAiReply] = useState(null); // { question, answer } for query intent
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const attachFileRef = useRef(null);
  const attachTaskRef = useRef(null);
  const { aiCreateTask, aiParseOnly, addToast, fetchTasks } = useTaskStore();

  // Debounced preview
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (input.trim().length > 3) {
      debounceRef.current = setTimeout(async () => {
        const parsed = await aiParseOnly(input);
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
  }, [input]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    setLoading(true);
    setShowPreview(false);
    setAiReply(null);

    const question = input.trim();
    const result = await aiCreateTask(question);

    if (result) {
      setInput('');
      setPreview(null);

      // Query: show answer as chat bubble
      if (result.intent === 'query' && result.answer) {
        setAiReply({ question, answer: result.answer });
        setLoading(false);
        inputRef.current?.focus();
        return;
      }

      // If attach intent: open file picker for the matched task
      if (result.intent === 'attach' && result.success && result.task) {
        attachTaskRef.current = result.task;
        attachFileRef.current?.click();
      } else {
        onTaskCreated?.();
      }
    }

    setLoading(false);
    inputRef.current?.focus();
  };

  const handleAttachFile = async (e) => {
    const file = e.target.files?.[0];
    const task = attachTaskRef.current;
    if (!file || !task) return;

    if (file.size > 4 * 1024 * 1024) {
      addToast('Datei zu groß (max. 4 MB)', 'error');
      return;
    }

    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      await api.uploadAttachment(task.id, {
        file_name: file.name,
        file_type: file.type || 'application/octet-stream',
        file_data: base64,
      });

      addToast(`📎 "${file.name}" an "${task.title}" angehängt`);
      fetchTasks();
    } catch (err) {
      addToast('❌ ' + (err.message || 'Upload fehlgeschlagen'), 'error');
    } finally {
      if (attachFileRef.current) attachFileRef.current.value = '';
      attachTaskRef.current = null;
    }
  };

  const priorityLabels = {
    low: 'Niedrig',
    medium: 'Mittel',
    high: 'Hoch',
    urgent: 'Dringend',
  };

  return (
    <div className="ai-input-wrapper">
      <form onSubmit={handleSubmit}>
        <motion.div
          className="ai-input-glow-wrap"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <div className="ai-input-card">
          <div className="ai-input-main">
            <div className="ai-input-icon">
              <Sparkles size={22} />
            </div>
            <input
              ref={inputRef}
              type="text"
              className="ai-input-field"
              placeholder="Sag der KI was du tun möchtest..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              autoComplete="off"
            />
            <motion.button
              type="submit"
              className="ai-input-submit"
              disabled={!input.trim() || loading}
              whileTap={{ scale: 0.9 }}
            >
              {loading ? (
                <Loader2 size={20} className="spinner" style={{ border: 'none', animation: 'spin 0.6s linear infinite' }} />
              ) : (
                <ArrowUp size={20} />
              )}
            </motion.button>
          </div>

          {/* AI Preview Tags */}
          <AnimatePresence>
            {showPreview && preview && (
              <motion.div
                className="ai-input-preview"
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
                  <span className="ai-tag">
                    <Tag size={12} />
                    {preview.title}
                  </span>
                )}
                {preview.date && (
                  <span className="ai-tag date">
                    <Calendar size={12} />
                    {preview.date}
                  </span>
                )}
                {preview.time && (
                  <span className="ai-tag time">
                    <Clock size={12} />
                    {preview.time}
                  </span>
                )}
                {preview.category && (
                  <span className="ai-tag category">
                    {preview.category}
                  </span>
                )}
                {preview.priority && preview.priority !== 'medium' && (
                  <span className="ai-tag priority">
                    <Flag size={12} />
                    {priorityLabels[preview.priority] || preview.priority}
                  </span>
                )}
                {preview.group_name && (
                  <span className="ai-tag group">
                    {preview.group_image_url ? (
                      <AvatarBadge
                        name={preview.group_name}
                        color={preview.group_color || '#5856D6'}
                        avatarUrl={preview.group_image_url}
                        size={12}
                      />
                    ) : (
                      <UsersRound size={12} />
                    )}
                    {preview.group_name}
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {!showPreview && !loading && (
            <div className="ai-input-hint">
              💡 "Freitag Reinigung 18 Uhr" · "Lösche Zahnarzt" · "Wo hab ich noch Kapazitäten?" · "Wann kann ich zum Sport?"
            </div>
          )}
        </div>
        </motion.div>
      </form>

      {/* AI Calendar Query Reply Bubble */}
      <AnimatePresence>
        {aiReply && (
          <motion.div
            className="ai-reply-bubble"
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.25 }}
          >
            <div className="ai-reply-question">{aiReply.question}</div>
            <div className="ai-reply-answer">
              <div className="ai-reply-icon"><Sparkles size={15} /></div>
              <div className="ai-reply-text">{aiReply.answer}</div>
            </div>
            <button className="ai-reply-close" onClick={() => setAiReply(null)}>×</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden file input for AI attach intent */}
      <input
        ref={attachFileRef}
        type="file"
        onChange={handleAttachFile}
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
        style={{ display: 'none' }}
      />
    </div>
  );
}
