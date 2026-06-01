import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import {
  AlertCircle, ArrowRight, ArrowUp, BarChart2, Bell, CalendarDays,
  Check, CheckCircle2, Clock, FileText, Flag,
  Key, Layers3, LayoutDashboard, ListTodo, Mail, Paperclip, Repeat,
  Sparkles, Tag, UsersRound, User, X, Zap, Download,
  Leaf, Timer, MessageSquare, FolderKanban, MoveDiagonal, Smartphone,
} from 'lucide-react';
import { PLANS } from '../lib/plans';
import { useAuthStore } from '../store/authStore';
import BeeMascot from '../components/BeeMascot';
import '../styles/landing-v2.css';

/* ─────────────── data (preserved verbatim) ─────────────── */

const planAccents = { free: '#8E8E93', pro: '#007AFF', team: '#5856D6' };
const orderedPlans = ['free', 'pro', 'team'].map((id) => PLANS[id]);

// Identisch zu FEATURE_ROWS auf PricingPage – Landing muss 1:1 das anzeigen
// was Nutzer*innen auch nach dem Login in der App in den Pricing-Karten sehen.
const FEATURE_ROWS = [
  { key: 'tasks',           label: 'Aufgaben',                       type: 'limit' },
  { key: 'categories',      label: 'Kategorien',                     type: 'limit' },
  { key: 'aiCalls',         label: 'KI-Anfragen / Monat',            type: 'limit' },
  { key: 'groups',          label: 'Eigene Gruppen',                 type: 'limit' },
  { key: 'groupMembers',    label: 'Mitglieder pro Gruppe',          type: 'limit' },
  { key: 'teamChat',        label: 'Team-Chat & geteilte Aufgaben',  type: 'feature' },
  { key: 'groupAdmin',      label: 'Rollen, Rechte & Admin',         type: 'feature' },
  { key: 'recurringTasks',  label: 'Wiederkehrende Aufgaben',        type: 'feature' },
  { key: 'attachments',     label: 'Anhänge',                        type: 'feature' },
  { key: 'calendarSync',    label: 'Kalender-Sync',                  type: 'feature' },
  { key: 'statistics',      label: 'Statistiken',                    type: 'feature' },
  { key: 'prioritySupport', label: 'Prioritäts-Support',             type: 'feature' },
];

function formatLimitValue(value) {
  if (value === Infinity) return 'Unbegrenzt';
  if (value === 0 || value == null) return '—';
  return new Intl.NumberFormat('de-DE').format(value);
}

function getPlanRows(plan) {
  return FEATURE_ROWS.map((row) => {
    const isFeature = row.type === 'feature';
    const value = isFeature ? plan.features?.[row.key] : plan.limits?.[row.key];
    const included = isFeature ? value === true : (value ?? 0) > 0;
    return {
      ...row,
      included,
      value: isFeature ? null : value,
    };
  });
}

// Feature-Copy — unverändert übernommen aus dem alten bentoFeatures.
const featureCopy = [
  { icon: Sparkles,    color: '#007AFF', tint: 'rgba(0,122,255,0.16)',   title: 'KI-Texteingabe',         desc: 'Schreibe einen Satz wie „Sprint-Review Freitag 10 Uhr, hohe Prio" — BeeQu erkennt Titel, Datum, Uhrzeit, Kategorie und Priorität automatisch und legt die Aufgabe an.', plan: 'Alle Pläne' },
  { icon: CalendarDays,color: '#5856D6', tint: 'rgba(88,86,214,0.16)',   title: 'Ultra-Kalender',         desc: 'Wochen- und Monatsansicht mit Drag & Drop direkt im Raster, Mehrtages-Events und Gruppen-Kalender als zuschaltbare Ebenen.',                                              plan: 'Alle Pläne' },
  { icon: MessageSquare,color:'#34C759', tint: 'rgba(52,199,89,0.16)',   title: 'Team-Chat mit Events',  desc: 'Echtzeit-Gruppenchat: Termine aus Text-Nachrichten werden automatisch als Event-Karten erkannt, Aufgaben kannst du direkt in den Chat teilen.',                              plan: 'Team' },
  { icon: FolderKanban,color: '#FF9500', tint: 'rgba(255,149,0,0.16)',   title: 'Geteilte Gruppen-Aufgaben', desc: 'Gruppen für Familie, WG oder Team. Aufgaben teilen, gemeinsam abhaken, Fortschritt auf dem Gruppen-Board sehen.',                                                      plan: 'Alle Pläne' },
  { icon: Repeat,      color: '#FF375F', tint: 'rgba(255,55,95,0.16)',   title: 'Wiederkehrende Tasks',  desc: 'Täglich, wöchentlich, monatlich oder jährlich — einmal angelegt, BeeQu erstellt die nächste Instanz automatisch.',                                                     plan: 'Pro & Team' },
  { icon: Timer,       color: '#AF52DE', tint: 'rgba(175,82,222,0.16)',  title: 'Focus-Timer',           desc: 'Vordefinierte Sessions: 5, 10, 15, 25 oder 45 Minuten. Läuft im Hintergrund weiter und benachrichtigt dich am Ende.',                                                       plan: 'Alle Pläne' },
  { icon: FileText,    color: '#00C7BE', tint: 'rgba(0,199,190,0.16)',   title: 'Notizen-Board',         desc: 'Sticky-Notes frei auf dem Board platzieren, Farben wählen, Termine verknüpfen und mit Freunden teilen (Lesen oder Bearbeiten).',                                            plan: 'Alle Pläne' },
  { icon: BarChart2,   color: '#FF9500', tint: 'rgba(255,149,0,0.16)',   title: 'Statistiken & Insights',desc: 'Tagesfortschritt, smarte Hinweise und Wochenüberblick direkt auf dem Dashboard — ohne extra Auswertungs-Seite.',                                                            plan: 'Alle Pläne' },
  { icon: Paperclip,   color: '#FF3B30', tint: 'rgba(255,59,48,0.16)',   title: 'Dateianhänge',          desc: 'Dokumente, Bilder und PDFs direkt an Aufgaben heften — mit Vorschau und Download in der Task-Detailansicht.',                                                                plan: 'Pro & Team' },
  { icon: Bell,        color: '#5856D6', tint: 'rgba(88,86,214,0.16)',   title: 'Smarte Erinnerungen',   desc: 'Push-Benachrichtigungen genau dann, wenn es zählt — auf Web, Desktop-App (Electron) und installierter PWA.',                                                                plan: 'Alle Pläne' },
  { icon: MoveDiagonal,color: '#007AFF', tint: 'rgba(0,122,255,0.16)',   title: 'ICS-Import & -Export',  desc: 'Termine aus Google Calendar, Apple Kalender oder Outlook als .ics importieren und eigene Aufgaben/Termine wieder exportieren.',                                              plan: 'Pro & Team' },
  { icon: Smartphone,  color: '#34C759', tint: 'rgba(52,199,89,0.16)',   title: 'PWA — überall installierbar', desc: 'iOS, Android, macOS, Windows. Offline-fähig, Push-Benachrichtigungen, Home-Screen-Icon — kein App-Store nötig.',                                                       plan: 'Alle Pläne' },
];

// Echte App-Screenshots — kein Mock. Liegen unter frontend/public/bilder/.
const storyChapters = [
  {
    id: 'dashboard', src: '/bilder/dashboard.png', label: 'beequ.app/dashboard',
    icon: Sparkles, color: '#007AFF', tint: 'rgba(0,122,255,0.18)',
    eyebrow: 'Kapitel 01 · KI-Eingabe',
    title: 'Tippen statt klicken.',
    desc: 'Ein Satz reicht — Datum, Uhrzeit, Kategorie und Priorität werden automatisch erkannt und direkt aus dem Dashboard angelegt.',
    plan: 'Alle Pläne',
  },
  {
    id: 'aufgaben', src: '/bilder/aufgaben.png', label: 'beequ.app/aufgaben',
    icon: ListTodo, color: '#5856D6', tint: 'rgba(88,86,214,0.18)',
    eyebrow: 'Kapitel 02 · Heute · Morgen · Später',
    title: 'Alle Aufgaben. Nichts vergessen.',
    desc: 'Filter nach Priorität, gruppiert nach Datum, durchsuchbar. Wiederkehrende Aufgaben erstellen sich von selbst.',
    plan: 'Alle Pläne',
  },
  {
    id: 'kalender', src: '/bilder/kalender.png', label: 'beequ.app/kalender',
    icon: CalendarDays, color: '#34C759', tint: 'rgba(52,199,89,0.18)',
    eyebrow: 'Kapitel 03 · Monats- & Wochen-Ansicht',
    title: 'Termine im Griff.',
    desc: 'Eigene und geteilte Kalender im Wechsel. Mehrtages-Events und Drag & Drop direkt im Raster — flüssig wie nativ.',
    plan: 'Alle Pläne',
  },
  {
    id: 'gruppen', src: '/bilder/gruppen.png', label: 'beequ.app/gruppen',
    icon: UsersRound, color: '#FF9500', tint: 'rgba(255,149,0,0.18)',
    eyebrow: 'Kapitel 04 · Collaboration Space',
    title: 'Familie. Team. WG.',
    desc: 'Mitglieder verwalten, Rollen vergeben, Aufgaben gemeinsam abarbeiten — mit Team-Chat, der Termine selbst erkennt.',
    plan: 'Team',
  },
];

const aiExamples = [
  { input: '"Sprint Review Freitag 10 Uhr, hohe Prioritaet"', title: 'Sprint Review', date: 'Freitag', time: '10:00', cat: 'Produkt', prio: 'Hoch' },
  { input: '"Montag Rechnung abschicken um 9 Uhr"',            title: 'Rechnung',      date: 'Montag',  time: '09:00', cat: 'Finanzen', prio: 'Mittel' },
  { input: '"Mittwoch Workout 18:30 erinnern"',               title: 'Workout',       date: 'Mittwoch',time: '18:30', cat: 'Gesundheit', prio: 'Niedrig' },
];

const ease = [0.25, 0.46, 0.45, 0.94];
const fadeUp = {
  hidden:  { opacity: 0, y: 28 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.07, duration: 0.5, ease } }),
};

/* ─────────────── shared honeycomb signature ─────────────── */
function Honeycomb({ className = '', a = 'rgba(0,122,255,0.16)', b = 'rgba(88,86,214,0.14)' }) {
  return (
    <svg className={className} width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" aria-hidden focusable="false">
      <defs>
        <pattern id={`lp-hex-${a.length}${b.length}`} x="0" y="0" width="56" height="96" patternUnits="userSpaceOnUse">
          <path d="M28 4 L52 18 L52 46 L28 60 L4 46 L4 18 Z" fill="none" stroke={a} strokeWidth="1" />
          <path d="M56 52 L80 66 L80 94 L56 108 L32 94 L32 66 Z" fill="none" stroke={b} strokeWidth="1" />
          <path d="M0 52 L24 66 L24 94 L0 108 L-24 94 L-24 66 Z" fill="none" stroke={b} strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#lp-hex-${a.length}${b.length})`} />
    </svg>
  );
}

/* ─────────────── pinned scroll-story (signature) ─────────────── */
function ScrollStory({ onCta }) {
  const ref = useRef(null);
  const [active, setActive] = useState(0);
  const chapterRefs = useRef([]);

  // IntersectionObserver picks the most-centered chapter -> sticky frame morphs.
  useEffect(() => {
    const els = chapterRefs.current.filter(Boolean);
    if (!els.length) return undefined;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = Number(entry.target.getAttribute('data-idx'));
            setActive(idx);
          }
        });
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const current = storyChapters[active];

  return (
    <section className="lp-story" id="features" ref={ref}>
      <div className="lp-container">
        <div className="lp-section-head">
          <span className="lp-kicker">Produkt-Tour</span>
          <h2>Eine App.<br /><span className="lp-h2-muted">Vier Räume zum Arbeiten.</span></h2>
          <p>Scrolle dich durch BeeQu — der Bildschirm wechselt mit dir mit. Echte Screenshots, keine Attrappe.</p>
        </div>

        <div className="lp-story-grid">
          {/* Sticky morphing frame */}
          <div className="lp-story-sticky">
            <div className="lp-story-frame" style={{ '--lp-active': current.color }}>
              <div className="lp-story-frame-chrome">
                <span className="lp-dot" style={{ background: '#FF5F57' }} />
                <span className="lp-dot" style={{ background: '#FEBC2E' }} />
                <span className="lp-dot" style={{ background: '#28C840' }} />
                <span className="lp-story-frame-tag">{current.label}</span>
              </div>
              <div className="lp-story-frame-screen">
                <AnimatePresence mode="wait">
                  <motion.img
                    key={current.id}
                    src={current.src}
                    alt={`BeeQu — ${current.title}`}
                    initial={{ opacity: 0, scale: 1.04 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.99 }}
                    transition={{ duration: 0.5, ease }}
                    draggable={false}
                    loading="lazy"
                  />
                </AnimatePresence>
              </div>
              <div className="lp-story-progress">
                {storyChapters.map((c, i) => (
                  <span key={c.id} className={i === active ? 'on' : ''} />
                ))}
              </div>
            </div>
          </div>

          {/* Chapter narrative */}
          <div className="lp-story-chapters">
            {storyChapters.map((c, i) => {
              const Icon = c.icon;
              return (
                <div
                  key={c.id}
                  data-idx={i}
                  ref={(el) => { chapterRefs.current[i] = el; }}
                  className={`lp-chapter${i === active ? ' is-active' : ''}`}
                  style={{ '--lp-active': c.color }}
                >
                  <span className="lp-chapter-num">{c.eyebrow}</span>
                  <div className="lp-chapter-head">
                    <span className="lp-chapter-ico" style={{ background: c.tint, color: c.color, borderColor: c.color }}>
                      <Icon size={20} />
                    </span>
                    <h3>{c.title}</h3>
                  </div>
                  <p>{c.desc}</p>
                  <span className="lp-chapter-plan">{c.plan}</span>
                </div>
              );
            })}
            <div style={{ marginTop: 6 }}>
              <button type="button" className="lp-btn lp-primary lp-btn-lg" onClick={onCta}>
                Jetzt ausprobieren <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────── component ─────────────── */

export default function LandingPage() {
  const [showLogin,    setShowLogin]    = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [loginEmail,      setLoginEmail]      = useState('');
  const [loginPassword,   setLoginPassword]   = useState('');
  const [registerEmail,   setRegisterEmail]   = useState('');
  const [registerPassword,setRegisterPassword]= useState('');
  const [registerName,    setRegisterName]    = useState('');
  const [loginError,    setLoginError]    = useState('');
  const [registerError, setRegisterError] = useState('');
  const [pendingEmail,  setPendingEmail]  = useState('');
  // Code-Verifikation
  const [verifyDigits,  setVerifyDigits]  = useState(['','','','','','']);
  const [verifyStep,    setVerifyStep]    = useState('input'); // 'input' | 'checking' | 'done'
  const [verifyError,   setVerifyError]   = useState('');
  const verifyRefs = [useRef(null),useRef(null),useRef(null),useRef(null),useRef(null),useRef(null)];
  const [aiIdx, setAiIdx] = useState(0);
  const [pricingInterval, setPricingInterval] = useState('month'); // 'month' | 'year'
  const [mobileCtaVisible, setMobileCtaVisible] = useState(false);
  const { login, register, verifyCode, loading } = useAuthStore();
  const navigate = useNavigate();

  // hero parallax: tilt frame slightly with scroll
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const frameY = useTransform(scrollYProgress, [0, 1], [0, -60]);
  const frameRot = useTransform(scrollYProgress, [0, 1], [0, 6]);

  const openRegister = () => { setShowLogin(false); setShowRegister(true); };
  const openLogin = () => { setShowRegister(false); setShowLogin(true); };

  const handleLogin = async (e) => {
    e.preventDefault(); setLoginError('');
    try {
      const ok = await login(loginEmail, loginPassword);
      if (ok === true) { navigate('/app'); return; }
      if (ok && ok.requires2FA) { /* 2FA-Flow wird separat behandelt */ return; }
      // login() im Store schluckt Fehler und gibt false zurück → Meldung aus dem Store holen
      const storeError = useAuthStore.getState().error;
      setLoginError(storeError || 'E-Mail oder Passwort ist falsch.');
    } catch (err) {
      setLoginError(err.message || 'Login fehlgeschlagen');
    }
  };
  const handleRegister = async (e) => {
    e.preventDefault(); setRegisterError('');
    try {
      const result = await register(registerName, registerEmail, registerPassword);
      if (result?.success) {
        navigate('/app');
      } else if (result?.message) {
        setVerifyDigits(['','','','','','']);
        setVerifyStep('input');
        setVerifyError('');
        setPendingEmail(registerEmail);
        setTimeout(() => verifyRefs[0]?.current?.focus(), 80);
      } else if (result?.error) {
        setRegisterError(result.error);
      }
    } catch (err) {
      setRegisterError(err.message || 'Registrierung fehlgeschlagen');
    }
  };

  const handleVerifyDigit = (idx, val) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next  = [...verifyDigits];
    next[idx]   = digit;
    setVerifyDigits(next);
    setVerifyError('');
    if (digit && idx < 5) setTimeout(() => verifyRefs[idx + 1]?.current?.focus(), 10);
  };

  const handleVerifyKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !verifyDigits[idx] && idx > 0)
      setTimeout(() => verifyRefs[idx - 1]?.current?.focus(), 10);
  };

  const handleVerifyPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g,'').slice(0, 6);
    if (!pasted) return;
    const next = ['','','','','',''];
    [...pasted].forEach((ch, i) => { next[i] = ch; });
    setVerifyDigits(next);
    const focusIdx = Math.min(pasted.length, 5);
    setTimeout(() => verifyRefs[focusIdx]?.current?.focus(), 10);
  };

  const handleVerifySubmit = async () => {
    const code = verifyDigits.join('');
    if (code.length < 6) { setVerifyError('Bitte alle 6 Stellen eingeben.'); return; }
    setVerifyStep('checking');
    setVerifyError('');
    const result = await verifyCode(pendingEmail, code);
    if (result?.success) {
      setVerifyStep('done');
      setTimeout(() => navigate('/app'), 1400);
    } else {
      setVerifyStep('input');
      setVerifyError(result?.error || 'Ungültiger Code. Bitte nochmal prüfen.');
      setVerifyDigits(['','','','','','']);
      setTimeout(() => verifyRefs[0]?.current?.focus(), 80);
    }
  };

  const ai = aiExamples[aiIdx];

  // Landing ist eine eigenständige, durchgehend DUNKLE Marketing-Surface.
  // Sie folgt NICHT der App-Theme-Wahl. Wir erzwingen hier nur das dunkle
  // color-scheme für native Controls/Scrollbars (kein forced data-theme).
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.colorScheme;
    root.style.colorScheme = 'dark';
    return () => { root.style.colorScheme = prev; };
  }, []);

  // Mobile sticky CTA erscheint nach dem Hero.
  useEffect(() => {
    const onScroll = () => setMobileCtaVisible(window.scrollY > window.innerHeight * 0.7);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const closeAuth = () => { setShowLogin(false); setShowRegister(false); };

  return (
    <div className="lp">
      {/* ══════════ ATMOSPHERE ══════════ */}
      <div className="lp-atmos" aria-hidden>
        <div className="lp-bloom lp-bloom-1" />
        <div className="lp-bloom lp-bloom-2" />
        <div className="lp-bloom lp-bloom-3" />
      </div>
      <div className="lp-grain" aria-hidden />

      {/* ══════════ NAV ══════════ */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <Link to="/landing" className="lp-brand">
            <img src="/icons/icon.png" alt="" className="lp-brand-icon" />
            <span>BeeQu</span>
          </Link>
          <div className="lp-nav-links">
            <a href="#features">Produkt</a>
            <a href="#ai">KI-Eingabe</a>
            <a href="#pricing">Preise</a>
            <a href="#downloads">Downloads</a>
          </div>
          <div className="lp-nav-actions">
            <button onClick={openLogin} className="lp-btn lp-ghost">Anmelden</button>
            <button onClick={openRegister} className="lp-btn lp-primary">Kostenlos starten</button>
          </div>
        </div>
      </nav>

      {/* ══════════ HERO ══════════ */}
      <header className="lp-hero" ref={heroRef}>
        <div className="lp-hero-inner">
          {/* Left — kinetic copy + live parser */}
          <motion.div
            initial="hidden" animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
          >
            <motion.span className="lp-eyebrow" variants={fadeUp}>
              <span className="lp-live-dot" /> BeeQu · jetzt verfügbar
            </motion.span>

            <motion.h1 className="lp-hero-h1" variants={fadeUp}>
              <span className="lp-stroke">Sag, was ansteht.</span>
              <span className="lp-stroke lp-hero-accent">BeeQu erledigt den Rest.</span>
            </motion.h1>

            <motion.p className="lp-hero-sub" variants={fadeUp}>
              Aufgaben, Kalender, Notizen und Team-Arbeit in einer App —
              mit einer KI, die deine Sprache versteht und Aufgaben automatisch anlegt.
            </motion.p>

            {/* Live AI parser terminal */}
            <motion.div className="lp-parser" variants={fadeUp}>
              <div className="lp-parser-bar"><Sparkles size={13} /> KI-Texteingabe · live</div>
              <div className="lp-parser-line">
                <span className="lp-parser-prompt">›</span>
                <span>Sprint-Review Freitag 10 Uhr, hohe Prio</span>
                <span className="lp-parser-caret" aria-hidden />
              </div>
              <div className="lp-parser-tags">
                <span className="lp-tag lp-tag-title"><Tag /> Sprint-Review</span>
                <span className="lp-tag lp-tag-date"><CalendarDays /> Freitag</span>
                <span className="lp-tag lp-tag-time"><Clock /> 10:00</span>
                <span className="lp-tag lp-tag-cat">Produkt</span>
                <span className="lp-tag lp-tag-prio"><Flag /> Hoch</span>
              </div>
            </motion.div>

            <motion.div className="lp-hero-actions" variants={fadeUp}>
              <button onClick={openRegister} className="lp-btn lp-primary lp-btn-lg">
                Kostenlos starten <ArrowRight size={17} />
              </button>
              <a href="/api/download?platform=windows" className="lp-btn lp-ghost lp-btn-lg">
                <Download size={17} /> Desktop-App
              </a>
            </motion.div>

            <motion.div className="lp-hero-trust" variants={fadeUp}>
              <span><Check size={13} strokeWidth={3} /> Keine Kreditkarte</span>
              <span><Check size={13} strokeWidth={3} /> Free-Plan inklusive</span>
              <a href="/api/download?platform=windows"><Download size={13} strokeWidth={3} /> .exe für Windows</a>
            </motion.div>
          </motion.div>

          {/* Right — tilted parallax product frame */}
          <div className="lp-hero-stage">
            <Honeycomb className="lp-hero-hex" />
            <BeeMascot variant="gold" size={92} pose="happy" className="lp-hero-bee" />
            <motion.div
              className="lp-frame"
              style={{ y: frameY, rotateZ: frameRot }}
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3, ease }}
            >
              <div className="lp-frame-chrome">
                <span className="lp-dot" style={{ background: '#FF5F57' }} />
                <span className="lp-dot" style={{ background: '#FEBC2E' }} />
                <span className="lp-dot" style={{ background: '#28C840' }} />
                <span className="lp-frame-url"><b>●</b> beequ.app/dashboard</span>
              </div>
              <div className="lp-frame-screen">
                <img src="/bilder/dashboard.png" alt="BeeQu Dashboard" draggable={false} loading="eager" />
              </div>
            </motion.div>

            <motion.div
              className="lp-orbit lp-orbit-a"
              initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.7, ease }}
            >
              <span className="lp-orbit-icon" style={{ background: 'rgba(52,199,89,0.16)', color: '#34C759' }}><CheckCircle2 size={18} /></span>
              <span><strong>Aufgabe erstellt</strong><small>aus 1 Satz · 0,4 s</small></span>
            </motion.div>
            <motion.div
              className="lp-orbit lp-orbit-b"
              initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.9, ease }}
            >
              <span className="lp-orbit-icon" style={{ background: 'rgba(0,122,255,0.16)', color: '#4DA3FF' }}><Bell size={18} /></span>
              <span><strong>Erinnerung gesetzt</strong><small>Fr · 09:45</small></span>
            </motion.div>
          </div>
        </div>
      </header>

      {/* ══════════ MARQUEE STRIP ══════════ */}
      <div className="lp-marquee" aria-hidden>
        <div className="lp-marquee-track">
          {[...Array(2)].map((_, dup) => (
            [
              { icon: Sparkles,     text: 'KI versteht natürliche Sprache' },
              { icon: CalendarDays, text: 'Drag & Drop im Kalender' },
              { icon: MessageSquare,text: 'Team-Chat mit Events' },
              { icon: FolderKanban, text: 'Geteilte Gruppen-Aufgaben' },
              { icon: Timer,        text: 'Focus-Timer mit Push-Alert' },
              { icon: Bell,         text: 'Push-Erinnerungen' },
              { icon: Leaf,         text: '1 % für Stripe Climate' },
            ].map(({ icon: Icon, text }) => (
              <span className="lp-marquee-item" key={`${dup}-${text}`}>
                <Icon size={16} /> {text}
              </span>
            ))
          ))}
        </div>
      </div>

      {/* ══════════ SIGNATURE: PINNED SCROLL-STORY ══════════ */}
      <ScrollStory onCta={openRegister} />

      {/* ══════════ FEATURE MOSAIC (rest) ══════════ */}
      <section className="lp-section" id="more-features">
        <div className="lp-container">
          <div className="lp-section-head">
            <span className="lp-kicker">Funktionen</span>
            <h2>Alles, was du brauchst.<br /><span className="lp-h2-muted">Nichts, was du nicht brauchst.</span></h2>
            <p>Keine drei Tools mehr — BeeQu vereint Aufgaben, Kalender und Team-Arbeit. Mit KI als Herzstück.</p>
          </div>

          <div className="lp-mosaic">
            {featureCopy.map((f, i) => {
              const Icon = f.icon;
              const wide = i === 0; // KI-Texteingabe als breite Hero-Kachel
              return (
                <motion.article
                  key={f.title}
                  className={`lp-tile${wide ? ' lp-tile-wide' : ''}`}
                  style={{ '--lp-tile-tint': f.tint }}
                  initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-50px' }}
                  variants={fadeUp} custom={i % 3}
                >
                  <span className="lp-tile-ico" style={{ background: f.tint, color: f.color, borderColor: f.color }}>
                    <Icon size={22} />
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.desc}</p>
                  <div className="lp-tile-plan">{f.plan}</div>
                </motion.article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ══════════ AI SPOTLIGHT ══════════ */}
      <section className="lp-ai" id="ai">
        <div className="lp-container">
          <div className="lp-ai-card">
            <Honeycomb className="lp-ai-hex" a="rgba(0,122,255,0.14)" b="rgba(88,86,214,0.12)" />
            <div className="lp-ai-grid">
              {/* copy */}
              <motion.div
                className="lp-ai-copy"
                initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-60px' }}
                variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
              >
                <motion.span className="lp-kicker" variants={fadeUp}>KI-Assistent</motion.span>
                <motion.h2 variants={fadeUp}>Aufgaben anlegen,<br /><span className="lp-hero-accent">so natürlich wie tippen.</span></motion.h2>
                <motion.p variants={fadeUp}>
                  Vergiss Formulare. Schreib einfach, was du vorhast — BeeQus KI erkennt Datum, Uhrzeit, Kategorie und Priorität und legt die fertige Aufgabe an.
                </motion.p>
                <motion.div className="lp-ai-points" variants={fadeUp}>
                  {[
                    { icon: CalendarDays, text: '„morgen", „nächsten Montag", „um 14 Uhr" — alles wird korrekt erkannt.' },
                    { icon: Layers3,      text: 'Kategorien & Prioritäten werden automatisch aus dem Kontext abgeleitet.' },
                    { icon: Zap,          text: 'Ein Satz — eine fertige Aufgabe. Kein Klick durch Formulare.' },
                  ].map(({ icon: Icon, text }) => (
                    <div key={text} className="lp-ai-point">
                      <span className="lp-ai-point-ico"><Icon size={16} /></span>
                      <span>{text}</span>
                    </div>
                  ))}
                </motion.div>
                <motion.div className="lp-ai-cta" variants={fadeUp}>
                  <button onClick={openRegister} className="lp-btn lp-primary lp-btn-lg">
                    KI kostenlos testen <ArrowRight size={17} />
                  </button>
                </motion.div>
              </motion.div>

              {/* interactive demo */}
              <motion.div
                className="lp-ai-demo"
                initial={{ opacity: 0, x: 28 }} whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.55, ease }}
              >
                <div className="lp-ai-ex-row" role="tablist" aria-label="Beispiel wählen">
                  {aiExamples.map((ex, i) => (
                    <button
                      key={ex.input}
                      type="button" role="tab" aria-selected={i === aiIdx}
                      className={`lp-ai-ex${i === aiIdx ? ' active' : ''}`}
                      onClick={() => setAiIdx(i)}
                    >
                      {ex.input}
                    </button>
                  ))}
                </div>
                <div className="lp-ai-input">
                  <span className="lp-ai-input-ico"><Sparkles size={18} /></span>
                  <span className="lp-ai-input-text">{ai.input}</span>
                  <span className="lp-ai-input-send"><ArrowUp size={16} /></span>
                </div>
                <motion.div
                  key={aiIdx}
                  className="lp-ai-result"
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
                >
                  <span className="lp-tag lp-tag-title"><ListTodo /> Aufgabe</span>
                  <span className="lp-tag lp-tag-title"><Tag /> {ai.title}</span>
                  <span className="lp-tag lp-tag-date"><CalendarDays /> {ai.date}</span>
                  {ai.time && <span className="lp-tag lp-tag-time"><Clock /> {ai.time}</span>}
                  <span className="lp-tag lp-tag-cat">{ai.cat}</span>
                  {ai.prio !== 'Mittel' && <span className="lp-tag lp-tag-prio"><Flag /> {ai.prio}</span>}
                </motion.div>
                <div className="lp-ai-lang">🌍 Deutsch &amp; Englisch unterstützt</div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ PRICING ══════════ */}
      <section className="lp-pricing" id="pricing">
        <div className="lp-container">
          <div className="lp-section-head center">
            <span className="lp-kicker" style={{ justifyContent: 'center' }}>Preise</span>
            <h2>Wähle deinen Plan.<br /><span className="lp-h2-muted">Jederzeit kündbar.</span></h2>
            <p>Starte kostenlos. Upgrade nur, wenn du wirklich mehr brauchst — keine versteckten Kosten.</p>
          </div>

          <div className="lp-toggle-wrap">
            <div className="lp-toggle" role="tablist" aria-label="Abrechnungsintervall">
              <button
                type="button" role="tab" aria-selected={pricingInterval === 'month'}
                className={`lp-toggle-btn${pricingInterval === 'month' ? ' is-active' : ''}`}
                onClick={() => setPricingInterval('month')}
              >Monatlich</button>
              <button
                type="button" role="tab" aria-selected={pricingInterval === 'year'}
                className={`lp-toggle-btn${pricingInterval === 'year' ? ' is-active' : ''}`}
                onClick={() => setPricingInterval('year')}
              >Jährlich <span className="lp-toggle-save">−17 %</span></button>
            </div>
          </div>

          <div className="lp-plans">
            {orderedPlans.map((plan, i) => {
              const isPaid = plan.id !== 'free';
              const priceLabel = !isPaid
                ? plan.priceLabel
                : pricingInterval === 'year' ? plan.priceLabelYear : plan.priceLabel;
              const subPrice = !isPaid
                ? null
                : pricingInterval === 'year'
                  ? `entspricht ${plan.yearlyMonthly.toFixed(2).replace('.', ',')} €/Monat`
                  : `oder ${plan.priceLabelYear} · 2 Monate gratis`;
              return (
                <motion.div
                  key={plan.id}
                  className={`lp-plan${plan.id === 'pro' ? ' featured' : ''}`}
                  initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-40px' }}
                  custom={i} variants={fadeUp}
                >
                  {plan.id === 'pro' && <div className="lp-plan-badge">⭐ Beliebteste Wahl</div>}
                  <span className="lp-plan-name" style={{ color: planAccents[plan.id] }}>{plan.label}</span>
                  <div className="lp-plan-price">{priceLabel}</div>
                  <div className="lp-plan-sub">{subPrice || plan.tagline}</div>
                  <div className="lp-plan-line" />
                  <ul className="lp-plan-list">
                    {getPlanRows(plan).map((row) => (
                      <li key={row.key} className={`lp-plan-row${row.included ? ' on' : ' off'}`}>
                        {row.included
                          ? <CheckCircle2 size={15} className="lp-plan-row-ico on" />
                          : <span className="lp-plan-row-ico off" aria-hidden>—</span>}
                        <span className="lp-plan-row-label">{row.label}</span>
                        {row.type === 'limit' && (
                          <span className="lp-plan-row-val">{row.included ? formatLimitValue(row.value) : '—'}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={openRegister}
                    className={`lp-btn lp-btn-lg lp-btn-full lp-plan-cta ${plan.id === 'pro' ? 'lp-primary' : 'lp-outline'}`}
                  >
                    {plan.id === 'free' ? 'Kostenlos starten' : 'Freischalten'}
                  </button>
                </motion.div>
              );
            })}
          </div>

          <div className="lp-price-trust">
            <span><Check size={14} /> Jederzeit kündbar</span>
            <span><Check size={14} /> Sichere Zahlung via Stripe</span>
            <span><Check size={14} /> Keine versteckten Kosten</span>
            <span><Check size={14} /> Kein Lock-in — Daten-Export jederzeit</span>
          </div>
        </div>
      </section>

      {/* ══════════ CLIMATE ══════════ */}
      <section className="lp-climate" id="climate">
        <div className="lp-container">
          <motion.div
            className="lp-climate-card"
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-60px' }}
            variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
          >
            <motion.div className="lp-climate-mega-wrap" variants={fadeUp}>
              <div className="lp-climate-mega">1%</div>
              <div className="lp-climate-mega-sub">jedes Pro- &amp; Team-Abos</div>
              <BeeMascot variant="blue" size={64} pose="wink" style={{ marginTop: 18 }} />
            </motion.div>

            <div>
              <motion.span className="lp-climate-eyebrow" variants={fadeUp}>
                <Leaf size={14} /> Stripe Climate · Mitglied
              </motion.span>
              <motion.h2 variants={fadeUp}>1 % jedes Abos für unseren Planeten.</motion.h2>
              <motion.p className="lp-climate-lead" variants={fadeUp}>
                Wir spenden automatisch <strong>1 % jedes Pro- und Team-Abos</strong> an{' '}
                <a href="https://stripe.com/climate" target="_blank" rel="noopener noreferrer" className="lp-climate-link">Stripe&nbsp;Climate</a>{' '}
                — eine Initiative, die <strong>nachweisbar CO₂ aus der Atmosphäre entfernt</strong>.
                Kein Greenwashing, sondern direkte Förderung der nächsten Generation von Climate-Tech.
              </motion.p>
              <motion.div className="lp-climate-stats" variants={fadeUp}>
                {[
                  { ico: '🌍', num: '1 %',         label: 'jedes bezahlten Abos' },
                  { ico: '🌬️', num: 'CO₂',         label: 'nachweisbar entfernt' },
                  { ico: '⚡', num: 'Automatisch', label: 'ohne Aufpreis für dich' },
                  { ico: '🔬', num: 'Verifiziert', label: 'durch unabhängige Partner' },
                ].map((s) => (
                  <div className="lp-climate-stat" key={s.label}>
                    <div className="lp-climate-stat-icon">{s.ico}</div>
                    <div className="lp-climate-stat-num">{s.num}</div>
                    <div className="lp-climate-stat-label">{s.label}</div>
                  </div>
                ))}
              </motion.div>
              <motion.div className="lp-climate-tech" variants={fadeUp}>
                <span>Direct&nbsp;Air&nbsp;Capture</span><span>·</span>
                <span>Pflanzenkohle</span><span>·</span>
                <span>Mineralische Bindung</span><span>·</span>
                <span>Ozean-Verfahren</span>
              </motion.div>
              <motion.p className="lp-climate-foot" variants={fadeUp}>
                Du bezahlst den normalen Preis — der Klimabeitrag kommt aus unserer Marge.
                Mehr auf{' '}
                <a href="https://stripe.com/climate" target="_blank" rel="noopener noreferrer" className="lp-climate-link">stripe.com/climate</a>.
              </motion.p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ══════════ DOWNLOADS ══════════ */}
      <section className="lp-dl" id="downloads">
        <div className="lp-container">
          <div className="lp-section-head center">
            <span className="lp-kicker" style={{ justifyContent: 'center' }}><Download size={13} /> Desktop</span>
            <h2>Überall produktiv.<br /><span className="lp-h2-muted">Auch nativ am Desktop.</span></h2>
            <p>BeeQu als native Desktop-App für Windows und macOS. Schneller Start, offline verfügbar, automatische Updates.</p>
          </div>

          <div className="lp-dl-grid">
            <motion.div
              className="lp-dl-card"
              initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp}
            >
              <div className="lp-dl-ico lp-dl-ico-win">
                <svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor">
                  <path d="M0,0 L10,0 L10,10 L0,10 Z M11,0 L24,0 L24,13 L11,13 Z M0,11 L10,11 L10,24 L0,24 Z M11,14 L24,14 L24,24 L11,24 Z"/>
                </svg>
              </div>
              <h3>Windows</h3>
              <p className="lp-dl-card-sub">Windows 10/11 (64-bit)</p>
              <a href="/api/download?platform=windows" className="lp-btn lp-primary lp-btn-full">
                <Download size={16} /> Installer (.exe)
              </a>
              <a href="/api/download?platform=windows-portable" target="_blank" rel="noopener noreferrer" className="lp-dl-link">
                Portable Version →
              </a>
            </motion.div>

            <motion.div
              className="lp-dl-card soon"
              initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={1}
            >
              <div className="lp-dl-ico lp-dl-ico-mac">
                <svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor">
                  <path d="M16.37 12.78c-.02-2.13 1.74-3.15 1.82-3.2-1-1.46-2.55-1.66-3.1-1.68-1.32-.13-2.57.77-3.24.77-.67 0-1.7-.75-2.79-.73-1.44.02-2.76.83-3.5 2.11-1.49 2.58-.38 6.41 1.07 8.51.71 1.03 1.56 2.18 2.67 2.14 1.07-.04 1.48-.69 2.77-.69 1.29 0 1.66.69 2.79.67 1.15-.02 1.88-1.05 2.59-2.08.81-1.19 1.15-2.34 1.17-2.4-.03-.01-2.24-.86-2.26-3.39zM14.2 6.27c.59-.72.99-1.71.88-2.71-.85.03-1.89.57-2.5 1.28-.55.63-1.03 1.65-.9 2.62.95.07 1.93-.48 2.52-1.19z"/>
                </svg>
              </div>
              <h3>macOS</h3>
              <p className="lp-dl-card-sub">Intel + Apple Silicon</p>
              <button disabled className="lp-btn lp-btn-full lp-dl-disabled">In Kürze verfügbar</button>
              <a href="https://github.com/monzasiz1/todo/releases" target="_blank" rel="noopener noreferrer" className="lp-dl-link muted">
                Build-Status anzeigen →
              </a>
            </motion.div>
          </div>

          <div className="lp-dl-note">
            <span><Check size={15} /> Keine Anmeldung für Download erforderlich</span>
            <span><Check size={15} /> Open Source auf <a href="https://github.com/monzasiz1/todo" target="_blank" rel="noopener noreferrer">GitHub</a></span>
          </div>
        </div>
      </section>

      {/* ══════════ FINAL CTA ══════════ */}
      <section className="lp-final">
        <div className="lp-container">
          <div className="lp-final-card">
            <Honeycomb className="lp-final-hex" a="rgba(0,122,255,0.16)" b="rgba(88,86,214,0.14)" />
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-60px' }}
              variants={{ visible: { transition: { staggerChildren: 0.09 } } }}
            >
              <motion.span className="lp-final-eyebrow" variants={fadeUp}>Jetzt starten</motion.span>
              <motion.h2 variants={fadeUp}>Bereit, produktiver zu werden?</motion.h2>
              <motion.p variants={fadeUp}>
                Starte kostenlos — keine Kreditkarte, kein Risiko. Upgrade erst, wenn du die Features wirklich brauchst.
              </motion.p>
              <motion.div className="lp-final-actions" variants={fadeUp}>
                <button onClick={openRegister} className="lp-btn lp-primary lp-btn-lg">
                  Konto erstellen <ArrowRight size={17} />
                </button>
                <button onClick={openLogin} className="lp-btn lp-ghost lp-btn-lg">Anmelden</button>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ══════════ FOOTER ══════════ */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <img src="/icons/icon.png" alt="" className="lp-footer-icon" />
            <strong>BeeQu</strong>
          </div>
          <nav className="lp-footer-nav">
            <a href="#features">Produkt</a>
            <a href="#ai">KI-Eingabe</a>
            <a href="#pricing">Preise</a>
            <Link to="/datenschutz">Datenschutz</Link>
            <Link to="/agb">AGB</Link>
          </nav>
          <p className="lp-footer-copy">© 2026 BeeQu. Alle Rechte vorbehalten.</p>
        </div>
      </footer>

      {/* ══════════ MOBILE STICKY CTA ══════════ */}
      <div className={`lp-mobile-cta${mobileCtaVisible ? ' show' : ''}`} role="region" aria-label="Schnellstart" aria-hidden={!mobileCtaVisible}>
        <div>
          <span className="lp-mobile-cta-title">BeeQu — alles drin.</span>
          <span className="lp-mobile-cta-sub">Kostenlos starten · keine Karte nötig</span>
        </div>
        <button type="button" className="lp-btn lp-primary" onClick={openRegister}>Loslegen</button>
      </div>

      {/* ══════════ AUTH OVERLAY ══════════ */}
      <AnimatePresence>
        {(showLogin || showRegister) && (
          <motion.div
            className="lp-auth-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            {/* branded side */}
            <motion.div
              className="lp-auth-brand"
              initial={{ opacity: 0, x: -32 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -32 }}
              transition={{ duration: 0.38, ease }}
            >
              <Honeycomb className="lp-auth-brand-hex" />
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div className="lp-auth-logo">
                  <img src="/icons/icon.png" alt="BeeQu" />
                  <span>BeeQu</span>
                </div>
                <span className="lp-auth-kicker">{showRegister ? 'BeeQu Workspace' : 'Persönlicher Workspace'}</span>
                <h2 className="lp-auth-brand-headline">
                  {showRegister ? 'Klarer Start.\nRuhiger Fokus.' : 'Zurück in deinen\nWorkspace.'}
                </h2>
                <p className="lp-auth-brand-sub">
                  {showRegister
                    ? 'Aufgaben, Kalender und Zusammenarbeit in einer übersichtlichen Oberfläche.'
                    : 'Deine Aufgaben, Termine und Gruppen warten auf dich.'}
                </p>
              </div>
              <div className="lp-auth-brand-footer">
                <span>© 2026 BeeQu</span><span>·</span>
                <Link to="/datenschutz">Datenschutz</Link><span>·</span>
                <Link to="/agb">AGB</Link>
              </div>
            </motion.div>

            {/* form side */}
            <motion.div
              className="lp-auth-panel"
              initial={{ opacity: 0, x: 32 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 32 }}
              transition={{ duration: 0.38, ease }}
            >
              <button className="lp-auth-close" onClick={closeAuth} aria-label="Schließen"><X size={18} /></button>

              <AnimatePresence mode="wait">
                {showLogin && (
                  <motion.div
                    key="login" className="lp-auth-inner"
                    initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
                    transition={{ duration: 0.25 }}
                  >
                    <div className="lp-auth-head">
                      <h1>Anmelden</h1>
                      <p>Bei deinem BeeQu-Konto anmelden</p>
                    </div>
                    {loginError && (
                      <div className="lp-auth-error"><AlertCircle size={15} /><span>{loginError}</span></div>
                    )}
                    <form onSubmit={handleLogin} className="lp-auth-form">
                      <div className="lp-field">
                        <label htmlFor="login-email">E-Mail-Adresse</label>
                        <div className="lp-input-wrap">
                          <Mail size={16} className="lp-input-ico" />
                          <input id="login-email" type="email" placeholder="du@example.com"
                            value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required autoComplete="email" />
                        </div>
                      </div>
                      <div className="lp-field">
                        <label htmlFor="login-pw">Passwort</label>
                        <div className="lp-input-wrap">
                          <Key size={16} className="lp-input-ico" />
                          <input id="login-pw" type="password" placeholder="Dein Passwort"
                            value={loginPassword} onChange={e => setLoginPassword(e.target.value)} required autoComplete="current-password" />
                        </div>
                      </div>
                      <button type="submit" disabled={loading} className="lp-auth-submit">
                        {loading ? <span className="lp-auth-spinner" /> : <>Anmelden <ArrowRight size={16} /></>}
                      </button>
                    </form>
                    <div className="lp-auth-switch">
                      <span>Noch kein Konto?</span>
                      <button onClick={openRegister}>Kostenlos registrieren</button>
                    </div>
                  </motion.div>
                )}

                {showRegister && (
                  <motion.div
                    key="register" className="lp-auth-inner"
                    initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
                    transition={{ duration: 0.25 }}
                  >
                    {pendingEmail ? (
                      /* ── Code-Verifikation ── */
                      <AnimatePresence mode="wait">
                        {verifyStep === 'checking' && (
                          <motion.div
                            key="checking" className="lp-verify"
                            initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }}
                            transition={{ duration: 0.22 }}
                          >
                            <svg className="lp-verify-arc" viewBox="0 0 48 48" fill="none">
                              <circle cx="24" cy="24" r="20" stroke="rgba(255,255,255,0.14)" strokeWidth="4"/>
                              <circle cx="24" cy="24" r="20" stroke="#007AFF" strokeWidth="4"
                                strokeDasharray="60 66" strokeLinecap="round"
                                style={{ transformOrigin: '50% 50%', animation: 'lp-spin 0.9s linear infinite' }}/>
                            </svg>
                            <h1 style={{ marginTop: 20 }}>Wird überprüft…</h1>
                            <p>Dein Code wird verifiziert.</p>
                          </motion.div>
                        )}
                        {verifyStep === 'done' && (
                          <motion.div
                            key="done" className="lp-verify"
                            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.3, type: 'spring', stiffness: 280, damping: 22 }}
                          >
                            <svg className="lp-verify-success" viewBox="0 0 48 48" fill="none" width="56" height="56">
                              <circle cx="24" cy="24" r="24" fill="#34C759" fillOpacity="0.12"/>
                              <circle cx="24" cy="24" r="20" stroke="#34C759" strokeWidth="2.5"/>
                              <path d="M15 24.5l6.5 6.5 11-12" stroke="#34C759" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <h1 style={{ marginTop: 16, color: '#34C759' }}>Konto aktiviert!</h1>
                            <p>Du wirst automatisch weitergeleitet…</p>
                          </motion.div>
                        )}
                        {verifyStep === 'input' && (
                          <motion.div
                            key="input" className="lp-verify"
                            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.22 }}
                          >
                            <div className="lp-verify-mail"><Mail size={28} color="#007AFF"/></div>
                            <h1>Code eingeben</h1>
                            <p>
                              Wir haben einen 6-stelligen Code an<br />
                              <strong>{pendingEmail}</strong><br />
                              gesendet. Bitte prüfe dein Postfach.
                            </p>
                            <div className="lp-verify-digits" onPaste={handleVerifyPaste}>
                              {verifyDigits.map((d, i) => (
                                <input
                                  key={i}
                                  ref={verifyRefs[i]}
                                  type="text" inputMode="numeric" maxLength={1} value={d}
                                  className={`lp-verify-digit${d ? ' filled' : ''}`}
                                  aria-label={`Stelle ${i + 1}`}
                                  onChange={e => handleVerifyDigit(i, e.target.value)}
                                  onKeyDown={e => handleVerifyKeyDown(i, e)}
                                />
                              ))}
                            </div>
                            {verifyError && (
                              <div className="lp-auth-error" style={{ marginTop: 8 }}>
                                <AlertCircle size={14} /><span>{verifyError}</span>
                              </div>
                            )}
                            <button
                              className="lp-auth-submit" style={{ marginTop: 20 }}
                              onClick={handleVerifySubmit}
                              disabled={verifyDigits.join('').length < 6 || loading}
                            >
                              {loading ? <span className="lp-auth-spinner"/> : <>Bestätigen <ArrowRight size={16}/></>}
                            </button>
                            <p className="lp-verify-hint">
                              Kein Mail erhalten? Prüfe deinen Spam-Ordner.<br />
                              Der Code ist 10 Minuten gültig.
                            </p>
                            <button
                              className="lp-verify-back"
                              onClick={() => { setPendingEmail(''); setVerifyStep('input'); setVerifyDigits(['','','','','','']); }}
                            >
                              Zurück zur Registrierung
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    ) : (
                      /* ── Registrierungsformular ── */
                      <>
                        <div className="lp-auth-head">
                          <h1>Konto erstellen</h1>
                          <p>Kostenlos starten — keine Kreditkarte nötig</p>
                        </div>
                        {registerError && (
                          <div className="lp-auth-error"><AlertCircle size={15} /><span>{registerError}</span></div>
                        )}
                        <form onSubmit={handleRegister} className="lp-auth-form">
                          <div className="lp-field">
                            <label htmlFor="reg-name">Vollständiger Name</label>
                            <div className="lp-input-wrap">
                              <User size={16} className="lp-input-ico" />
                              <input id="reg-name" type="text" placeholder="Max Mustermann"
                                value={registerName} onChange={e => setRegisterName(e.target.value)} required autoComplete="name" />
                            </div>
                          </div>
                          <div className="lp-field">
                            <label htmlFor="reg-email">E-Mail-Adresse</label>
                            <div className="lp-input-wrap">
                              <Mail size={16} className="lp-input-ico" />
                              <input id="reg-email" type="email" placeholder="du@example.com"
                                value={registerEmail} onChange={e => setRegisterEmail(e.target.value)} required autoComplete="email" />
                            </div>
                          </div>
                          <div className="lp-field">
                            <label htmlFor="reg-pw">Passwort</label>
                            <div className="lp-input-wrap">
                              <Key size={16} className="lp-input-ico" />
                              <input id="reg-pw" type="password" placeholder="Mind. 6 Zeichen"
                                value={registerPassword} onChange={e => setRegisterPassword(e.target.value)} required autoComplete="new-password" minLength={6} />
                            </div>
                          </div>
                          <p className="lp-auth-consent">
                            Mit der Registrierung stimmst du unseren <Link to="/agb">AGB</Link> und der <Link to="/datenschutz">Datenschutzerklaerung</Link> zu.
                          </p>
                          <button type="submit" disabled={loading} className="lp-auth-submit">
                            {loading ? <span className="lp-auth-spinner" /> : <>Konto erstellen <ArrowRight size={16} /></>}
                          </button>
                        </form>
                        <div className="lp-auth-switch">
                          <span>Bereits registriert?</span>
                          <button onClick={openLogin}>Anmelden</button>
                        </div>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
