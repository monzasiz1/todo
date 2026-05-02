import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTaskStore } from '../store/taskStore';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';

const TYPE_CONFIG = {
  success: { Icon: CheckCircle2, symbol: '✓', color: '#34C759', bg: 'rgba(52,199,89,0.08)',  border: 'rgba(52,199,89,0.2)'  },
  error:   { Icon: XCircle,      symbol: '✕', color: '#FF3B30', bg: 'rgba(255,59,48,0.07)',  border: 'rgba(255,59,48,0.2)'  },
  info:    { Icon: Info,         symbol: 'i', color: '#007AFF', bg: 'rgba(0,122,255,0.07)',  border: 'rgba(0,122,255,0.2)'  },
  warning: { Icon: AlertTriangle,symbol: '!', color: '#FF9500', bg: 'rgba(255,149,0,0.07)',  border: 'rgba(255,149,0,0.2)'  },
};

export default function FeedbackToast() {
  const { toasts, removeToast } = useTaskStore();
  const [fromTop, setFromTop] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 1060 : false));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const media = window.matchMedia('(max-width: 1060px)');
    const handleChange = () => setFromTop(media.matches);
    handleChange();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  const handleAction = async (toast) => {
    if (typeof toast.onAction !== 'function') return;
    removeToast(toast.id);
    await toast.onAction();
  };

  return (
    <div className="toast-container">
      <AnimatePresence>
        {toasts.map((toast) => {
          const cfg = TYPE_CONFIG[toast.type] ?? TYPE_CONFIG.success;
          const { Icon, symbol, color, bg, border } = cfg;

          return (
            <motion.div
              key={toast.id}
              className="toast"
              style={{ '--t-color': color, '--t-bg': bg, '--t-border': border }}
              initial={{ opacity: 0, y: fromTop ? -28 : 32, scale: 0.92 }}
              animate={{ opacity: 1, y: 0,  scale: 1    }}
              exit={{    opacity: 0, y: fromTop ? -20 : 16,  scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            >
              <div className="toast__icon">
                <Icon size={17} strokeWidth={2.3} />
              </div>
              <span className="toast__msg"><span className="toast__symbol">{symbol}</span>{toast.message}</span>
              <div className="toast__actions">
                {toast.actionLabel && toast.onAction && (
                  <button
                    className="toast__action"
                    onClick={() => handleAction(toast)}
                  >
                    {toast.actionLabel}
                  </button>
                )}
                <button
                  className="toast__close"
                  onClick={() => removeToast(toast.id)}
                  aria-label="Schließen"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="toast__bar" style={{ animationDuration: `${toast.duration || 4000}ms` }} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
