import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Timer } from 'lucide-react';

const LS_KEY = 'beequ.focusTimer.v2';

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.endsAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function formatMMSS(seconds) {
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Schwebende Mini-Anzeige fuer den Fokus-Timer.
 * Erscheint, sobald der grosse Timer-Card NICHT mehr im Viewport ist
 * (z.B. nach Seitenwechsel oder Scroll). Klick fuehrt zurueck zum Dashboard.
 */
export default function FocusTimerPin() {
  const navigate = useNavigate();
  const [state, setState] = useState(() => loadState());
  const [now, setNow] = useState(() => Date.now());
  const [cardVisible, setCardVisible] = useState(false);

  // Poll localStorage (state change happens in FocusTimer component, no event bus)
  useEffect(() => {
    const id = window.setInterval(() => {
      setState(loadState());
      setNow(Date.now());
    }, 1000);
    const onStorage = (e) => {
      if (e.key === LS_KEY) setState(loadState());
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Beobachte den grossen Timer-Card. Wenn sichtbar -> Pin verstecken.
  useEffect(() => {
    let observer = null;
    let pollId = null;
    let attached = null;

    const attach = (el) => {
      if (!el || attached === el) return;
      if (observer) observer.disconnect();
      attached = el;
      observer = new IntersectionObserver(
        ([entry]) => setCardVisible(entry.isIntersecting && entry.intersectionRatio > 0.25),
        { threshold: [0, 0.25, 0.5, 1] }
      );
      observer.observe(el);
    };

    const detach = () => {
      if (observer) observer.disconnect();
      observer = null;
      attached = null;
      setCardVisible(false);
    };

    const scan = () => {
      const el = document.querySelector('.focus-timer-card');
      if (el) attach(el);
      else detach();
    };

    scan();
    pollId = window.setInterval(scan, 800);

    return () => {
      window.clearInterval(pollId);
      if (observer) observer.disconnect();
    };
  }, []);

  const remainingSec = useMemo(() => {
    if (!state) return 0;
    if (state.paused) return Math.max(0, state.remainingAtPauseSec || 0);
    return Math.max(0, Math.round((state.endsAt - now) / 1000));
  }, [state, now]);

  const progress = useMemo(() => {
    if (!state || !state.durationSec) return 0;
    return 1 - Math.min(1, Math.max(0, remainingSec / state.durationSec));
  }, [state, remainingSec]);

  const isActive = !!state && (state.paused || remainingSec > 0);
  const visible = isActive && !cardVisible;

  const RADIUS = 14;
  const STROKE = 3;
  const C = 2 * Math.PI * RADIUS;

  const handleClick = () => {
    navigate('/app');
    window.setTimeout(() => {
      try {
        const el = document.querySelector('.focus-timer-card');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch { /* ignore */ }
    }, 60);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          className={`focus-timer-pin ${state?.paused ? 'is-paused' : 'is-running'}`}
          onClick={handleClick}
          initial={{ opacity: 0, y: 16, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          aria-label="Fokus-Timer oeffnen"
        >
          <span className="focus-timer-pin-ring">
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r={RADIUS} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={STROKE} />
              <circle
                cx="18"
                cy="18"
                r={RADIUS}
                fill="none"
                stroke="url(#focusPinGrad)"
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - progress)}
                transform="rotate(-90 18 18)"
              />
              <defs>
                <linearGradient id="focusPinGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#22d3ee" />
                  <stop offset="60%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
            </svg>
            <Timer size={12} className="focus-timer-pin-icon" />
          </span>
          <span className="focus-timer-pin-body">
            <span className="focus-timer-pin-time">{formatMMSS(remainingSec)}</span>
            <span className="focus-timer-pin-label">
              {state?.paused ? 'Pausiert' : (state?.label?.trim() || 'Fokus')}
            </span>
          </span>
          <span className="focus-timer-pin-pulse" aria-hidden="true" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
