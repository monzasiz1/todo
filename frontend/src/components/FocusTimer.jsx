import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Timer, Play, Pause, RotateCcw, X, Bell, Sparkles } from 'lucide-react';
import { api } from '../utils/api';
import { useNotificationStore } from '../store/notificationStore';

/**
 * Fokus-Timer Widget
 * ──────────────────
 * Card auf dem Dashboard. Klick öffnet Dauer-Picker, Start registriert den
 * Timer ZUSÄTZLICH auf dem Server (POST /api/focus-timer). Damit feuert
 * der Vercel-Cron eine echte Web-Push-Notification, selbst wenn die App
 * gerade nicht offen ist.
 *
 * Sicherheits-Layers für die Benachrichtigung:
 *  1. Server-Push via cron + pushService (App geschlossen → Notification)
 *  2. Foreground-Notification + Audio + Vibration (App offen)
 *  3. Großes Finish-Overlay mit Konfetti-Bursts und Glow-Pulse (App offen)
 *  4. localStorage merkt sich endsAt → Reload-/Tab-resistent
 */
const LS_KEY = 'beequ.focusTimer.v2';
const PRESETS = [5, 10, 15, 25, 45];

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
function saveState(state) {
  try {
    if (!state) localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

function formatMMSS(seconds) {
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function playFinishSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const notes = [
      { f: 523.25, t: now,        d: 0.18 },
      { f: 659.25, t: now + 0.20, d: 0.18 },
      { f: 783.99, t: now + 0.40, d: 0.40 },
    ];
    notes.forEach(({ f, t, d }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + d + 0.05);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* ignore */ }
}

const CONFETTI = Array.from({ length: 36 }).map((_, i) => {
  const angle = (i / 36) * Math.PI * 2;
  const dist = 160 + Math.random() * 140;
  return {
    id: i,
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist,
    rot: Math.random() * 720 - 360,
    delay: Math.random() * 0.18,
    color: [
      '#ff6b8a', '#ff9a5a', '#ffd166', '#06d6a0', '#118ab2', '#7b61ff', '#ff8fab',
    ][i % 7],
  };
});

export default function FocusTimer() {
  const subscribePush = useNotificationStore((s) => s.subscribe);
  const subscribed    = useNotificationStore((s) => s.subscribed);

  const [open, setOpen] = useState(false);
  const [customMin, setCustomMin] = useState(25);
  const [label, setLabel] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [state, setState] = useState(() => loadState());
  const [showFinishOverlay, setShowFinishOverlay] = useState(false);
  const firedRef = useRef(false);

  // Re-hydrate from server (other devices / fresh tab)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getFocusTimer();
        if (cancelled || !data?.timer) return;
        const endsAt = new Date(data.timer.ends_at).getTime();
        if (!Number.isFinite(endsAt) || endsAt <= Date.now() - 60_000) return;
        setState((prev) => {
          if (!prev || Math.abs(prev.endsAt - endsAt) > 2000) {
            return {
              endsAt,
              durationSec: data.timer.duration_sec,
              paused: false,
              serverId: data.timer.id,
              label: data.timer.label || '',
            };
          }
          return prev;
        });
      } catch { /* offline / no auth */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!state) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state]);

  useEffect(() => { saveState(state); }, [state]);

  const remainingSec = useMemo(() => {
    if (!state) return 0;
    if (state.paused) return Math.max(0, state.remainingAtPauseSec || 0);
    return Math.max(0, Math.round((state.endsAt - now) / 1000));
  }, [state, now]);

  const progress = useMemo(() => {
    if (!state || !state.durationSec) return 0;
    return 1 - Math.min(1, Math.max(0, remainingSec / state.durationSec));
  }, [state, remainingSec]);

  // Fire-once on finish
  useEffect(() => {
    if (!state) return;
    if (state.paused) return;
    if (remainingSec > 0) return;
    if (firedRef.current) return;
    firedRef.current = true;
    setShowFinishOverlay(true);
    playFinishSound();
    try { if ('vibrate' in navigator) navigator.vibrate([220, 90, 220, 90, 480]); } catch { /* ignore */ }
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Fokus-Timer abgelaufen', {
          body: state.label
            ? `${state.label} - ${Math.round(state.durationSec / 60)} Minuten geschafft!`
            : `Deine ${Math.round(state.durationSec / 60)}-Minuten-Session ist vorbei.`,
          icon: '/icons/icon-192.png',
          tag: 'beequ-focus-timer',
        });
      }
    } catch { /* ignore */ }
  }, [remainingSec, state]);

  const closeFinishOverlay = useCallback(() => {
    setShowFinishOverlay(false);
    setState(null);
    firedRef.current = false;
  }, []);

  // Auto-close nach 12s
  useEffect(() => {
    if (!showFinishOverlay) return undefined;
    const id = window.setTimeout(closeFinishOverlay, 12000);
    return () => window.clearTimeout(id);
  }, [showFinishOverlay, closeFinishOverlay]);

  // Body-class toggeln, damit BottomNav versteckt wird, wenn Picker offen ist
  useEffect(() => {
    if (!open) return undefined;
    document.body.classList.add('focus-timer-modal-open');
    return () => document.body.classList.remove('focus-timer-modal-open');
  }, [open]);

  const ensurePushSubscribed = useCallback(async () => {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      if (Notification.permission !== 'granted') return;
      if (!subscribed) {
        await subscribePush();
      }
    } catch { /* ignore */ }
  }, [subscribePush, subscribed]);

  const startTimer = useCallback(async (minutes) => {
    if (!minutes || minutes <= 0) return;
    const durationSec = Math.round(minutes * 60);
    firedRef.current = false;
    setShowFinishOverlay(false);

    setState({
      endsAt: Date.now() + durationSec * 1000,
      durationSec,
      paused: false,
      label: label.trim() || '',
    });
    setOpen(false);

    await ensurePushSubscribed();

    try {
      const result = await api.startFocusTimer({
        durationSec,
        label: label.trim() || null,
      });
      if (result?.timer) {
        const serverEndsAt = new Date(result.timer.ends_at).getTime();
        setState((prev) => ({
          ...(prev || {}),
          endsAt: Number.isFinite(serverEndsAt) ? serverEndsAt : prev?.endsAt,
          durationSec: result.timer.duration_sec,
          paused: false,
          serverId: result.timer.id,
          label: result.timer.label || '',
        }));
      }
    } catch (err) {
      console.warn('[FocusTimer] Server-Registrierung fehlgeschlagen:', err?.message);
    }
  }, [label, ensurePushSubscribed]);

  const pauseTimer = useCallback(() => {
    setState((prev) => {
      if (!prev || prev.paused) return prev;
      const remaining = Math.max(0, Math.round((prev.endsAt - Date.now()) / 1000));
      return { ...prev, paused: true, remainingAtPauseSec: remaining };
    });
    api.cancelFocusTimer().catch(() => null);
  }, []);

  const resumeTimer = useCallback(async () => {
    let nextDuration = 0;
    let nextLabel = '';
    setState((prev) => {
      if (!prev || !prev.paused) return prev;
      const rem = prev.remainingAtPauseSec || 0;
      nextDuration = rem;
      nextLabel = prev.label || '';
      return { ...prev, paused: false, endsAt: Date.now() + rem * 1000, remainingAtPauseSec: undefined };
    });
    if (nextDuration > 0) {
      try {
        const result = await api.startFocusTimer({ durationSec: nextDuration, label: nextLabel || null });
        if (result?.timer) {
          const serverEndsAt = new Date(result.timer.ends_at).getTime();
          setState((prev) => ({
            ...(prev || {}),
            endsAt: Number.isFinite(serverEndsAt) ? serverEndsAt : prev?.endsAt,
            serverId: result.timer.id,
          }));
        }
      } catch { /* ignore */ }
    }
  }, []);

  const resetTimer = useCallback(() => {
    setState(null);
    firedRef.current = false;
    setShowFinishOverlay(false);
    api.cancelFocusTimer().catch(() => null);
  }, []);

  const isRunning = !!state && !state.paused && remainingSec > 0;
  const isPaused  = !!state && state.paused;
  const isIdle    = !state;

  const RADIUS = 46;
  const STROKE = 6;
  const C = 2 * Math.PI * RADIUS;

  return (
    <>
      <button
        type="button"
        className={`focus-timer-card${isRunning ? ' is-running' : ''}${isPaused ? ' is-paused' : ''}${showFinishOverlay ? ' is-finished' : ''}`}
        onClick={() => (isIdle ? setOpen(true) : null)}
        aria-label="Fokus-Timer"
      >
        <span className="focus-timer-card-glow" aria-hidden="true" />
        <span className="focus-timer-card-shimmer" aria-hidden="true" />
        <div className="focus-timer-ring-wrap" aria-hidden="true">
          <span className="focus-timer-halo" />
          <span className="focus-timer-shockwave focus-timer-shockwave-1" />
          <span className="focus-timer-shockwave focus-timer-shockwave-2" />
          <span className="focus-timer-shockwave focus-timer-shockwave-3" />
          <svg viewBox="0 0 100 100" className="focus-timer-ring">
            <circle cx="50" cy="50" r={RADIUS} stroke="rgba(255,255,255,0.12)" strokeWidth={STROKE} fill="none" />
            <circle
              className="focus-timer-ring-progress"
              cx="50" cy="50" r={RADIUS}
              stroke="url(#ftGrad)"
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - progress)}
              transform="rotate(-90 50 50)"
              style={{ transition: 'stroke-dashoffset 0.6s linear' }}
            />
            <defs>
              <linearGradient id="ftGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ff6b8a" />
                <stop offset="100%" stopColor="#ff9a5a" />
              </linearGradient>
            </defs>
          </svg>
          <div className="focus-timer-ring-label">
            {isIdle ? <Timer size={22} /> : <span className="focus-timer-time">{formatMMSS(remainingSec)}</span>}
          </div>
        </div>
        <div className="focus-timer-body">
          <strong>Fokus-Timer{state?.label ? ` · ${state.label}` : ''}</strong>
          {isIdle    && <span>Klick zum Starten · 5–45 min</span>}
          {isRunning && <span>Läuft — bleib dran 💪</span>}
          {isPaused  && <span>Pausiert</span>}
        </div>
        {!isIdle && (
          <div className="focus-timer-actions" onClick={(e) => e.stopPropagation()}>
            {isRunning && (
              <button type="button" className="focus-timer-mini-btn" onClick={pauseTimer} aria-label="Pause">
                <Pause size={14} />
              </button>
            )}
            {isPaused && (
              <button type="button" className="focus-timer-mini-btn" onClick={resumeTimer} aria-label="Weiter">
                <Play size={14} />
              </button>
            )}
            <button type="button" className="focus-timer-mini-btn" onClick={resetTimer} aria-label="Zuruecksetzen">
              <RotateCcw size={14} />
            </button>
          </div>
        )}
      </button>

      {/* Picker-Modal */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="modal-overlay focus-timer-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="focus-timer-modal"
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              dragDirectionLock
              onDragEnd={(_, info) => {
                if (info.offset.y > 120 || info.velocity.y > 600) setOpen(false);
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="focus-timer-drag-handle" aria-hidden="true" />
              <div className="focus-timer-modal-head">
                <div className="focus-timer-modal-title">
                  <Timer size={18} />
                  <h3>Fokus-Timer starten</h3>
                </div>
                <button type="button" className="focus-timer-close" onClick={() => setOpen(false)} aria-label="Schliessen">
                  <X size={18} />
                </button>
              </div>
              <p className="focus-timer-hint">
                Wähle eine Dauer. Du bekommst eine Push-Benachrichtigung, sobald die Zeit um ist —
                auch wenn die App geschlossen ist.
              </p>
              <div className="focus-timer-presets">
                {PRESETS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`focus-timer-preset${customMin === m ? ' active' : ''}`}
                    onClick={() => setCustomMin(m)}
                  >
                    {m}
                    <span>min</span>
                  </button>
                ))}
              </div>
              <div className="focus-timer-custom">
                <label htmlFor="ft-custom-input">Eigene Dauer (min)</label>
                <input
                  id="ft-custom-input"
                  type="number"
                  min={1}
                  max={180}
                  value={customMin}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setCustomMin(Math.min(180, Math.max(1, Math.round(v))));
                  }}
                />
              </div>
              <div className="focus-timer-custom focus-timer-label-row">
                <label htmlFor="ft-label-input">Label (optional)</label>
                <input
                  id="ft-label-input"
                  type="text"
                  maxLength={60}
                  placeholder="z.B. Lernen, Sport, Tiefenarbeit…"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="focus-timer-start"
                onClick={() => startTimer(customMin)}
                disabled={!customMin || customMin <= 0}
              >
                <Play size={16} /> {customMin} min starten
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Finish-Overlay (groß, animiert) */}
      <AnimatePresence>
        {showFinishOverlay && (
          <motion.div
            className="focus-finish-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={closeFinishOverlay}
          >
            <div className="focus-finish-bg-pulse" aria-hidden="true" />
            <motion.div
              className="focus-finish-card"
              initial={{ scale: 0.6, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="focus-finish-confetti" aria-hidden="true">
                {CONFETTI.map((c) => (
                  <motion.span
                    key={c.id}
                    className="focus-finish-confetti-piece"
                    style={{ background: c.color }}
                    initial={{ x: 0, y: 0, rotate: 0, opacity: 0 }}
                    animate={{
                      x: c.x,
                      y: c.y,
                      rotate: c.rot,
                      opacity: [0, 1, 1, 0],
                    }}
                    transition={{
                      duration: 1.6,
                      delay: c.delay,
                      ease: 'easeOut',
                      times: [0, 0.1, 0.7, 1],
                    }}
                  />
                ))}
              </div>

              <motion.div
                className="focus-finish-ring"
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.05, duration: 0.4 }}
              >
                <Bell size={48} />
              </motion.div>

              <h2 className="focus-finish-title">Zeit ist um!</h2>
              <p className="focus-finish-sub">
                {state?.durationSec
                  ? `Du hast ${Math.max(1, Math.round(state.durationSec / 60))} Minuten fokussiert gearbeitet.`
                  : 'Deine Fokus-Session ist vorbei.'}
              </p>
              {state?.label && (
                <p className="focus-finish-label">
                  <Sparkles size={14} /> {state.label}
                </p>
              )}

              <button type="button" className="focus-finish-cta" onClick={closeFinishOverlay}>
                Weiter machen
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
