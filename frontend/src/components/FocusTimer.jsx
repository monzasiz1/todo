import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Timer, Play, Pause, RotateCcw, X, Bell } from 'lucide-react';

/**
 * Fokus-Timer Widget
 * ──────────────────
 * Klickbare Karte auf dem Dashboard. Beim Klick oeffnet sich ein Modal mit
 * Voreinstellungen (5/10/15/25/45 min oder eigene Eingabe) + Start-Button.
 * Laeuft der Timer, zeigt die Karte den verbleibenden Wert + animierten
 * SVG-Ring an. Bei Ablauf:
 *   - Browser-Notification (falls erlaubt)
 *   - Vibration (Mobil, falls verfuegbar)
 *   - Audio-Ping
 *   - Visueller Toast/Badge auf der Karte
 *
 * Persistenz: end-timestamp + duration in localStorage, sodass der Timer
 * Tab-Wechsel und Reloads ueberlebt.
 */
const LS_KEY = 'beequ.focusTimer.v1';
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

function playPing() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.1);
    osc.stop(ctx.currentTime + 1.2);
    setTimeout(() => ctx.close(), 1500);
  } catch { /* ignore */ }
}

export default function FocusTimer() {
  const [open, setOpen] = useState(false);
  const [customMin, setCustomMin] = useState(25);
  const [now, setNow] = useState(() => Date.now());
  const [state, setState] = useState(() => loadState()); // { endsAt, durationSec, paused?, remainingAtPauseSec? }
  const [finishedFlash, setFinishedFlash] = useState(false);
  const firedRef = useRef(false);

  // Tick every second
  useEffect(() => {
    if (!state) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state]);

  // Persist
  useEffect(() => {
    saveState(state);
  }, [state]);

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
    setFinishedFlash(true);
    playPing();
    try {
      if ('vibrate' in navigator) navigator.vibrate([200, 100, 200, 100, 400]);
    } catch { /* ignore */ }
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Fokus-Timer abgelaufen', {
          body: `Deine ${state.durationSec / 60}-Minuten-Session ist vorbei.`,
          icon: '/icons/icon.png',
          tag: 'beequ-focus-timer',
        });
      }
    } catch { /* ignore */ }
    // Auto-clear after a short while so the card resets
    const id = window.setTimeout(() => {
      setFinishedFlash(false);
      setState(null);
      firedRef.current = false;
    }, 8000);
    return () => window.clearTimeout(id);
  }, [remainingSec, state]);

  const requestNotifPermission = useCallback(async () => {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch { /* ignore */ }
  }, []);

  const startTimer = useCallback((minutes) => {
    if (!minutes || minutes <= 0) return;
    const durationSec = Math.round(minutes * 60);
    firedRef.current = false;
    setFinishedFlash(false);
    setState({
      endsAt: Date.now() + durationSec * 1000,
      durationSec,
      paused: false,
    });
    setOpen(false);
    requestNotifPermission();
  }, [requestNotifPermission]);

  const pauseTimer = useCallback(() => {
    setState((prev) => {
      if (!prev || prev.paused) return prev;
      const remaining = Math.max(0, Math.round((prev.endsAt - Date.now()) / 1000));
      return { ...prev, paused: true, remainingAtPauseSec: remaining };
    });
  }, []);

  const resumeTimer = useCallback(() => {
    setState((prev) => {
      if (!prev || !prev.paused) return prev;
      const rem = prev.remainingAtPauseSec || 0;
      return { ...prev, paused: false, endsAt: Date.now() + rem * 1000, remainingAtPauseSec: undefined };
    });
  }, []);

  const resetTimer = useCallback(() => {
    setState(null);
    firedRef.current = false;
    setFinishedFlash(false);
  }, []);

  const isRunning = !!state && !state.paused && remainingSec > 0;
  const isPaused = !!state && state.paused;
  const isIdle = !state;

  // ── SVG ring geometry
  const RADIUS = 46;
  const STROKE = 6;
  const C = 2 * Math.PI * RADIUS;

  return (
    <>
      <button
        type="button"
        className={`focus-timer-card${finishedFlash ? ' is-finished' : ''}${isRunning ? ' is-running' : ''}`}
        onClick={() => (isIdle ? setOpen(true) : null)}
        aria-label="Fokus-Timer"
      >
        <div className="focus-timer-ring-wrap" aria-hidden="true">
          <svg viewBox="0 0 100 100" className="focus-timer-ring">
            <circle
              cx="50" cy="50" r={RADIUS}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={STROKE}
              fill="none"
            />
            <circle
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
            {isIdle ? (
              <Timer size={22} />
            ) : (
              <span className="focus-timer-time">{formatMMSS(remainingSec)}</span>
            )}
          </div>
        </div>
        <div className="focus-timer-body">
          <strong>Fokus-Timer</strong>
          {isIdle && <span>Klick zum Starten · 5–45 min</span>}
          {isRunning && <span>Läuft — bleib dran 💪</span>}
          {isPaused && <span>Pausiert</span>}
          {finishedFlash && <span className="focus-timer-done"><Bell size={12} /> Zeit ist um!</span>}
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
              initial={{ scale: 0.92, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
            >
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
                Wähle eine Dauer. Wir melden uns mit einer Benachrichtigung, sobald die Zeit um ist.
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
    </>
  );
}
