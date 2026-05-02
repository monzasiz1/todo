import { useEffect, useMemo, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle, ArrowRight, ArrowUp, BarChart2, Bell, CalendarDays,
  Check, CheckCircle2, ChevronDown, Clock, FileText, Flag,
  Key, Layers3, LayoutDashboard, ListTodo, Mail, Paperclip, Repeat,
  Sparkles, Tag, Target, UsersRound, User, X, Zap,
} from 'lucide-react';
import { PLANS } from '../lib/plans';
import { useAuthStore } from '../store/authStore';

/* ─────────────── data ─────────────── */

const planAccents = { free: '#8E8E93', pro: '#007AFF', team: '#5856D6' };
const orderedPlans = ['free', 'pro', 'team'].map((id) => PLANS[id]);

function getPlanBullets(plan) {
  if (plan.id === 'free') return [
    `Bis zu ${plan.limits.tasks} Aufgaben & ${plan.limits.categories} Kategorien`,
    'Dashboard, Kalender & Profil',
    'Smarte Erinnerungen & Notizen-Board',
    'KI, Gruppen und Anhänge ab Pro',
  ];
  if (plan.id === 'pro') return [
    'Unbegrenzte Aufgaben & Kategorien',
    `${plan.limits.aiCalls} KI-Abfragen / Monat`,
    `Bis zu ${plan.limits.groups} Gruppen & Echtzeit-Chat`,
    'Wiederholungen, Anhänge & Statistiken',
  ];
  return [
    'Alles aus Pro',
    `${plan.limits.aiCalls} KI-Abfragen / Monat`,
    'Unbegrenzte Gruppen & Mitglieder',
    'Priority-Support für dein Team',
  ];
}

const bentoFeatures = [
  { icon: Sparkles,   color: '#007AFF', bg: 'rgba(0,122,255,0.1)',   title: 'KI-Texteingabe',         desc: '"Meeting Freitag 14 Uhr" — BeeQu erkennt Datum, Zeit und Priorität automatisch.', plan: 'Pro & Team', wide: true },
  { icon: CalendarDays,color:'#5856D6', bg: 'rgba(88,86,214,0.1)',   title: 'Kalender',               desc: 'Monats- & Wochenansicht mit direkter Aufgabenintegration.', plan: 'Alle Pläne' },
  { icon: UsersRound, color: '#34C759', bg: 'rgba(52,199,89,0.1)',   title: 'Gruppen & Chat',         desc: 'Teams, Rollen, Echtzeit-Chat und gemeinsame Aufgaben.', plan: 'Pro & Team' },
  { icon: Repeat,     color: '#FF9500', bg: 'rgba(255,149,0,0.1)',   title: 'Wiederholungen',         desc: 'Täglich, wöchentlich, monatlich — einmal anlegen, immer vorhanden.', plan: 'Pro & Team' },
  { icon: BarChart2,  color: '#FF375F', bg: 'rgba(255,55,95,0.1)',   title: 'Statistiken',            desc: 'Erledigte Aufgaben, Kategorien, Wochenquote — alles auf einen Blick.', plan: 'Pro & Team' },
  { icon: Paperclip,  color: '#FF9500', bg: 'rgba(255,149,0,0.1)',   title: 'Dateianhänge',           desc: 'Dokumente und Bilder direkt an Aufgaben anhängen — bis 4 MB.', plan: 'Pro & Team' },
  { icon: Bell,       color: '#5856D6', bg: 'rgba(88,86,214,0.1)',   title: 'Erinnerungen',           desc: 'Push-Benachrichtigungen, die dich genau rechtzeitig erinnern.', plan: 'Alle Pläne' },
  { icon: FileText,   color: '#007AFF', bg: 'rgba(0,122,255,0.1)',   title: 'Notizen-Board',          desc: 'Kanban-Board für schnelle Gedanken — immer griffbereit.', plan: 'Alle Pläne' },
];

const mockTasks = [
  {
    title: 'Aufbau Zelt / Aufraeumaktion',
    subtitle: 'Ausrichter: Verein Team',
    cat: 'Gut Schlag',
    catColor: '#34C759',
    prio: 'medium',
    time: '10:00 Uhr - 16:00 Uhr',
    day: '2',
    month: 'MAI',
    type: 'Termin',
    done: false,
    section: 'today',
    tags: ['Auswahl', 'Nur lesen'],
  },
  {
    title: 'Rechnung begleichen',
    subtitle: 'Telefonica Germany',
    cat: 'Einkaufen',
    catColor: '#FF3B30',
    prio: 'urgent',
    time: '4. Mai',
    day: '4',
    month: 'MAI',
    type: 'Aufgabe',
    done: false,
    section: 'later',
    tags: [],
  },
  {
    title: 'Gemeinschaftsprobe',
    subtitle: 'Musikheim',
    cat: 'Gesundheit',
    catColor: '#00C7BE',
    prio: 'low',
    time: '6. Mai, 19:00 Uhr - 21:00 Uhr',
    day: '6',
    month: 'MAI',
    type: 'Termin',
    done: false,
    section: 'later',
    tags: ['Woechentlich'],
  },
  {
    title: 'Martina Geburtstag',
    subtitle: 'Familie',
    cat: 'Familie',
    catColor: '#5856D6',
    prio: 'medium',
    time: '7. Mai',
    day: '7',
    month: 'MAI',
    type: 'Termin',
    done: false,
    section: 'later',
    tags: ['Jaehrlich'],
  },
];

const mockSidebarCategories = [
  { name: 'Alle', color: '#007AFF', n: 45 },
  { name: 'Arbeit', color: '#007AFF', n: 8 },
  { name: 'Auftritt', color: '#5AC8FA', n: 4 },
  { name: 'Bildung', color: '#34C759', n: 3 },
  { name: 'Einkaufen', color: '#FF3B30', n: 2 },
  { name: 'Finanzen', color: '#5856D6', n: 3 },
  { name: 'Gesundheit', color: '#00C7BE', n: 6 },
  { name: 'Familie', color: '#AF52DE', n: 5 },
];

const prioBar = { urgent: '#FF3B30', high: '#FF9500', medium: '#007AFF', low: '#34C759' };

const aiExamples = [
  { input: '"Meeting Freitag 14:00, hohe Priorität"',   title: 'Meeting',    date: 'Freitag', time: '14:00', cat: 'Arbeit',  prio: 'Hoch'   },
  { input: '"Morgen Einkaufen um 17:30"',                title: 'Einkaufen',  date: 'Morgen',  time: '17:30', cat: 'Privat',  prio: 'Niedrig'},
  { input: '"Montag Sportstudio 19 Uhr, mittel"',        title: 'Sportstudio',date: 'Montag',  time: '19:00', cat: 'Sport',   prio: 'Mittel' },
];

const ease = [0.25, 0.46, 0.45, 0.94];
const fadeUp = {
  hidden:  { opacity: 0, y: 24 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.07, duration: 0.45, ease } }),
};
const fadeIn = {
  hidden:  { opacity: 0 },
  visible: (i = 0) => ({ opacity: 1, transition: { delay: i * 0.06, duration: 0.4 } }),
};

/* ─────────────── component ─────────────── */

export default function LandingPage() {
  const heroRef = useRef(null);
  const frameRef = useRef(null);
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
  const [mockFilter, setMockFilter] = useState('all');
  const [mockCollapsed, setMockCollapsed] = useState({ today: false, later: false });
  const [mockSearchOpen, setMockSearchOpen] = useState(false);
  const [mockQuery, setMockQuery] = useState('');
  const [mockTaskState, setMockTaskState] = useState(() =>
    mockTasks.map((task, idx) => ({ ...task, id: `${idx}-${task.title}` }))
  );
  const { login, register, verifyCode, loading } = useAuthStore();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault(); setLoginError('');
    try { const ok = await login(loginEmail, loginPassword); if (ok) navigate('/app'); }
    catch (err) { setLoginError(err.message || 'Login fehlgeschlagen'); }
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

  const visibleMockTasks = useMemo(() => {
    const q = mockQuery.trim().toLowerCase();
    return mockTaskState.filter((task) => {
      const byFilter =
        mockFilter === 'all' ? true :
        task.prio === mockFilter;

      if (!byFilter) return false;
      if (!q) return true;

      return (
        String(task.title || '').toLowerCase().includes(q) ||
        String(task.cat || '').toLowerCase().includes(q)
      );
    });
  }, [mockFilter, mockQuery, mockTaskState]);

  const toggleMockTask = (taskId) => {
    setMockTaskState((prev) => prev.map((task) => (
      task.id === taskId ? { ...task, done: !task.done } : task
    )));
  };

  const visibleTodayTasks = useMemo(
    () => visibleMockTasks.filter((task) => task.section === 'today'),
    [visibleMockTasks]
  );

  const visibleLaterTasks = useMemo(
    () => visibleMockTasks.filter((task) => task.section === 'later'),
    [visibleMockTasks]
  );

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return undefined;

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');

    const onMove = (e) => {
      if (mq.matches) return;
      const rect = hero.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;

      const logoX = px * 26;
      const logoY = py * 22;
      const auraX = px * 14;
      const auraY = py * 12;

      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        hero.style.setProperty('--bq-logo-x', `${logoX.toFixed(2)}px`);
        hero.style.setProperty('--bq-logo-y', `${logoY.toFixed(2)}px`);
        hero.style.setProperty('--bq-aura-x', `${auraX.toFixed(2)}px`);
        hero.style.setProperty('--bq-aura-y', `${auraY.toFixed(2)}px`);
      });
    };

    const onScroll = () => {
      const rect = hero.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, (-rect.top) / Math.max(1, rect.height * 0.65)));
      hero.style.setProperty('--bq-hero-scroll', progress.toFixed(3));
    };

    const onLeave = () => {
      hero.style.setProperty('--bq-logo-x', '0px');
      hero.style.setProperty('--bq-logo-y', '0px');
      hero.style.setProperty('--bq-aura-x', '0px');
      hero.style.setProperty('--bq-aura-y', '0px');
    };

    onScroll();
    hero.addEventListener('mousemove', onMove);
    hero.addEventListener('mouseleave', onLeave);
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      hero.removeEventListener('mousemove', onMove);
      hero.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div className="bq">

      {/* ══════════ NAV ══════════ */}
      <nav className="bq-nav">
        <div className="bq-nav-inner">
          <Link to="/landing" className="bq-brand">
            <img src="/icons/icon.png" alt="" className="bq-brand-icon" />
            <span>BeeQu</span>
          </Link>
          <div className="bq-nav-links">
            <a href="#features">Features</a>
            <a href="#ai">KI-Eingabe</a>
            <a href="#pricing">Preise</a>
          </div>
          <div className="bq-nav-actions">
            <button onClick={() => setShowLogin(true)}    className="bq-btn bq-ghost">Anmelden</button>
            <button onClick={() => setShowRegister(true)} className="bq-btn bq-primary">Kostenlos starten</button>
          </div>
        </div>
      </nav>

      {/* ══════════ HERO (dark) ══════════ */}
      <section className="bq-hero" ref={heroRef}>
        <div className="bq-hero-bg" aria-hidden />
        <div className="bq-hero-grid-lines" aria-hidden />
        <div className="bq-hero-logo-bg" aria-hidden>
          <img src="/icons/icon.png" alt="" className="bq-hero-logo-mark" />
          <div className="bq-hero-logo-aura" />
        </div>
        <div className="bq-hero-bottom-fade" aria-hidden />

        {/* copy */}
        <motion.div
          className="bq-hero-copy"
          initial="hidden" animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.09 } } }}
        >
          <motion.div className="bq-eyebrow" variants={fadeUp}>
            <span className="bq-live-dot" />
            BeeQu — Jetzt verfügbar
          </motion.div>

          <motion.h1 className="bq-hero-h1" variants={fadeUp}>
            Smarter planen.<br />
            <span className="bq-hero-accent">Mehr erledigen.</span>
          </motion.h1>

          <motion.p className="bq-hero-sub" variants={fadeUp}>
            BeeQu verbindet Aufgaben, Kalender und Teams in einer App —&nbsp;
            mit KI, die deine Sprache versteht und Aufgaben automatisch anlegt.
          </motion.p>

          <motion.div className="bq-hero-actions" variants={fadeUp}>
            <button onClick={() => setShowRegister(true)} className="bq-btn bq-primary bq-btn-lg">
              Kostenlos starten <ArrowRight size={17} />
            </button>
            <button onClick={() => setShowLogin(true)} className="bq-btn bq-ghost bq-btn-lg">
              Anmelden
            </button>
          </motion.div>

          <motion.div className="bq-hero-trust" variants={fadeUp}>
            {['Keine Kreditkarte', 'Free Plan inklusive', 'Installierbar als App'].map(t => (
              <span key={t}><Check size={13} strokeWidth={3} />{t}</span>
            ))}
          </motion.div>
        </motion.div>

        {/* ── floating app mock ── */}
        <motion.div
          className="bq-hero-mock-wrap"
          initial={{ opacity: 0, y: 48, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.35, ease }}
        >
          <div className="bq-mock-shell">
            {/* chrome */}
            <div className="bq-mock-chrome">
              <span className="bq-dot" style={{ background: '#FF5F57' }} />
              <span className="bq-dot" style={{ background: '#FFBD2E' }} />
              <span className="bq-dot" style={{ background: '#28CA41' }} />
              <span className="bq-mock-url">beequ.app — Dashboard</span>
            </div>

            {/* body */}
            <div className="bq-mock-body">

              {/* sidebar */}
              <aside className="bq-mock-sidebar">
                <div className="bq-mock-logo">
                  <img src="/icons/icon.png" alt="" className="bq-mock-logo-img" />
                  <span>BeeQu</span>
                </div>
                <nav className="bq-mock-nav">
                  {[
                    { icon: LayoutDashboard, label: 'Dashboard', active: true  },
                    { icon: CalendarDays,    label: 'Kalender',  active: false },
                    { icon: Sparkles,        label: 'Notizen',   active: false },
                    { icon: UsersRound,      label: 'Gruppen',   active: false },
                    { icon: UsersRound,      label: 'Freunde',   active: false },
                    { icon: Bell,            label: 'Benachrichtigungen', active: false },
                  ].map(({ icon: Icon, label, active }) => (
                    <div key={label} className={`bq-mock-nav-item${active ? ' active' : ''}`}>
                      <Icon size={15} />
                      <span>{label}</span>
                    </div>
                  ))}
                </nav>
                <div className="bq-mock-ai-hint">
                  <div className="bq-mock-ai-hint-head">
                    <Sparkles size={12} />
                    <span>KI-Eingabe</span>
                  </div>
                  <p>Schreib z.B. "Freitag Reinigung 18 Uhr" und die KI erkennt alles.</p>
                </div>
                <div className="bq-mock-cats">
                  <div className="bq-mock-cats-label-row">
                    <span className="bq-mock-cats-label">KATEGORIEN</span>
                    <span className="bq-mock-cats-manage">Verwalten</span>
                  </div>
                  {mockSidebarCategories.map(({ name, color, n }) => (
                    <div key={name} className="bq-mock-cat">
                      <span className="bq-mock-cat-dot" style={{ background: color }} />
                      <span className="bq-mock-cat-name">{name}</span>
                      <span className="bq-mock-cat-n">{n}</span>
                    </div>
                  ))}
                </div>

                <div className="bq-mock-user-card">
                  <AvatarBadge name="Rene Schroers" color="#1D4ED8" size={24} />
                  <div className="bq-mock-user-meta">
                    <strong>Rene Schroers</strong>
                    <span>rene-schroers@gmx.de</span>
                  </div>
                </div>
              </aside>

              {/* main */}
              <div className="bq-mock-main">
                <div className="bq-mock-greeting">
                  <h3>Guten Abend 👋</h3>
                  <p>Was steht heute an?</p>
                </div>

                {/* AI Input — rotating gradient */}
                <div className="bq-mock-ai-glow">
                  <div className="bq-mock-ai-card">
                    <div className="bq-mock-ai-row">
                      <Sparkles size={16} className="bq-mock-ai-spark" />
                      <span className="bq-mock-ai-placeholder">Sag der KI was du tun möchtest…</span>
                      <div className="bq-mock-ai-submit"><ArrowUp size={13} /></div>
                    </div>
                    <div className="bq-mock-ai-tags">
                      <span className="bq-mock-tag bq-tag-date">📅 Freitag</span>
                      <span className="bq-mock-tag bq-tag-time">⏰ 14:00</span>
                      <span className="bq-mock-tag bq-tag-prio">🔴 Hoch</span>
                      <span className="bq-mock-tag bq-tag-cat">💼 Arbeit</span>
                    </div>
                  </div>
                  <button className="bq-mock-manual">
                    <span>+ Manuell erstellen</span>
                    <span className="bq-mock-manual-sub">Aufgabe ohne KI anlegen</span>
                  </button>
                </div>

                {/* Insights */}
                <div className="bq-mock-insights">
                  <div className="bq-mock-ins-head">
                    <div className="bq-mock-ins-title"><Target size={12} />Fokus heute</div>
                    <div className="bq-mock-ins-metas">
                      <span>Heute: 4</span><span>Überfällig: 1</span><span>Woche: 87%</span>
                    </div>
                  </div>
                  <div className="bq-mock-ins-list">
                    <div className="bq-mock-ins-item">
                      <div className="bq-mock-ins-icon alert">!</div>
                      <span>3 Aufgaben fällig bis 18:00 Uhr</span>
                    </div>
                    <div className="bq-mock-ins-item">
                      <div className="bq-mock-ins-icon calm">✓</div>
                      <span>Du liegst diese Woche 12% über deinem Schnitt</span>
                    </div>
                  </div>
                </div>

                {/* Filter bar */}
                <div className="bq-mock-filter">
                  <button
                    type="button"
                    className={`bq-mock-filter-btn${mockFilter === 'all' ? ' active' : ''}`}
                    onClick={() => setMockFilter('all')}
                  >
                    Alle
                  </button>
                  <button
                    type="button"
                    className={`bq-mock-filter-btn${mockFilter === 'urgent' ? ' active' : ''}`}
                    onClick={() => setMockFilter('urgent')}
                  >
                    <span className="bq-fd" style={{ background: '#FF3B30' }} />Dringend
                  </button>
                  <button
                    type="button"
                    className={`bq-mock-filter-btn${mockFilter === 'high' ? ' active' : ''}`}
                    onClick={() => setMockFilter('high')}
                  >
                    <span className="bq-fd" style={{ background: '#FF9500' }} />Hoch
                  </button>
                  <button
                    type="button"
                    className={`bq-mock-filter-btn${mockFilter === 'medium' ? ' active' : ''}`}
                    onClick={() => setMockFilter('medium')}
                  >
                    <span className="bq-fd" style={{ background: '#007AFF' }} />Mittel
                  </button>
                  <button
                    type="button"
                    className={`bq-mock-filter-btn${mockFilter === 'low' ? ' active' : ''}`}
                    onClick={() => setMockFilter('low')}
                  >
                    <span className="bq-fd" style={{ background: '#34C759' }} />Niedrig
                  </button>
                  <span className="bq-mock-filter-sep" />
                  <button
                    type="button"
                    className={`bq-mock-filter-btn bq-mock-search${mockSearchOpen ? ' active' : ''}`}
                    onClick={() => setMockSearchOpen((prev) => !prev)}
                  >
                    🔍 Suchen
                  </button>
                  {mockSearchOpen && (
                    <input
                      type="text"
                      value={mockQuery}
                      onChange={(e) => setMockQuery(e.target.value)}
                      className="bq-mock-search-input"
                      placeholder="Titel oder Kategorie"
                      aria-label="Mock Suche"
                    />
                  )}
                </div>

                {/* Task section */}
                <div className="bq-mock-section">
                  <button
                    type="button"
                    className="bq-mock-sec-head"
                    onClick={() => setMockCollapsed((prev) => ({ ...prev, today: !prev.today }))}
                  >
                    <div className="bq-mock-sec-left">
                      <div className="bq-mock-sec-icon warning">!</div>
                      <span>Heute</span>
                    </div>
                    <span className="bq-mock-count">{visibleTodayTasks.length}</span>
                    <ChevronDown size={14} className={`bq-mock-chevron${mockCollapsed.today ? ' collapsed' : ''}`} />
                  </button>

                  {!mockCollapsed.today && (
                    <div className="bq-mock-task-list">
                      {visibleTodayTasks.length === 0 && (
                        <div className="bq-mock-empty">Keine passenden Aufgaben</div>
                      )}
                      {visibleTodayTasks.map(({ id, title, subtitle, cat, catColor, prio, time, day, month, type, tags, done }) => (
                        <div key={id} className={`bq-mock-task${done ? ' done' : ''}`}>
                          <div className="bq-mock-task-bar" style={{ background: prioBar[prio] }} />
                          <div className="bq-mock-date-chip">
                            <span>{month}</span>
                            <strong>{day}</strong>
                          </div>
                          <button
                            type="button"
                            className={`bq-mock-task-check${done ? ' checked' : ''}`}
                            onClick={() => toggleMockTask(id)}
                            aria-label={`Aufgabe ${title} umschalten`}
                          >
                            {done && <Check size={11} strokeWidth={3} />}
                          </button>
                          <div className="bq-mock-task-body">
                            <div className="bq-mock-task-title-row">
                              <span className={`bq-mock-type-pill ${type === 'Termin' ? 'event' : 'task'}`}>{type}</span>
                              <strong className={done ? 'struck' : ''}>{title}</strong>
                            </div>
                            <div className="bq-mock-task-subtitle">{subtitle}</div>
                            <div className="bq-mock-task-meta">
                              <span className="bq-mock-cat-badge" style={{ background: `${catColor}22`, color: catColor }}>{cat}</span>
                              {tags?.map((tag) => (
                                <span key={tag} className="bq-mock-repeat-badge"><Repeat size={9} />{tag}</span>
                              ))}
                              <span className="bq-mock-meta-item"><Clock size={10} />{time}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bq-mock-section">
                  <button
                    type="button"
                    className="bq-mock-sec-head"
                    onClick={() => setMockCollapsed((prev) => ({ ...prev, later: !prev.later }))}
                  >
                    <div className="bq-mock-sec-left">
                      <div className="bq-mock-sec-icon">•</div>
                      <span>Spaeter</span>
                    </div>
                    <span className="bq-mock-count">{visibleLaterTasks.length}</span>
                    <ChevronDown size={14} className={`bq-mock-chevron${mockCollapsed.later ? ' collapsed' : ''}`} />
                  </button>

                  {!mockCollapsed.later && (
                    <div className="bq-mock-task-list">
                      {visibleLaterTasks.length === 0 && (
                        <div className="bq-mock-empty">Keine passenden Aufgaben</div>
                      )}
                      {visibleLaterTasks.map(({ id, title, subtitle, cat, catColor, prio, time, day, month, type, tags, done }) => (
                        <div key={id} className={`bq-mock-task${done ? ' done' : ''}`}>
                          <div className="bq-mock-task-bar" style={{ background: prioBar[prio] }} />
                          <div className="bq-mock-date-chip">
                            <span>{month}</span>
                            <strong>{day}</strong>
                          </div>
                          <button
                            type="button"
                            className={`bq-mock-task-check${done ? ' checked' : ''}`}
                            onClick={() => toggleMockTask(id)}
                            aria-label={`Aufgabe ${title} umschalten`}
                          >
                            {done && <Check size={11} strokeWidth={3} />}
                          </button>
                          <div className="bq-mock-task-body">
                            <div className="bq-mock-task-title-row">
                              <span className={`bq-mock-type-pill ${type === 'Termin' ? 'event' : 'task'}`}>{type}</span>
                              <strong className={done ? 'struck' : ''}>{title}</strong>
                            </div>
                            <div className="bq-mock-task-subtitle">{subtitle}</div>
                            <div className="bq-mock-task-meta">
                              <span className="bq-mock-cat-badge" style={{ background: `${catColor}22`, color: catColor }}>{cat}</span>
                              {tags?.map((tag) => (
                                <span key={tag} className="bq-mock-repeat-badge"><Repeat size={9} />{tag}</span>
                              ))}
                              <span className="bq-mock-meta-item"><Clock size={10} />{time}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

            </div>{/* /body */}
          </div>{/* /mock-shell */}
        </motion.div>
      </section>

      {/* ══════════ STRIP ══════════ */}
      <div className="bq-strip">
        <div className="bq-strip-inner">
          {[
            { icon: Zap,         text: 'KI versteht natürliche Sprache' },
            { icon: CalendarDays,text: 'Tasks direkt im Kalender' },
            { icon: UsersRound,  text: 'Echtzeit-Gruppen-Chat' },
            { icon: Layers3,     text: 'Tasks · Kalender · Teams in einer App' },
            { icon: Bell,        text: 'Smarte Push-Erinnerungen' },
          ].map(({ icon: Icon, text }, i) => (
            <motion.div
              key={text} className="bq-strip-item"
              initial="hidden" whileInView="visible" viewport={{ once: true }}
              variants={fadeIn} custom={i}
            >
              <Icon size={16} />
              <span>{text}</span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ══════════ BENTO FEATURES ══════════ */}
      <section className="bq-section bq-features-section" id="features">
        <div className="bq-container">
          <div className="bq-features-orb bq-features-orb-a" aria-hidden />
          <div className="bq-features-orb bq-features-orb-b" aria-hidden />
          <motion.div
            className="bq-section-head"
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-60px' }}
            variants={fadeUp}
          >
            <span className="bq-label">Features</span>
            <h2>Alles was du brauchst.<br /><span className="bq-h2-muted">In einer App.</span></h2>
            <p>Keine drei verschiedenen Tools mehr. BeeQu vereint Aufgabenverwaltung, Kalender und Teamarbeit — mit KI als Herzstück.</p>
          </motion.div>

          <div className="bq-bento">
            {bentoFeatures.map(({ icon: Icon, color, bg, title, desc, plan, wide }, i) => (
              <motion.div
                key={title}
                className={`bq-bento-card${wide ? ' wide' : ''}`}
                style={{ '--bq-card-accent': color, '--bq-card-tint': bg }}
                initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-40px' }}
                custom={i % 4} variants={fadeUp}
              >
                <div className="bq-bento-icon" style={{ color, background: bg }}>
                  <Icon size={22} />
                </div>
                <div className="bq-bento-plan" style={{ color, background: bg }}>{plan}</div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ AI SPOTLIGHT ══════════ */}
      <section className="bq-section bq-section-alt" id="ai">
        <div className="bq-container">
          <div className="bq-ai-split">

            {/* Left — exact AI input mock */}
            <motion.div
              className="bq-ai-demo-wrap"
              initial={{ opacity: 0, x: -28 }} whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.55, ease }}
            >
              <div className="bq-ai-demo-card">
                {/* Beispiel-Buttons */}
                <div className="bq-ai-examples">
                  {aiExamples.map((ex, i) => (
                    <button
                      key={i}
                      className={`bq-ai-ex${i === aiIdx ? ' active' : ''}`}
                      onClick={() => setAiIdx(i)}
                    >
                      {ex.input}
                    </button>
                  ))}
                </div>

                {/* Echtes Input-Feld (Demo) */}
                <div className="bq-ai-input-mock">
                  <div className="bq-ai-input-mock-icon">
                    <Sparkles size={18} />
                  </div>
                  <span className="bq-ai-input-mock-text">{ai.input}</span>
                  <div className="bq-ai-input-mock-send">
                    <ArrowUp size={16} />
                  </div>
                </div>

                {/* Live-Vorschau Tags (wie in der echten App) */}
                <motion.div
                  key={aiIdx}
                  className="bq-ai-tags-preview"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28 }}
                >
                  <span className="bq-ai-tag task-type">
                    <ListTodo size={12} /> Aufgabe
                  </span>
                  <span className="bq-ai-tag">
                    <Tag size={12} /> {ai.title}
                  </span>
                  <span className="bq-ai-tag date">
                    <CalendarDays size={12} /> {ai.date}
                  </span>
                  {ai.time && (
                    <span className="bq-ai-tag time">
                      <Clock size={12} /> {ai.time}
                    </span>
                  )}
                  <span className="bq-ai-tag category">
                    {ai.cat}
                  </span>
                  {ai.prio !== 'Mittel' && (
                    <span className="bq-ai-tag priority">
                      <Flag size={12} /> {ai.prio}
                    </span>
                  )}
                </motion.div>

                <div className="bq-ai-langs">🌍 Deutsch &amp; Englisch unterstützt</div>
              </div>
            </motion.div>

            {/* Right — copy */}
            <motion.div
              className="bq-ai-copy"
              initial="hidden" whileInView="visible"
              viewport={{ once: true, margin: '-60px' }}
              variants={{ visible: { transition: { staggerChildren: 0.09 } } }}
            >
              <motion.span className="bq-label" variants={fadeUp}>KI-Assistent</motion.span>
              <motion.h2 variants={fadeUp}>
                Aufgaben anlegen<br />so natürlich wie<br /><span className="bq-hero-accent">tippen.</span>
              </motion.h2>
              <motion.p className="bq-ai-copy-desc" variants={fadeUp}>
                Vergiss Formulare. Schreib einfach was du vorhast — BeeQu's KI erkennt Datum, Uhrzeit, Kategorie und Priorität und legt die fertige Aufgabe an.
              </motion.p>
              <motion.div className="bq-ai-points" variants={fadeUp}>
                {[
                  { icon: CalendarDays, text: '"morgen", "nächsten Montag", "um 14 Uhr" — alles wird korrekt erkannt.' },
                  { icon: Layers3,      text: 'Kategorien & Prioritäten werden automatisch aus dem Kontext abgeleitet.' },
                  { icon: Zap,          text: 'Ein Satz — eine fertige Aufgabe. Kein Klick durch Formulare.' },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="bq-ai-point">
                    <div className="bq-ai-point-icon"><Icon size={15} /></div>
                    <span>{text}</span>
                  </div>
                ))}
              </motion.div>
              <motion.div variants={fadeUp}>
                <button onClick={() => setShowRegister(true)} className="bq-btn bq-primary bq-btn-lg">
                  KI kostenlos testen <ArrowRight size={17} />
                </button>
              </motion.div>
            </motion.div>

          </div>
        </div>
      </section>

      {/* ══════════ PRICING ══════════ */}
      <section className="bq-section" id="pricing">
        <div className="bq-container">
          <motion.div
            className="bq-section-head"
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-60px' }}
            variants={fadeUp}
          >
            <span className="bq-label">Preise</span>
            <h2>Einfach und transparent.<br /><span className="bq-h2-muted">Keine Überraschungen.</span></h2>
            <p>Starte mit Free und upgrade wenn du bereit bist — jederzeit kündbar, keine versteckten Kosten.</p>
          </motion.div>

          <div className="bq-pricing-grid">
            {orderedPlans.map((plan, i) => (
              <motion.div
                key={plan.id}
                className={`bq-price-card${plan.id === 'pro' ? ' featured' : ''}`}
                initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-40px' }}
                custom={i} variants={fadeUp}
              >
                {plan.id === 'pro' && <div className="bq-price-badge">⭐ Beliebteste Wahl</div>}
                <div className="bq-price-top">
                  <span className="bq-price-plan" style={{ color: planAccents[plan.id] }}>{plan.label}</span>
                  <div className="bq-price-amount">{plan.priceLabel}</div>
                </div>
                <div className="bq-price-line" />
                <ul className="bq-price-list">
                  {getPlanBullets(plan).map((b) => (
                    <li key={b}>
                      <CheckCircle2 size={15} />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => setShowRegister(true)}
                  className={`bq-btn bq-btn-lg bq-btn-full ${plan.id === 'pro' ? 'bq-primary' : 'bq-outline'}`}
                >
                  {plan.id === 'free' ? 'Kostenlos starten' : 'Freischalten'}
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ CTA (dark) ══════════ */}
      <section className="bq-cta">
        <div className="bq-cta-glow" aria-hidden />
        <motion.div
          className="bq-cta-inner"
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-60px' }}
          variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
        >
          <motion.span className="bq-cta-eyebrow" variants={fadeUp}>Jetzt starten</motion.span>
          <motion.h2 className="bq-cta-h2" variants={fadeUp}>
            Bereit produktiver<br />zu werden?
          </motion.h2>
          <motion.p className="bq-cta-sub" variants={fadeUp}>
            Starte kostenlos — keine Kreditkarte, kein Risiko. Upgrade wenn du die Features wirklich brauchst.
          </motion.p>
          <motion.div className="bq-cta-actions" variants={fadeUp}>
            <button onClick={() => setShowRegister(true)} className="bq-btn bq-cta-primary bq-btn-lg">
              Konto erstellen <ArrowRight size={17} />
            </button>
            <button onClick={() => setShowLogin(true)} className="bq-btn bq-cta-ghost bq-btn-lg">
              Anmelden
            </button>
          </motion.div>
        </motion.div>
      </section>

      {/* ══════════ FOOTER ══════════ */}
      <footer className="bq-footer">
        <div className="bq-container bq-footer-inner">
          <div className="bq-footer-brand">
            <img src="/icons/icon.png" alt="" className="bq-footer-icon" />
            <div>
              <strong>BeeQu</strong>
            </div>
          </div>
          <nav className="bq-footer-nav">
            <a href="#features">Features</a>
            <a href="#ai">KI-Eingabe</a>
            <a href="#pricing">Preise</a>
            <Link to="/datenschutz">Datenschutz</Link>
            <Link to="/agb">AGB</Link>
          </nav>
          <p className="bq-footer-copy">© 2026 BeeQu. Alle Rechte vorbehalten.</p>
        </div>
      </footer>

      {/* ══════════ AUTH SCREENS ══════════ */}
      <AnimatePresence>
        {(showLogin || showRegister) && (
          <motion.div
              className="bq-auth-overlay bq-auth-overlay-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            {/* left — branded panel */}
            <motion.div
              className="bq-auth-brand"
              initial={{ opacity: 0, x: -32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -32 }}
              transition={{ duration: 0.38, ease }}
            >
              <div className="bq-auth-brand-top">
                <div className="bq-auth-logo">
                  <img src="/icons/icon.png" alt="BeeQu" />
                  <span>BeeQu</span>
                </div>
                <span className="bq-auth-kicker">
                  {showRegister ? 'BeeQu Workspace' : 'Persönlicher Workspace'}
                </span>
                <h2 className="bq-auth-brand-headline">
                  {showRegister ? 'Klarer Start.\nRuhiger Fokus.' : 'Zurück in deinen\nWorkspace.'}
                </h2>
                <p className="bq-auth-brand-sub">
                  {showRegister
                    ? 'Aufgaben, Kalender und Zusammenarbeit in einer übersichtlichen Oberfläche.'
                    : 'Deine Aufgaben, Termine und Gruppen warten auf dich.'}
                </p>
              </div>



              <div className="bq-auth-brand-footer">
                <span>© 2026 BeeQu</span>
                <span>·</span>
                <Link to="/datenschutz">Datenschutz</Link>
                <span>·</span>
                <Link to="/agb">AGB</Link>
              </div>
            </motion.div>

            {/* right — form panel */}
            <motion.div
              className="bq-auth-form-panel"
              initial={{ opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 32 }}
              transition={{ duration: 0.38, ease }}
            >
                <button
                  className="bq-auth-close"
                  onClick={() => { setShowLogin(false); setShowRegister(false); }}
                  aria-label="Schließen"
                >
                  <X size={18} />
                </button>
                <AnimatePresence mode="wait">
                  {showLogin && (
                    <motion.div
                      key="login"
                      className="bq-auth-form-inner"
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -16 }}
                      transition={{ duration: 0.25 }}
                    >
                      <div className="bq-auth-form-head">
                        <h1>Anmelden</h1>
                        <p>Bei deinem BeeQu-Konto anmelden</p>
                      </div>
                      {loginError && (
                        <div className="bq-auth-error">
                          <AlertCircle size={15} />
                          <span>{loginError}</span>
                        </div>
                      )}
                      <form onSubmit={handleLogin} className="bq-auth-form">
                        <div className="bq-field">
                          <label htmlFor="login-email">E-Mail-Adresse</label>
                          <div className="bq-input-wrap">
                            <Mail size={16} className="bq-input-icon" />
                            <input
                              id="login-email"
                              type="email"
                              placeholder="du@example.com"
                              value={loginEmail}
                              onChange={e => setLoginEmail(e.target.value)}
                              required
                              autoComplete="email"
                            />
                          </div>
                        </div>
                        <div className="bq-field">
                          <label htmlFor="login-pw">Passwort</label>
                          <div className="bq-input-wrap">
                            <Key size={16} className="bq-input-icon" />
                            <input
                              id="login-pw"
                              type="password"
                              placeholder="Dein Passwort"
                              value={loginPassword}
                              onChange={e => setLoginPassword(e.target.value)}
                              required
                              autoComplete="current-password"
                            />
                          </div>
                        </div>
                        <button type="submit" disabled={loading} className="bq-auth-submit">
                          {loading ? (
                            <span className="bq-auth-spinner" />
                          ) : (
                            <>Anmelden <ArrowRight size={16} /></>
                          )}
                        </button>
                      </form>
                      <div className="bq-auth-switch">
                        <span>Noch kein Konto?</span>
                        <button onClick={() => { setShowLogin(false); setShowRegister(true); }}>
                          Kostenlos registrieren
                        </button>
                      </div>
                    </motion.div>
                  )}
                  {showRegister && (
                    <motion.div
                      key="register"
                      className="bq-auth-form-inner"
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -16 }}
                      transition={{ duration: 0.25 }}
                    >
                      {pendingEmail ? (
                        /* ── Code-Verifikation ── */
                        <AnimatePresence mode="wait">
                          {verifyStep === 'checking' && (
                            <motion.div
                              key="checking"
                              className="bq-auth-verify"
                              initial={{ opacity: 0, scale: 0.94 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.94 }}
                              transition={{ duration: 0.22 }}
                            >
                              <div className="bq-verify-spinner-wrap">
                                <svg className="bq-verify-arc" viewBox="0 0 48 48" fill="none">
                                  <circle cx="24" cy="24" r="20" stroke="#E5E7EB" strokeWidth="4"/>
                                  <circle cx="24" cy="24" r="20" stroke="#007AFF" strokeWidth="4"
                                    strokeDasharray="60 66" strokeLinecap="round"
                                    style={{ transformOrigin: '50% 50%', animation: 'bq-spin 0.9s linear infinite' }}/>
                                </svg>
                              </div>
                              <h1 style={{ marginTop: 20 }}>Wird überprüft…</h1>
                              <p>Dein Code wird verifiziert.</p>
                            </motion.div>
                          )}
                          {verifyStep === 'done' && (
                            <motion.div
                              key="done"
                              className="bq-auth-verify"
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.3, type: 'spring', stiffness: 280, damping: 22 }}
                            >
                              <div className="bq-verify-success-icon">
                                <svg viewBox="0 0 48 48" fill="none" width="56" height="56">
                                  <circle cx="24" cy="24" r="24" fill="#34C759" fillOpacity="0.12"/>
                                  <circle cx="24" cy="24" r="20" stroke="#34C759" strokeWidth="2.5"/>
                                  <path d="M15 24.5l6.5 6.5 11-12" stroke="#34C759" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </div>
                              <h1 style={{ marginTop: 16, color: '#34C759' }}>Konto aktiviert!</h1>
                              <p>Du wirst automatisch weitergeleitet…</p>
                            </motion.div>
                          )}
                          {verifyStep === 'input' && (
                            <motion.div
                              key="input"
                              className="bq-auth-verify"
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              transition={{ duration: 0.22 }}
                            >
                              <div className="bq-verify-mail-icon">
                                <Mail size={28} color="#007AFF"/>
                              </div>
                              <h1>Code eingeben</h1>
                              <p>
                                Wir haben einen 6-stelligen Code an<br />
                                <strong>{pendingEmail}</strong><br />
                                gesendet. Bitte prüfe dein Postfach.
                              </p>
                              <div className="bq-verify-digits" onPaste={handleVerifyPaste}>
                                {verifyDigits.map((d, i) => (
                                  <input
                                    key={i}
                                    ref={verifyRefs[i]}
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={1}
                                    value={d}
                                    className={`bq-verify-digit${d ? ' filled' : ''}`}
                                    onChange={e => handleVerifyDigit(i, e.target.value)}
                                    onKeyDown={e => handleVerifyKeyDown(i, e)}
                                  />
                                ))}
                              </div>
                              {verifyError && (
                                <div className="bq-auth-error" style={{ marginTop: 8 }}>
                                  <AlertCircle size={14} />
                                  <span>{verifyError}</span>
                                </div>
                              )}
                              <button
                                className="bq-auth-submit"
                                style={{ marginTop: 20 }}
                                onClick={handleVerifySubmit}
                                disabled={verifyDigits.join('').length < 6 || loading}
                              >
                                {loading ? <span className="bq-auth-spinner"/> : <>Bestätigen <ArrowRight size={16}/></>}
                              </button>
                              <p className="bq-auth-verify-hint">
                                Kein Mail erhalten? Prüfe deinen Spam-Ordner.<br />
                                Der Code ist 10 Minuten gültig.
                              </p>
                              <button
                                className="bq-auth-switch-btn"
                                style={{ marginTop: 4 }}
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
                          <div className="bq-auth-form-head">
                            <h1>Konto erstellen</h1>
                            <p>Kostenlos starten — keine Kreditkarte nötig</p>
                          </div>
                          {registerError && (
                            <div className="bq-auth-error">
                              <AlertCircle size={15} />
                              <span>{registerError}</span>
                            </div>
                          )}
                          <form onSubmit={handleRegister} className="bq-auth-form">
                            <div className="bq-field">
                              <label htmlFor="reg-name">Vollständiger Name</label>
                              <div className="bq-input-wrap">
                                <User size={16} className="bq-input-icon" />
                                <input
                                  id="reg-name"
                                  type="text"
                                  placeholder="Max Mustermann"
                                  value={registerName}
                                  onChange={e => setRegisterName(e.target.value)}
                                  required
                                  autoComplete="name"
                                />
                              </div>
                            </div>
                            <div className="bq-field">
                              <label htmlFor="reg-email">E-Mail-Adresse</label>
                              <div className="bq-input-wrap">
                                <Mail size={16} className="bq-input-icon" />
                                <input
                                  id="reg-email"
                                  type="email"
                                  placeholder="du@example.com"
                                  value={registerEmail}
                                  onChange={e => setRegisterEmail(e.target.value)}
                                  required
                                  autoComplete="email"
                                />
                              </div>
                            </div>
                            <div className="bq-field">
                              <label htmlFor="reg-pw">Passwort</label>
                              <div className="bq-input-wrap">
                                <Key size={16} className="bq-input-icon" />
                                <input
                                  id="reg-pw"
                                  type="password"
                                  placeholder="Mind. 6 Zeichen"
                                  value={registerPassword}
                                  onChange={e => setRegisterPassword(e.target.value)}
                                  required
                                  autoComplete="new-password"
                                  minLength={6}
                                />
                              </div>
                            </div>
                            <p className="bq-auth-consent">
                              Mit der Registrierung stimmst du unseren <Link to="/agb">AGB</Link> und der <Link to="/datenschutz">Datenschutzerklaerung</Link> zu.
                            </p>
                            <button type="submit" disabled={loading} className="bq-auth-submit">
                              {loading ? (
                                <span className="bq-auth-spinner" />
                              ) : (
                                <>Konto erstellen <ArrowRight size={16} /></>
                              )}
                            </button>
                          </form>
                          <div className="bq-auth-switch">
                            <span>Bereits registriert?</span>
                            <button onClick={() => { setShowRegister(false); setShowLogin(true); }}>
                              Anmelden
                            </button>
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
