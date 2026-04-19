import { useState, useRef, useEffect } from 'react';
import { useTaskStore } from '../store/taskStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowUp, Calendar, Clock, Tag, Flag, Loader2, UsersRound } from 'lucide-react';
import AvatarBadge from './AvatarBadge';

export default function AIInput({ onTaskCreated }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const { aiCreateTask, aiParseOnly } = useTaskStore();

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

    const result = await aiCreateTask(input.trim());

    if (result) {
      setInput('');
      setPreview(null);
      onTaskCreated?.();
    }

    setLoading(false);
    inputRef.current?.focus();
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
          className="ai-input-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
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
              💡 Beispiele: "Freitag Reinigung 18 Uhr" · "Erinnere mich morgen an Rechnung" · "Dringend: Meeting vorbereiten"
            </div>
          )}
        </motion.div>
      </form>
    </div>
  );
}
