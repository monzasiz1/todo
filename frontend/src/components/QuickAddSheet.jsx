import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ListTodo, X } from 'lucide-react';
import AIInput from './AIInput';
import ManualTaskForm from './ManualTaskForm';

export default function QuickAddSheet({ open, onClose }) {
  const [tab, setTab] = useState('ai');

  useEffect(() => {
    if (open) setTab('ai');
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="qas-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            className="qas-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
          >
            <div className="qas-handle" />

            {/* Header */}
            <div className="qas-header">
              <div className="qas-tabs">
                <button
                  className={`qas-tab ${tab === 'ai' ? 'active' : ''}`}
                  onClick={() => setTab('ai')}
                >
                  <Sparkles size={14} />
                  KI-Eingabe
                </button>
                <button
                  className={`qas-tab ${tab === 'manual' ? 'active' : ''}`}
                  onClick={() => setTab('manual')}
                >
                  <ListTodo size={14} />
                  Manuell
                </button>
              </div>
              <button className="qas-close" onClick={onClose}>
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="qas-content">
              {tab === 'ai' && (
                <div className="qas-ai-wrap">
                  <p className="qas-ai-hint">
                    Beschreibe deine Aufgabe oder deinen Termin — die KI erstellt ihn automatisch.
                  </p>
                  <AIInput onTaskCreated={onClose} />
                </div>
              )}

              {tab === 'manual' && (
                <ManualTaskForm
                  embedded
                  onTaskCreated={onClose}
                  onCancel={onClose}
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
