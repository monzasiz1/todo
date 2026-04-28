import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  ArrowRight,
  Brain,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  Eye,
  Key,
  Layers3,
  Mail,
  Paperclip,
  Repeat,
  Sparkles,
  UsersRound,
  X,
  Zap,
  BarChart2,
  Bell,
  FileText,
  Users,
  Star,
  Shield,
  Smartphone,
} from 'lucide-react';
import { PLANS } from '../lib/plans';
import { useAuthStore } from '../store/authStore';

const planAccents = { free: '#8E8E93', pro: '#007AFF', team: '#5856D6' };
const orderedPlans = ['free', 'pro', 'team'].map((id) => PLANS[id]);

function getPlanBullets(plan) {
  if (plan.id === 'free')
    return [
      `Bis zu ${plan.limits.tasks} Aufgaben`,
      `Bis zu ${plan.limits.categories} Kategorien`,
      'Dashboard, Kalender & Profil',
      'KI, Gruppen und Anhänge ab Pro',
    ];
  if (plan.id === 'pro')
    return [
      'Unbegrenzte Aufgaben & Kategorien',
      `${plan.limits.aiCalls} KI-Abfragen/Monat`,
      `Bis zu ${plan.limits.groups} Gruppen & Chat`,
      'Wiederholungen, Anhänge, Statistiken',
    ];
  return [
    'Alles aus Pro',
    `${plan.limits.aiCalls} KI-Abfragen/Monat`,
    'Unbegrenzte Gruppen',
    'Priority-Support für Teams',
  ];
}

const features = [
  {
    icon: Brain,
    color: '#007AFF',
    bg: 'rgba(0,122,255,0.1)',
    label: 'KI-Eingabe',
    title: 'Natürlichsprachige Aufgaben',
    desc: 'Schreib einfach was du vorhast — BeeQu erkennt Datum, Zeit, Kategorie und Priorität automatisch.',
    plan: 'Pro & Team',
  },
  {
    icon: CalendarDays,
    color: '#5E5CE6',
    bg: 'rgba(94,92,230,0.1)',
    label: 'Kalender',
    title: 'Monats- & Wochenansicht',
    desc: 'Alle Aufgaben und Termine in einem Kalender. Erstelle Aufgaben direkt per Klick auf einen Tag.',
    plan: 'Alle Pläne',
  },
  {
    icon: UsersRound,
    color: '#34C759',
    bg: 'rgba(52,199,89,0.1)',
    label: 'Gruppen',
    title: 'Teams & Zusammenarbeit',
    desc: 'Erstelle Gruppen, lade Mitglieder ein und verwaltet Aufgaben und Chats gemeinsam.',
    plan: 'Pro & Team',
  },
  {
    icon: Repeat,
    color: '#FF9500',
    bg: 'rgba(255,149,0,0.1)',
    label: 'Wiederholungen',
    title: 'Wiederkehrende Aufgaben',
    desc: 'Täglich, wöchentlich, monatlich — BeeQu legt Aufgaben automatisch wiederholt an.',
    plan: 'Pro & Team',
  },
  {
    icon: BarChart2,
    color: '#FF375F',
    bg: 'rgba(255,55,95,0.1)',
    label: 'Statistiken',
    title: 'Produktivitäts-Insights',
    desc: 'Verfolge deinen Fortschritt mit detaillierten Statistiken zu erledigten Aufgaben und Kategorien.',
    plan: 'Pro & Team',
  },
  {
    icon: Bell,
    color: '#5856D6',
    bg: 'rgba(88,86,214,0.1)',
    label: 'Erinnerungen',
    title: 'Desktop-Benachrichtigungen',
    desc: 'Verpasse keine Fälligkeit mehr — BeeQu erinnert dich per Push genau rechtzeitig.',
    plan: 'Alle Pläne',
  },
  {
    icon: Paperclip,
    color: '#FF9500',
    bg: 'rgba(255,149,0,0.1)',
    label: 'Anhänge',
    title: 'Dateien an Aufgaben',
    desc: 'Hänge Dokumente oder Bilder direkt an Aufgaben an — bis zu 4 MB pro Datei.',
    plan: 'Pro & Team',
  },
  {
    icon: FileText,
    color: '#007AFF',
    bg: 'rgba(0,122,255,0.1)',
    label: 'Notizen',
    title: 'Notizen-Board',
    desc: 'Ein Kanban-ähnliches Board für schnelle Gedanken und Ideen, direkt neben deinen Aufgaben.',
    plan: 'Alle Pläne',
  },
];

const aiExamples = [
  { input: '"Freitag Meeting mit Team um 14:00, hohe Priorität"', title: 'Meeting mit Team', date: 'Freitag', time: '14:00', cat: 'Arbeit', prio: 'Hoch' },
  { input: '"Morgen Einkaufen um 17:30"', title: 'Einkaufen', date: 'Morgen', time: '17:30', cat: 'Privat', prio: 'Niedrig' },
  { input: '"Montag Sportstudio 19 Uhr, mittel"', title: 'Sportstudio', date: 'Montag', time: '19:00', cat: 'Sport', prio: 'Mittel' },
];

const fadeUp = {
  hidden: { opacity: 0, y: 22 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.07, duration: 0.42, ease: [0.25, 0.46, 0.45, 0.94] } }),
};

export default function LandingPage() {
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerName, setRegisterName] = useState('');
  const [loginError, setLoginError] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [aiIdx, setAiIdx] = useState(0);
  const { login, register, loading } = useAuthStore();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const ok = await login(loginEmail, loginPassword);
      if (ok) navigate('/');
    } catch (err) {
      setLoginError(err.message || 'Login fehlgeschlagen');
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setRegisterError('');
    try {
      const ok = await register(registerEmail, registerPassword, registerName);
      if (ok) navigate('/');
    } catch (err) {
      setRegisterError(err.message || 'Registrierung fehlgeschlagen');
    }
  };

  const ai = aiExamples[aiIdx];

  return (
    <div className="lp">

      {/* ── NAV ─────────────────────────────────────────── */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <Link to="/landing" className="lp-brand">
            <CheckSquare size={22} strokeWidth={2.5} />
            <span>BeeQu</span>
          </Link>

          <div className="lp-nav-links">
            <a href="#features">Features</a>
            <a href="#ai">KI-Eingabe</a>
            <a href="#pricing">Preise</a>
          </div>

          <div className="lp-nav-actions">
            <button onClick={() => setShowLogin(true)} className="lp-btn lp-btn-ghost">Anmelden</button>
            <button onClick={() => setShowRegister(true)} className="lp-btn lp-btn-solid">Kostenlos starten</button>
          </div>
        </div>
      </nav>

      <main>

        {/* ── HERO ────────────────────────────────────────── */}
        <section className="lp-hero">
          <div className="lp-hero-bg" aria-hidden />

          <div className="lp-wide">
            <div className="lp-hero-grid">

              {/* Left copy */}
              <motion.div
                className="lp-hero-copy"
                initial="hidden"
                animate="visible"
                variants={{ visible: { transition: { staggerChildren: 0.09 } } }}
              >
                <motion.div className="lp-chip" variants={fadeUp}>
                  <Layers3 size={14} />
                  Tasks · Kalender · Gruppen in einer App
                </motion.div>

                <motion.h1 className="lp-hero-title" variants={fadeUp}>
                  Smarter planen.<br />
                  <span className="lp-gradient">Mehr erledigen.</span>
                </motion.h1>

                <motion.p className="lp-hero-desc" variants={fadeUp}>
                  BeeQu vereint Aufgabenverwaltung, Kalender und Teamarbeit in einer schlanken App — mit KI die deinen Text versteht und Aufgaben automatisch anlegt.
                </motion.p>

                <motion.div className="lp-hero-actions" variants={fadeUp}>
                  <button onClick={() => setShowRegister(true)} className="lp-btn lp-btn-solid lp-btn-lg">
                    Kostenlos starten <ArrowRight size={18} />
                  </button>
                  <button onClick={() => setShowLogin(true)} className="lp-btn lp-btn-outline lp-btn-lg">
                    Zum Login
                  </button>
                </motion.div>

                <motion.div className="lp-hero-pills" variants={fadeUp}>
                  {[
                    { icon: Sparkles, text: 'KI-Texteingabe' },
                    { icon: CalendarDays, text: 'Intelligenter Kalender' },
                    { icon: Users, text: 'Gruppen-Chat' },
                    { icon: Smartphone, text: 'PWA — überall nutzbar' },
                  ].map(({ icon: Icon, text }) => (
                    <div key={text} className="lp-pill">
                      <Icon size={14} />
                      <span>{text}</span>
                    </div>
                  ))}
                </motion.div>

                <motion.div className="lp-hero-stats" variants={fadeUp}>
                  <div className="lp-stat-item">
                    <strong>3</strong>
                    <span>Module in einer App</span>
                  </div>
                  <div className="lp-stat-divider" />
                  <div className="lp-stat-item">
                    <strong>KI</strong>
                    <span>Natürliche Sprache</span>
                  </div>
                  <div className="lp-stat-divider" />
                  <div className="lp-stat-item">
                    <strong>0 €</strong>
                    <span>Kostenlos starten</span>
                  </div>
                </motion.div>
              </motion.div>

              {/* Right — real app mock */}
              <motion.div
                className="lp-hero-stage"
                initial={{ opacity: 0, scale: 0.97, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <div className="lp-stage-glow" aria-hidden />
                <div className="lp-app-shell">
                  {/* Window chrome */}
                  <div className="lp-app-chrome">
                    <span className="lp-chrome-dot lp-dot-r" />
                    <span className="lp-chrome-dot lp-dot-y" />
                    <span className="lp-chrome-dot lp-dot-g" />
                    <span className="lp-chrome-url">beequ.app — Dashboard</span>
                  </div>

                  {/* App layout */}
                  <div className="lp-app-body">
                    {/* Sidebar */}
                    <aside className="lp-app-sidebar">
                      <div className="lp-app-brand">
                        <CheckSquare size={18} color="#007AFF" strokeWidth={2.5} />
                        <span>BeeQu</span>
                      </div>
                      <nav className="lp-app-nav">
                        {[
                          { icon: '⊞', label: 'Dashboard', active: true },
                          { icon: '◷', label: 'Kalender' },
                          { icon: '✎', label: 'Notizen' },
                          { icon: '◈', label: 'Gruppen' },
                          { icon: '◉', label: 'Profil' },
                        ].map(({ icon, label, active }) => (
                          <div key={label} className={`lp-app-nav-item${active ? ' active' : ''}`}>
                            <span className="lp-nav-icon">{icon}</span>
                            <span>{label}</span>
                          </div>
                        ))}
                      </nav>
                      <div className="lp-app-plan-badge">
                        <span className="lp-plan-label">Pro Plan</span>
                        <span className="lp-plan-sub">200 KI/Monat</span>
                      </div>
                    </aside>

                    {/* Main content */}
                    <div className="lp-app-main">
                      {/* Topline */}
                      <div className="lp-app-topline">
                        <div>
                          <h2 className="lp-app-greeting">Guten Morgen 👋</h2>
                          <p className="lp-app-date">Montag, 27. April 2026</p>
                        </div>
                        <div className="lp-app-status-badge">Heute · 4 Aufgaben</div>
                      </div>

                      {/* AI Composer */}
                      <div className="lp-app-composer">
                        <div className="lp-composer-head">
                          <Sparkles size={14} color="#007AFF" />
                          <span>KI-Eingabe</span>
                        </div>
                        <div className="lp-composer-input">
                          "Team-Meeting Freitag 14:00, hohe Priorität"
                        </div>
                        <div className="lp-composer-tags">
                          <span className="lp-tag">📅 Freitag</span>
                          <span className="lp-tag">⏰ 14:00</span>
                          <span className="lp-tag">🔴 Hoch</span>
                          <span className="lp-tag">💼 Arbeit</span>
                        </div>
                      </div>

                      {/* Stats row */}
                      <div className="lp-app-stats">
                        {[
                          { num: '12', label: 'Heute offen' },
                          { num: '4', label: 'Überfällig' },
                          { num: '87%', label: 'Diese Woche' },
                        ].map(({ num, label }) => (
                          <div key={label} className="lp-app-stat">
                            <strong>{num}</strong>
                            <span>{label}</span>
                          </div>
                        ))}
                      </div>

                      {/* Task list */}
                      <div className="lp-app-tasks">
                        <div className="lp-task-section-head">
                          <div className="lp-task-section-left">
                            <div className="lp-section-icon warning">!</div>
                            <span>Heute</span>
                          </div>
                          <span className="lp-count-badge">4</span>
                        </div>

                        {[
                          { title: 'Design Review vorbereiten', cat: 'Design', prio: 'high', time: '09:00', done: true },
                          { title: 'Projektplan aktualisieren', cat: 'Arbeit', prio: 'medium', time: '11:30', done: false },
                          { title: 'Team-Meeting', cat: 'Meetings', prio: 'high', time: '14:00', done: false, repeat: true },
                          { title: 'Wochenbericht einreichen', cat: 'Arbeit', prio: 'low', time: '17:00', done: false },
                        ].map(({ title, cat, prio, time, done, repeat }) => (
                          <div key={title} className={`lp-app-task${done ? ' done' : ''}`}>
                            <div className={`lp-task-priority priority-${prio === 'high' ? 'high' : prio === 'medium' ? 'mid' : 'low'}`} />
                            <div className={`lp-task-check${done ? ' checked' : ''}`}>
                              {done ? <CheckCircle2 size={13} /> : <span />}
                            </div>
                            <div className="lp-task-body">
                              <strong className={done ? 'done-text' : ''}>{title}</strong>
                              <div className="lp-task-badges">
                                <span className="lp-mini-badge">{cat}</span>
                                {repeat && <span className="lp-mini-badge repeat"><Repeat size={9} />wiederkehrend</span>}
                                <span className="lp-mini-badge time">{time}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Right rail — calendar */}
                    <div className="lp-app-rail">
                      <div className="lp-rail-section">
                        <div className="lp-rail-head">April 2026</div>
                        <div className="lp-cal-labels">
                          {['Mo','Di','Mi','Do','Fr','Sa','So'].map(d => (
                            <span key={d} className="lp-cal-label">{d}</span>
                          ))}
                        </div>
                        <div className="lp-cal-grid">
                          {[null,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30].map((d, i) => (
                            <span key={i} className={`lp-cal-day${d === 27 ? ' today' : ''}${[2,8,15,22,25].includes(d) ? ' has-dot' : ''}${!d ? ' empty' : ''}`}>
                              {d || ''}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="lp-rail-section">
                        <div className="lp-rail-head">Gruppen</div>
                        {[
                          { name: 'Design Team', count: 3, color: '#5856D6' },
                          { name: 'Sprint Q2', count: 5, color: '#007AFF' },
                        ].map(({ name, count, color }) => (
                          <div key={name} className="lp-group-item">
                            <div className="lp-group-dot" style={{ background: color }} />
                            <span className="lp-group-name">{name}</span>
                            <span className="lp-group-count">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>

            </div>
          </div>
        </section>

        {/* ── STATS BAND ───────────────────────────────────── */}
        <section className="lp-band">
          <div className="lp-wide">
            <motion.div
              className="lp-band-inner"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-60px' }}
              variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
            >
              {[
                { icon: Zap, num: '3-in-1', label: 'Tasks, Kalender & Teams' },
                { icon: Brain, num: 'KI', label: 'Versteht natürliche Sprache' },
                { icon: Smartphone, num: 'PWA', label: 'Installierbar auf jedem Gerät' },
                { icon: Shield, num: '0 €', label: 'Kostenlos starten' },
                { icon: Star, num: '3 Pläne', label: 'Free · Pro · Team' },
              ].map(({ icon: Icon, num, label }, i) => (
                <motion.div key={label} className="lp-band-item" variants={fadeUp} custom={i}>
                  <div className="lp-band-icon"><Icon size={18} /></div>
                  <div className="lp-band-text">
                    <strong>{num}</strong>
                    <span>{label}</span>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* ── FEATURES ─────────────────────────────────────── */}
        <section className="lp-section" id="features">
          <div className="lp-wide">
            <motion.div
              className="lp-section-head"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-60px' }}
              variants={fadeUp}
            >
              <span className="lp-label">Funktionen</span>
              <h2>Alles was du brauchst,<br />in einem Ort.</h2>
              <p>Keine drei verschiedenen Apps mehr. BeeQu vereint Aufgabenverwaltung, Kalender und Teamkommunikation nahtlos.</p>
            </motion.div>

            <div className="lp-feat-grid">
              {features.map(({ icon: Icon, color, bg, label, title, desc, plan }, i) => (
                <motion.div
                  key={title}
                  className="lp-feat-card"
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: '-40px' }}
                  custom={i % 4}
                  variants={fadeUp}
                >
                  <div className="lp-feat-icon" style={{ color, background: bg }}>
                    <Icon size={20} />
                  </div>
                  <div className="lp-feat-plan" style={{ color, background: bg }}>{plan}</div>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── AI SPOTLIGHT ─────────────────────────────────── */}
        <section className="lp-section lp-section-tinted" id="ai">
          <div className="lp-wide">
            <div className="lp-ai-split">

              {/* Left — demo card */}
              <motion.div
                className="lp-ai-demo"
                initial={{ opacity: 0, x: -24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.5 }}
              >
                <div className="lp-ai-card">
                  <div className="lp-ai-card-head">
                    <Sparkles size={16} color="#007AFF" />
                    <span>KI verarbeitet deine Eingabe</span>
                  </div>

                  {/* Input examples */}
                  <div className="lp-ai-examples">
                    {aiExamples.map((ex, i) => (
                      <button
                        key={i}
                        className={`lp-ai-example${i === aiIdx ? ' active' : ''}`}
                        onClick={() => setAiIdx(i)}
                      >
                        {ex.input}
                      </button>
                    ))}
                  </div>

                  {/* Result */}
                  <motion.div
                    key={aiIdx}
                    className="lp-ai-result"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className="lp-ai-result-label">
                      <CheckCircle2 size={14} color="#34C759" />
                      Aufgabe erstellt
                    </div>
                    <div className="lp-ai-result-grid">
                      <div className="lp-ai-field">
                        <span>Titel</span>
                        <strong>{ai.title}</strong>
                      </div>
                      <div className="lp-ai-field">
                        <span>Datum</span>
                        <strong>{ai.date}</strong>
                      </div>
                      <div className="lp-ai-field">
                        <span>Uhrzeit</span>
                        <strong>{ai.time}</strong>
                      </div>
                      <div className="lp-ai-field">
                        <span>Kategorie</span>
                        <strong>{ai.cat}</strong>
                      </div>
                      <div className="lp-ai-field">
                        <span>Priorität</span>
                        <strong>{ai.prio}</strong>
                      </div>
                    </div>
                  </motion.div>

                  <div className="lp-ai-langs">
                    <span>🌍</span>
                    <span>Funktioniert auf Deutsch und Englisch</span>
                  </div>
                </div>
              </motion.div>

              {/* Right — copy */}
              <motion.div
                className="lp-ai-copy"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-60px' }}
                variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
              >
                <motion.span className="lp-label" variants={fadeUp}>KI-Assistent</motion.span>
                <motion.h2 variants={fadeUp}>
                  Aufgaben anlegen,<br />
                  <span className="lp-gradient">so einfach wie tippen.</span>
                </motion.h2>
                <motion.p className="lp-ai-desc" variants={fadeUp}>
                  Vergiss komplizierte Formulare. Schreib was du vorhast — BeeQu's KI erkennt automatisch Datum, Uhrzeit, Kategorie und Priorität und erstellt die fertige Aufgabe.
                </motion.p>

                <motion.div className="lp-ai-points" variants={fadeUp}>
                  {[
                    { icon: CalendarDays, text: '"morgen", "nächsten Montag", "um 14 Uhr" wird richtig erkannt.' },
                    { icon: Layers3, text: 'Kategorien & Prioritäten werden automatisch zugewiesen.' },
                    { icon: Zap, text: 'Kein Klicken durch Formulare — ein Satz und fertig.' },
                  ].map(({ icon: Icon, text }) => (
                    <div key={text} className="lp-ai-point">
                      <div className="lp-ai-point-icon"><Icon size={16} /></div>
                      <span>{text}</span>
                    </div>
                  ))}
                </motion.div>

                <motion.div variants={fadeUp}>
                  <button onClick={() => setShowRegister(true)} className="lp-btn lp-btn-solid lp-btn-lg">
                    KI kostenlos testen <ArrowRight size={18} />
                  </button>
                </motion.div>
              </motion.div>

            </div>
          </div>
        </section>

        {/* ── APP SCREENS ──────────────────────────────────── */}
        <section className="lp-section" id="screens">
          <div className="lp-wide">
            <motion.div
              className="lp-section-head"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-60px' }}
              variants={fadeUp}
            >
              <span className="lp-label">App-Ansichten</span>
              <h2>Jede Ansicht für<br />ihren Zweck gebaut.</h2>
              <p>Dashboard, Kalender, Gruppen-Chat und Profil — jeder Bereich hat genau die Tiefe die er braucht.</p>
            </motion.div>

            <div className="lp-screens-grid">

              {/* Calendar preview */}
              <motion.div
                className="lp-screen-card"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-40px' }}
                variants={fadeUp}
                custom={0}
              >
                <div className="lp-screen-label">
                  <CalendarDays size={14} />
                  Kalender
                </div>
                <div className="lp-screen-inner lp-cal-preview">
                  <div className="lp-cal-header">
                    <strong>April 2026</strong>
                    <div className="lp-cal-btns">
                      <span>‹</span>
                      <span>›</span>
                    </div>
                  </div>
                  <div className="lp-cal-labels-full">
                    {['Mo','Di','Mi','Do','Fr','Sa','So'].map(d => <span key={d}>{d}</span>)}
                  </div>
                  <div className="lp-cal-full-grid">
                    {[null,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,null,null,null].map((d, i) => (
                      <span key={i} className={`lp-cal-full-day${d === 27 ? ' today' : ''}${[4,8,15,22,25].includes(d) ? ' dot' : ''}${!d ? ' empty' : ''}`}>
                        {d || ''}
                      </span>
                    ))}
                  </div>
                  <div className="lp-upcoming">
                    <div className="lp-upcoming-head">Heute</div>
                    {[
                      { title: 'Team-Meeting', time: '14:00', color: '#007AFF' },
                      { title: 'Design Review', time: '16:30', color: '#5856D6' },
                    ].map(({ title, time, color }) => (
                      <div key={title} className="lp-upcoming-item">
                        <div className="lp-upcoming-dot" style={{ background: color }} />
                        <span>{title}</span>
                        <span className="lp-upcoming-time">{time}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>

              {/* Group chat preview */}
              <motion.div
                className="lp-screen-card lp-screen-wide"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-40px' }}
                variants={fadeUp}
                custom={1}
              >
                <div className="lp-screen-label">
                  <UsersRound size={14} />
                  Gruppen & Chat
                </div>
                <div className="lp-screen-inner lp-chat-preview">
                  <div className="lp-chat-sidebar">
                    <div className="lp-chat-group active">
                      <div className="lp-chat-avatar" style={{ background: 'rgba(88,86,214,0.15)', color: '#5856D6' }}>DT</div>
                      <div>
                        <strong>Design Team</strong>
                        <span>3 Mitglieder · 12 Tasks</span>
                      </div>
                    </div>
                    <div className="lp-chat-group">
                      <div className="lp-chat-avatar" style={{ background: 'rgba(0,122,255,0.12)', color: '#007AFF' }}>S2</div>
                      <div>
                        <strong>Sprint Q2</strong>
                        <span>5 Mitglieder · 28 Tasks</span>
                      </div>
                    </div>
                  </div>
                  <div className="lp-chat-main">
                    <div className="lp-chat-topbar">
                      <strong>Design Team</strong>
                      <span>3 online</span>
                    </div>
                    <div className="lp-chat-msgs">
                      <div className="lp-chat-msg">
                        <div className="lp-chat-av av-purple">A</div>
                        <div className="lp-chat-bubble">Tasks für Sprint 3 sind aktualisiert! Bitte prüfen.</div>
                      </div>
                      <div className="lp-chat-msg sent">
                        <div className="lp-chat-bubble sent">Schaue ich mir gleich an 👍</div>
                        <div className="lp-chat-av av-blue">M</div>
                      </div>
                      <div className="lp-chat-msg">
                        <div className="lp-chat-av av-green">L</div>
                        <div className="lp-chat-bubble">Design_V3.pdf hochgeladen 📎</div>
                      </div>
                    </div>
                  </div>
                  <div className="lp-chat-members">
                    <div className="lp-members-head">Mitglieder</div>
                    {[
                      { init: 'AK', name: 'Anna K.', role: 'Owner', online: true },
                      { init: 'MS', name: 'Max S.', role: 'Admin', online: true },
                      { init: 'LM', name: 'Lisa M.', role: 'Member', online: false },
                    ].map(({ init, name, role, online }) => (
                      <div key={name} className="lp-member-row">
                        <div className="lp-member-av">{init}</div>
                        <div className="lp-member-info">
                          <strong>{name}</strong>
                          <span>{role}</span>
                        </div>
                        <div className={`lp-online-dot${online ? ' online' : ''}`} />
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>

              {/* Profile & Stats */}
              <motion.div
                className="lp-screen-card"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-40px' }}
                variants={fadeUp}
                custom={2}
              >
                <div className="lp-screen-label">
                  <BarChart2 size={14} />
                  Profil & Statistiken
                </div>
                <div className="lp-screen-inner lp-profile-preview">
                  <div className="lp-profile-header">
                    <div className="lp-profile-avatar">MK</div>
                    <div>
                      <strong>Max Kellner</strong>
                      <span>Pro-Plan · seit April 2025</span>
                    </div>
                  </div>
                  <div className="lp-profile-stats">
                    {[
                      { num: '142', label: 'erledigt' },
                      { num: '94%', label: 'Quote' },
                      { num: '12', label: 'Serien' },
                    ].map(({ num, label }) => (
                      <div key={label} className="lp-profile-stat">
                        <strong>{num}</strong>
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="lp-profile-chart">
                    {[60, 80, 45, 95, 70, 85, 100].map((h, i) => (
                      <div key={i} className="lp-bar-wrap">
                        <div className="lp-bar" style={{ height: `${h}%` }} />
                      </div>
                    ))}
                  </div>
                  <div className="lp-profile-chart-labels">
                    {['Mo','Di','Mi','Do','Fr','Sa','So'].map(d => <span key={d}>{d}</span>)}
                  </div>
                </div>
              </motion.div>

            </div>
          </div>
        </section>

        {/* ── PRICING ──────────────────────────────────────── */}
        <section className="lp-section lp-section-tinted" id="pricing">
          <div className="lp-wide">
            <motion.div
              className="lp-section-head"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-60px' }}
              variants={fadeUp}
            >
              <span className="lp-label">Preise</span>
              <h2>Einfach und<br />transparent.</h2>
              <p>Starte kostenlos. Upgrade wenn du mehr brauchst — jederzeit kündbar, keine versteckten Kosten.</p>
            </motion.div>

            <div className="lp-pricing-grid">
              {orderedPlans.map((plan, i) => (
                <motion.div
                  key={plan.id}
                  className={`lp-price-card${plan.id === 'pro' ? ' lp-price-featured' : ''}`}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: '-40px' }}
                  custom={i}
                  variants={fadeUp}
                >
                  {plan.id === 'pro' && <div className="lp-price-badge">⭐ Beliebteste Wahl</div>}
                  <div className="lp-price-head">
                    <span className="lp-label" style={{ color: planAccents[plan.id] }}>{plan.label}</span>
                    <h3 className="lp-price-amount">{plan.priceLabel}</h3>
                  </div>
                  <div className="lp-price-divider" />
                  <ul className="lp-price-features">
                    {getPlanBullets(plan).map((b) => (
                      <li key={b}>
                        <CheckCircle2 size={15} />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => setShowRegister(true)}
                    className={`lp-btn lp-btn-lg full-width ${plan.id === 'pro' ? 'lp-btn-solid' : 'lp-btn-outline'}`}
                  >
                    {plan.id === 'free' ? 'Kostenlos starten' : 'Mit Konto freischalten'}
                  </button>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────── */}
        <section className="lp-section" id="cta">
          <div className="lp-wide">
            <motion.div
              className="lp-cta-panel"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-60px' }}
              variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
            >
              <div className="lp-cta-copy">
                <motion.span className="lp-label" variants={fadeUp}>Nächster Schritt</motion.span>
                <motion.h2 variants={fadeUp}>Bereit produktiver<br />zu werden?</motion.h2>
                <motion.p variants={fadeUp}>
                  Starte mit Free und schalte Pro oder Team erst frei, wenn du die Funktionen wirklich brauchst. Keine Kreditkarte nötig.
                </motion.p>
                <motion.div className="lp-cta-actions" variants={fadeUp}>
                  <button onClick={() => setShowRegister(true)} className="lp-btn lp-btn-solid lp-btn-lg">
                    Konto erstellen <ArrowRight size={18} />
                  </button>
                  <button onClick={() => setShowLogin(true)} className="lp-btn lp-btn-outline lp-btn-lg">
                    Vorhandenes Konto öffnen
                  </button>
                </motion.div>
              </div>
              <div className="lp-cta-visual" aria-hidden>
                <div className="lp-cta-card">
                  <div className="lp-cta-card-icon"><Sparkles size={28} color="#007AFF" /></div>
                  <strong>KI-Eingabe</strong>
                  <span>200 Abfragen/Monat</span>
                </div>
                <div className="lp-cta-card">
                  <div className="lp-cta-card-icon"><UsersRound size={28} color="#5856D6" /></div>
                  <strong>3 Gruppen</strong>
                  <span>inkl. Echtzeit-Chat</span>
                </div>
                <div className="lp-cta-card">
                  <div className="lp-cta-card-icon"><Repeat size={28} color="#FF9500" /></div>
                  <strong>Wiederholungen</strong>
                  <span>täglich bis monatlich</span>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

      </main>

      {/* ── FOOTER ───────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-wide lp-footer-inner">
          <div className="lp-brand">
            <CheckSquare size={18} strokeWidth={2.5} />
            <span>BeeQu</span>
          </div>
          <p>Task-Management, Kalender und Zusammenarbeit in einer App.</p>
          <div className="lp-footer-links">
            <a href="#features">Features</a>
            <a href="#pricing">Preise</a>
          </div>
        </div>
      </footer>

      {/* ── LOGIN MODAL ──────────────────────────────────── */}
      <AnimatePresence>
        {showLogin && (
          <motion.div className="landing-modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowLogin(false)}>
            <motion.div className="landing-modal" initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} onClick={e => e.stopPropagation()}>
              <button className="landing-modal-close" onClick={() => setShowLogin(false)}><X size={20} /></button>
              <div className="landing-modal-header"><CheckSquare size={28} /><h2>Anmelden</h2></div>
              {loginError && <div className="landing-modal-error"><AlertCircle size={16} />{loginError}</div>}
              <form onSubmit={handleLogin} className="landing-modal-form">
                <div className="landing-form-field">
                  <label>E-Mail</label>
                  <div className="landing-form-input-wrapper">
                    <Mail size={18} />
                    <input type="email" placeholder="du@example.com" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required />
                  </div>
                </div>
                <div className="landing-form-field">
                  <label>Passwort</label>
                  <div className="landing-form-input-wrapper">
                    <Key size={18} />
                    <input type="password" placeholder="••••••••" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} required />
                  </div>
                </div>
                <button type="submit" disabled={loading} className="landing-btn landing-btn-solid full-width">
                  {loading ? 'Wird angemeldet...' : 'Anmelden'}
                </button>
              </form>
              <div className="landing-modal-footer">
                <p>Noch kein Konto?<button onClick={() => { setShowLogin(false); setShowRegister(true); }} className="landing-link">Registrieren</button></p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── REGISTER MODAL ───────────────────────────────── */}
      <AnimatePresence>
        {showRegister && (
          <motion.div className="landing-modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowRegister(false)}>
            <motion.div className="landing-modal" initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} onClick={e => e.stopPropagation()}>
              <button className="landing-modal-close" onClick={() => setShowRegister(false)}><X size={20} /></button>
              <div className="landing-modal-header"><CheckSquare size={28} /><h2>Kostenlos registrieren</h2></div>
              {registerError && <div className="landing-modal-error"><AlertCircle size={16} />{registerError}</div>}
              <form onSubmit={handleRegister} className="landing-modal-form">
                <div className="landing-form-field">
                  <label>Name</label>
                  <input type="text" placeholder="Max Mustermann" value={registerName} onChange={e => setRegisterName(e.target.value)} required />
                </div>
                <div className="landing-form-field">
                  <label>E-Mail</label>
                  <div className="landing-form-input-wrapper">
                    <Mail size={18} />
                    <input type="email" placeholder="du@example.com" value={registerEmail} onChange={e => setRegisterEmail(e.target.value)} required />
                  </div>
                </div>
                <div className="landing-form-field">
                  <label>Passwort</label>
                  <div className="landing-form-input-wrapper">
                    <Key size={18} />
                    <input type="password" placeholder="••••••••" value={registerPassword} onChange={e => setRegisterPassword(e.target.value)} required />
                  </div>
                </div>
                <button type="submit" disabled={loading} className="landing-btn landing-btn-solid full-width">
                  {loading ? 'Wird registriert...' : 'Kostenlos registrieren'}
                </button>
              </form>
              <div className="landing-modal-footer">
                <p>Bereits registriert?<button onClick={() => { setShowRegister(false); setShowLogin(true); }} className="landing-link">Anmelden</button></p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

