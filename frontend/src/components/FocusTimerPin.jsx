import { useEffect, useMemo, useRef, useState } from 'react';
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

// Shallow-Compare nur fuer die Felder, die das UI tatsaechlich rendert.
// Verhindert Re-Renders, wenn nur die Objekt-Referenz neu ist.
function sameTimerState(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.endsAt === b.endsAt
    && a.paused === b.paused
    && a.durationSec === b.durationSec
    && a.remainingAtPauseSec === b.remainingAtPauseSec
    && a.label === b.label;
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
export default function FocusTimerPin({ variant = 'desktop' }) {
  const navigate = useNavigate();
  const stateRef = useRef(loadState());
  const [state, setStateRaw] = useState(stateRef.current);
  const [now, setNow] = useState(() => Date.now());
  const [cardVisible, setCardVisible] = useState(false);

  // Schreibt State nur, wenn sich UI-relevante Felder geaendert haben.
  // Spart pro Sekunde mind. einen Render im typischen Idle-Fall.
  const setState = (next) => {
    if (sameTimerState(stateRef.current, next)) return;
    stateRef.current = next;
    setStateRaw(next);
  };

  // Event-getriebene Aktualisierung: FocusTimer.saveState() feuert
  // `beequ:focus-timer-changed`. Cross-Tab via natives `storage`-Event.
  // Eigener 1s-Tick aktualisiert nur die Restzeit-Anzeige.
  useEffect(() => {
    const sync = () => setState(loadState());
    const onStorage = (e) => { if (e.key === LS_KEY) sync(); };

    window.addEventListener('beequ:focus-timer-changed', sync);
    window.addEventListener('storage', onStorage);

    // Sekundentick nur fuer `now`; pausiert wenn Tab nicht sichtbar.
    let tickId = null;
    const startTick = () => {
      if (tickId) return;
      tickId = window.setInterval(() => setNow(Date.now()), 1000);
    };
    const stopTick = () => {
      if (tickId) { window.clearInterval(tickId); tickId = null; }
    };
    const onVisibility = () => {
      if (document.hidden) stopTick();
      else { sync(); setNow(Date.now()); startTick(); }
    };
    if (!document.hidden) startTick();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('beequ:focus-timer-changed', sync);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
      stopTick();
    };
  }, []);

  // Beobachte den grossen Timer-Card. Wenn sichtbar -> Pin verstecken.
  // MutationObserver triggert Re-Scan nur bei tatsaechlichen DOM-Aenderungen.
  useEffect(() => {
    let intersectionObserver = null;
    let mutationObserver = null;
    let attached = null;

    const attach = (el) => {
      if (!el || attached === el) return;
      if (intersectionObserver) intersectionObserver.disconnect();
      attached = el;
      intersectionObserver = new IntersectionObserver(
        ([entry]) => setCardVisible(entry.isIntersecting && entry.intersectionRatio > 0.25),
        { threshold: [0, 0.25, 0.5, 1] }
      );
      intersectionObserver.observe(el);
    };

    const detach = () => {
      if (intersectionObserver) intersectionObserver.disconnect();
      intersectionObserver = null;
      attached = null;
      setCardVisible(false);
    };

    const scan = () => {
      const el = document.querySelector('.focus-timer-card');
      if (el && el !== attached) attach(el);
      else if (!el && attached) detach();
    };

    scan();
    // Re-Scan nur wenn sich der DOM-Subtree aendert (Route-Wechsel, Modal etc.)
    mutationObserver = new MutationObserver(scan);
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      if (mutationObserver) mutationObserver.disconnect();
      if (intersectionObserver) intersectionObserver.disconnect();
    };
  }, []);

  const remainingSec = useMemo(() => {
    if (!state) return 0;
    if (state.paused) return Math.max(0, state.remainingAtPauseSec || 0);
    return Math.max(0, Math.round((state.endsAt - now) / 1000));
  }, [state, now]);

  // Hochaufloesender Fortschritt (Millisekunden-genau) fuer eine
  // butterweiche Ring-Animation entlang der Uhr.
  const progress = useMemo(() => {
    if (!state || !state.durationSec) return 0;
    if (state.paused) {
      const remMs = (state.remainingAtPauseSec || 0) * 1000;
      return 1 - Math.min(1, Math.max(0, remMs / (state.durationSec * 1000)));
    }
    const remMs = state.endsAt - now;
    return 1 - Math.min(1, Math.max(0, remMs / (state.durationSec * 1000)));
  }, [state, now]);

  const isActive = !!state && (state.paused || remainingSec > 0);
  // Header variant ist immer sichtbar, wenn Timer aktiv ist; Desktop-Pin
  // versteckt sich, sobald die grosse Card im Viewport ist.
  const visible = isActive && (variant === 'header' || !cardVisible);

  const RADIUS = 14;
  const STROKE = 4;
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
          className={`focus-timer-pin focus-timer-pin--${variant} ${state?.paused ? 'is-paused' : 'is-running'}`}
          onClick={handleClick}
          initial={{ opacity: 0, y: 16, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          aria-label="Fokus-Timer oeffnen"
        >
          <span className="focus-timer-pin-ring">
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r={RADIUS} fill="none" stroke="rgba(148,163,184,0.22)" strokeWidth={STROKE} />
              <circle
                className="focus-timer-pin-ring-progress"
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
            <Timer size={10} className="focus-timer-pin-icon" strokeWidth={2.4} />
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
