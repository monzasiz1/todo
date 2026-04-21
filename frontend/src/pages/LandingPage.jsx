import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  Brain,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  Clock3,
  Download,
  Eye,
  Flag,
  Globe,
  Layers3,
  Lock,
  Repeat,
  Shield,
  Sparkles,
  UserCheck,
  Users,
  UsersRound,
  X,
  Mail,
  Key,
  AlertCircle,
} from 'lucide-react';

const features = [
  {
    icon: Brain,
    title: 'KI-gestützte Eingabe',
    desc: 'Natürliche Sprache wird zu strukturierten Aufgaben: "Jeden Mittwoch Probe 19:00-21:00" → fertig!',
    color: '#8B5CF6',
  },
  {
    icon: CalendarDays,
    title: 'Intelligenter Kalender',
    desc: 'Aufgaben, Termine und Wiederholungen in einer Ansicht. Drag-to-reschedule ist intuitiv.',
    color: '#3B82F6',
  },
  {
    icon: Repeat,
    title: 'Wiederholungen',
    desc: 'Täglich, wöchentlich, monatlich bis zum Enddatum. Virtual Recurrence spart DB-Space.',
    color: '#F59E0B',
  },
  {
    icon: Users,
    title: 'Teilen & Rechte',
    desc: 'Privat, mit Freunden oder selektiv. Pro Person: Lese- & Schreibrechte control.',
    color: '#10B981',
  },
  {
    icon: UsersRound,
    title: 'Teamgruppen',
    desc: 'Gruppen mit Invite-Code, Rollen, Gruppenbild. Aufgaben kooperativ planen.',
    color: '#EC4899',
  },
  {
    icon: Eye,
    title: 'Profile & Avatare',
    desc: 'Konsistente Profile überall: Sidebar, Aufgaben, Gruppen, Freunde.',
    color: '#6B7280',
  },
  {
    icon: Clock3,
    title: 'Erinnerungen',
    desc: 'Push-Notifs zum richtigen Moment. Angepasst an deine Zeitzonen & Vorlieben.',
    color: '#EF4444',
  },
  {
    icon: Download,
    title: 'PWA Installation',
    desc: 'Wie eine native App: Offline-Support, Home-Screen-Icon, schneller Start.',
    color: '#F97316',
  },
];

const pricingPlans = [
  {
    name: 'Persönlich',
    price: 'Kostenlos',
    features: [
      'Unbegrenzte Aufgaben',
      'Kalender & Dashboard',
      'KI-Eingabe (5/Monat)',
      'Erinnerungen',
      'PWA App',
    ],
  },
  {
    name: 'Pro',
    price: '4,99€',
    period: '/Monat',
    highlight: true,
    features: [
      'Alles von Persönlich',
      'Unbegrenzte KI-Eingabe',
      'Teamgruppen (10)',
      'Erweiterte Freigaben',
      'Priorität-Support',
    ],
  },
  {
    name: 'Team',
    price: '9,99€',
    period: '/Monat',
    features: [
      'Alles von Pro',
      'Unbegrenzte Gruppen',
      'Admin-Dashboard',
      'Advanced Analytics',
      'SSO & API-Zugang',
    ],
  },
];

export default function LandingPage() {
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerName, setRegisterName] = useState('');
  const [loginError, setLoginError] = useState('');
  const [registerError, setRegisterError] = useState('');
  const { login, register, loading } = useAuthStore();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const success = await login(loginEmail, loginPassword);
      if (success) {
        navigate('/');
      }
    } catch (err) {
      setLoginError(err.message || 'Login fehlgeschlagen');
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setRegisterError('');
    try {
      const success = await register(registerEmail, registerPassword, registerName);
      if (success) {
        navigate('/');
      }
    } catch (err) {
      setRegisterError(err.message || 'Registrierung fehlgeschlagen');
    }
  };

  const fadeIn = {
    hidden: { opacity: 0, y: 20 },
    visible: (i = 0) => ({
      opacity: 1,
      y: 0,
      transition: { delay: i * 0.1, duration: 0.5 },
    }),
  };

  return (
    <div className="landing-wrapper">
      {/* ──────────────────── NAV ──────────────────── */}
      <nav className="landing-nav">
        <div className="landing-nav-container">
          <Link to="/landing" className="landing-brand">
            <CheckSquare size={24} />
            <span>Taski</span>
          </Link>
          <div className="landing-nav-links">
            <a href="#features">Features</a>
            <a href="#pricing">Preise</a>
            <a href="#cta">Kontakt</a>
          </div>
          <div className="landing-nav-actions">
            <button 
              onClick={() => setShowLoginModal(true)}
              className="landing-btn landing-btn-ghost"
            >
              Anmelden
            </button>
            <button 
              onClick={() => setShowRegisterModal(true)}
              className="landing-btn landing-btn-solid"
            >
              Kostenlos testen
            </button>
          </div>
        </div>
      </nav>

      <main className="landing-main">
        {/* ──────────────────── HERO ──────────────────── */}
        <section className="landing-hero">
          <div className="landing-hero-bg">
            <div className="landing-hero-glow landing-hero-glow-1" />
            <div className="landing-hero-glow landing-hero-glow-2" />
            <div className="landing-hero-glow landing-hero-glow-3" />
          </div>

          <div className="landing-container">
            <motion.div 
              className="landing-hero-content"
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.12 } } }}
            >
              <motion.div className="landing-chip" variants={fadeIn}>
                <Sparkles size={16} />
                Professionelle Task- und Terminplattform
              </motion.div>

              <motion.h1 className="landing-hero-title" variants={fadeIn}>
                Planung, die sich
                <span> anfühlt wie eine echte App</span>
              </motion.h1>

              <motion.p className="landing-hero-desc" variants={fadeIn}>
                Taski kombiniert KI-Eingabe, intelligente Wiederholungen, Teamkolaboration und
                einen schönen Kalender. Alles was du für produktive Planung brauchst — in einer App.
              </motion.p>

              <motion.div className="landing-hero-actions" variants={fadeIn}>
                <button 
                  onClick={() => setShowRegisterModal(true)}
                  className="landing-btn landing-btn-solid landing-btn-lg"
                >
                  Jetzt kostenlos testen <ArrowRight size={18} />
                </button>
                <button 
                  onClick={() => setShowLoginModal(true)}
                  className="landing-btn landing-btn-outline landing-btn-lg"
                >
                  Zum Login
                </button>
              </motion.div>

              <motion.div className="landing-hero-bullets" variants={fadeIn}>
                <div className="landing-bullet">
                  <CheckCircle2 size={18} />
                  <span>KI-Eingabe mit Live-Preview</span>
                </div>
                <div className="landing-bullet">
                  <CheckCircle2 size={18} />
                  <span>Wiederholungen & Kalender</span>
                </div>
                <div className="landing-bullet">
                  <CheckCircle2 size={18} />
                  <span>Teams & Gruppen</span>
                </div>
              </motion.div>
            </motion.div>

            <motion.div 
              className="landing-hero-visual"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <div className="landing-mock-window">
                <div className="landing-mock-header">
                  <span className="landing-mock-title">Taski App</span>
                  <div className="landing-mock-controls">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
                <div className="landing-mock-body">
                  <div className="landing-mock-sidebar">
                    <div className="landing-mock-item active">📅 Dashboard</div>
                    <div className="landing-mock-item">📆 Kalender</div>
                    <div className="landing-mock-item">👥 Gruppen</div>
                    <div className="landing-mock-item">⚙️ Einstellungen</div>
                  </div>
                  <div className="landing-mock-content">
                    <div className="landing-mock-card">
                      <div className="landing-mock-stat">
                        <strong>5</strong>
                        <span>Offene</span>
                      </div>
                      <div className="landing-mock-stat">
                        <strong>12</strong>
                        <span>Erledigt</span>
                      </div>
                      <div className="landing-mock-stat">
                        <strong>3</strong>
                        <span>Heute</span>
                      </div>
                    </div>
                    <div className="landing-mock-task">
                      <div className="landing-mock-task-item">Probe vorbereiten</div>
                      <div className="landing-mock-task-item">Mail an Team</div>
                      <div className="landing-mock-task-item">Code Review</div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ──────────────────── FEATURES ──────────────────── */}
        <section id="features" className="landing-section landing-features">
          <div className="landing-container">
            <div className="landing-section-head">
              <h2>Alles was du brauchst</h2>
              <p>Vom schnellen Erfassen bis zur Teamkoordination — Taski deckt es ab</p>
            </div>

            <div className="landing-feature-grid">
              {features.map((f, idx) => {
                const Icon = f.icon;
                return (
                  <motion.div
                    key={f.title}
                    className="landing-feature-card"
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-50px' }}
                    custom={idx}
                    variants={fadeIn}
                  >
                    <div className="landing-feature-icon" style={{ color: f.color }}>
                      <Icon size={28} />
                    </div>
                    <h3>{f.title}</h3>
                    <p>{f.desc}</p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ──────────────────── WORKFLOW ──────────────────── */}
        <section className="landing-section landing-workflow">
          <div className="landing-container">
            <div className="landing-section-head">
              <h2>Ein durchgehender Workflow</h2>
              <p>Von der Eingabe bis zur Zusammenarbeit</p>
            </div>

            <div className="landing-workflow-grid">
              <motion.div 
                className="landing-workflow-step"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                custom={0}
                variants={fadeIn}
              >
                <div className="landing-step-num">1</div>
                <h3>Eingabe</h3>
                <p>Per KI oder manuell — Taski versteht beide. Mit Datum, Zeit, Priorität und Gruppe.</p>
              </motion.div>

              <motion.div 
                className="landing-workflow-step"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                custom={1}
                variants={fadeIn}
              >
                <div className="landing-step-num">2</div>
                <h3>Planung</h3>
                <p>Wiederholungen, Erinnerungen, Freigaben und Gruppenarbeit sind strukturiert integriert.</p>
              </motion.div>

              <motion.div 
                className="landing-workflow-step"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                custom={2}
                variants={fadeIn}
              >
                <div className="landing-step-num">3</div>
                <h3>Umsetzung</h3>
                <p>Dashboard, Kalender und Listenansichten geben dir immer den besten Überblick.</p>
              </motion.div>

              <motion.div 
                className="landing-workflow-step"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                custom={3}
                variants={fadeIn}
              >
                <div className="landing-step-num">4</div>
                <h3>Zusammenarbeit</h3>
                <p>Teams und Gruppen arbeiten mit klaren Rollen und kontrollierten Rechten.</p>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ──────────────────── PRICING ──────────────────── */}
        <section id="pricing" className="landing-section landing-pricing">
          <div className="landing-container">
            <div className="landing-section-head">
              <h2>Einfache, faire Preise</h2>
              <p>Starte kostenlos, upgrade wenn du es brauchst</p>
            </div>

            <div className="landing-pricing-grid">
              {pricingPlans.map((plan, idx) => (
                <motion.div
                  key={plan.name}
                  className={`landing-pricing-card ${plan.highlight ? 'highlight' : ''}`}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  custom={idx}
                  variants={fadeIn}
                >
                  {plan.highlight && (
                    <div className="landing-pricing-badge">Beliebt</div>
                  )}
                  <h3>{plan.name}</h3>
                  <div className="landing-pricing-amount">
                    <span className="landing-pricing-price">{plan.price}</span>
                    {plan.period && <span className="landing-pricing-period">{plan.period}</span>}
                  </div>
                  <button 
                    onClick={() => setShowRegisterModal(true)}
                    className={`landing-btn ${plan.highlight ? 'landing-btn-solid' : 'landing-btn-outline'} full-width`}
                  >
                    Starten
                  </button>
                  <div className="landing-pricing-features">
                    {plan.features.map((feature) => (
                      <div key={feature} className="landing-pricing-feature">
                        <CheckCircle2 size={16} />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ──────────────────── CTA ──────────────────── */}
        <section id="cta" className="landing-section landing-cta">
          <div className="landing-container">
            <motion.div
              className="landing-cta-content"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
            >
              <h2>Bereit zu starten?</h2>
              <p>Keine Kreditkarte erforderlich. Kostenlos testen.</p>
              <button 
                onClick={() => setShowRegisterModal(true)}
                className="landing-btn landing-btn-solid landing-btn-lg"
              >
                Jetzt kostenlos registrieren <ArrowRight size={18} />
              </button>
            </motion.div>
          </div>
        </section>
      </main>

      {/* ──────────────────── LOGIN MODAL ──────────────────── */}
      <AnimatePresence>
        {showLoginModal && (
          <motion.div
            className="landing-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowLoginModal(false)}
          >
            <motion.div
              className="landing-modal"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button 
                className="landing-modal-close"
                onClick={() => setShowLoginModal(false)}
              >
                <X size={20} />
              </button>

              <div className="landing-modal-header">
                <CheckSquare size={28} />
                <h2>Anmelden</h2>
              </div>

              {loginError && (
                <div className="landing-modal-error">
                  <AlertCircle size={16} />
                  {loginError}
                </div>
              )}

              <form onSubmit={handleLogin} className="landing-modal-form">
                <div className="landing-form-field">
                  <label>E-Mail</label>
                  <div className="landing-form-input-wrapper">
                    <Mail size={18} />
                    <input
                      type="email"
                      placeholder="du@example.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="landing-form-field">
                  <label>Passwort</label>
                  <div className="landing-form-input-wrapper">
                    <Key size={18} />
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  disabled={loading}
                  className="landing-btn landing-btn-solid full-width"
                >
                  {loading ? 'Wird angemeldet...' : 'Anmelden'}
                </button>
              </form>

              <div className="landing-modal-footer">
                <p>Noch kein Konto? 
                  <button
                    onClick={() => {
                      setShowLoginModal(false);
                      setShowRegisterModal(true);
                    }}
                    className="landing-link"
                  >
                    Registrieren
                  </button>
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ──────────────────── REGISTER MODAL ──────────────────── */}
      <AnimatePresence>
        {showRegisterModal && (
          <motion.div
            className="landing-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowRegisterModal(false)}
          >
            <motion.div
              className="landing-modal"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button 
                className="landing-modal-close"
                onClick={() => setShowRegisterModal(false)}
              >
                <X size={20} />
              </button>

              <div className="landing-modal-header">
                <CheckSquare size={28} />
                <h2>Kostenlos registrieren</h2>
              </div>

              {registerError && (
                <div className="landing-modal-error">
                  <AlertCircle size={16} />
                  {registerError}
                </div>
              )}

              <form onSubmit={handleRegister} className="landing-modal-form">
                <div className="landing-form-field">
                  <label>Name</label>
                  <input
                    type="text"
                    placeholder="Max Mustermann"
                    value={registerName}
                    onChange={(e) => setRegisterName(e.target.value)}
                    required
                  />
                </div>

                <div className="landing-form-field">
                  <label>E-Mail</label>
                  <div className="landing-form-input-wrapper">
                    <Mail size={18} />
                    <input
                      type="email"
                      placeholder="du@example.com"
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="landing-form-field">
                  <label>Passwort</label>
                  <div className="landing-form-input-wrapper">
                    <Key size={18} />
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  disabled={loading}
                  className="landing-btn landing-btn-solid full-width"
                >
                  {loading ? 'Wird registriert...' : 'Kostenlos registrieren'}
                </button>
              </form>

              <div className="landing-modal-footer">
                <p>Bereits registriert? 
                  <button
                    onClick={() => {
                      setShowRegisterModal(false);
                      setShowLoginModal(true);
                    }}
                    className="landing-link"
                  >
                    Anmelden
                  </button>
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="lpx-footer">
        <div className="lpx-container lpx-footer-inner">
          <div className="lpx-brand">
            <span className="lpx-brand-icon"><CheckSquare size={18} /></span>
            <span className="lpx-brand-text">Taski</span>
          </div>
          <p>© 2026 Taski - KI-gestuetzte Aufgabenverwaltung mit Collaboration und Kalender.</p>
        </div>
      </footer>
    </div>
  );
}
