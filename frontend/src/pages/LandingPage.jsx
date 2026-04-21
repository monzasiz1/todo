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
} from 'lucide-react';
import { PLANS } from '../lib/plans';
import { useAuthStore } from '../store/authStore';
import dashboardScreenshot from '../assets/app-dashboard-screenshot.png';

const heroPoints = [
  'Dashboard mit KI-Eingabe und Zeitbezug',
  'Kalender für Aufgaben und Termine',
  'Gruppen, Profil und Planverwaltung in einer App',
];

const workflow = [
  {
    title: 'Erfassen',
    description: 'Aufgaben manuell anlegen oder im Pro- und Team-Plan per KI-Eingabe strukturieren lassen.',
  },
  {
    title: 'Planen',
    description: 'Dashboard, Kalender und Wiederholungen bringen Aufgaben, Termine und Zeitfenster in eine Linie.',
  },
  {
    title: 'Zusammenarbeiten',
    description: 'Gruppen, Anhänge und sichtbare Profile sorgen dafür, dass kleine Teams an einem Ort bleiben.',
  },
];

const modules = [
  {
    icon: Brain,
    title: 'Dashboard mit KI-Eingabe',
    description: 'Der Einstieg der App bündelt Today-Ansicht, Insights und die natürliche Eingabe für neue Aufgaben.',
    plan: 'Pro/Team',
    accent: '#007AFF',
  },
  {
    icon: CalendarDays,
    title: 'Kalender für Aufgaben und Termine',
    description: 'Die Kalenderseite zeigt Aufgaben im Datumsbereich und erlaubt das Erstellen direkt pro Tag.',
    plan: 'Alle Pläne',
    accent: '#5E5CE6',
  },
  {
    icon: Repeat,
    title: 'Wiederkehrende Aufgaben',
    description: 'Wiederholungen sind im Pro- und Team-Kontext integriert und bleiben im Kalender sichtbar.',
    plan: 'Pro/Team',
    accent: '#FF9500',
  },
  {
    icon: UsersRound,
    title: 'Gruppen für Zusammenarbeit',
    description: 'Gruppen lassen sich erstellen oder per Code beitreten. Rollen und Mitgliedschaft sind in der Oberfläche sichtbar.',
    plan: 'Pro/Team',
    accent: '#34C759',
  },
  {
    icon: Eye,
    title: 'Profil, Sichtbarkeit und Export',
    description: 'Avatar, Bio, Sichtbarkeit, Kennzahlen und Datenexport liegen gesammelt im Profilbereich.',
    plan: 'Alle Pläne',
    accent: '#1C1C1E',
  },
];

const planGateCards = [
  {
    icon: Sparkles,
    title: 'KI-Eingabe',
    statuses: ['Free: nicht enthalten', 'Pro: 200 Abfragen/Monat', 'Team: 1000 Abfragen/Monat'],
  },
  {
    icon: UsersRound,
    title: 'Gruppen',
    statuses: ['Free: gesperrt', 'Pro: bis zu 3 Gruppen', 'Team: unbegrenzt'],
  },
  {
    icon: Paperclip,
    title: 'Anhänge',
    statuses: ['Free: gesperrt', 'Pro: enthalten', 'Team: enthalten'],
  },
];

const planAccents = {
  free: '#8E8E93',
  pro: '#007AFF',
  team: '#5856D6',
};

const orderedPlans = ['free', 'pro', 'team'].map((planId) => PLANS[planId]);

function getPlanBullets(plan) {
  if (plan.id === 'free') {
    return [
      `Bis zu ${plan.limits.tasks} Aufgaben`,
      `Bis zu ${plan.limits.categories} Kategorien`,
      'Dashboard, Kalender und Profil inklusive',
      'KI, Gruppen und Anhänge erst ab Pro',
    ];
  }

  if (plan.id === 'pro') {
    return [
      'Unbegrenzte Aufgaben und Kategorien',
      `${plan.limits.aiCalls} KI-Abfragen pro Monat`,
      `Bis zu ${plan.limits.groups} Gruppen`,
      'Wiederholungen, Anhänge und Statistiken inklusive',
    ];
  }

  return [
    'Alles aus Pro',
    `${plan.limits.aiCalls} KI-Abfragen pro Monat`,
    'Unbegrenzte Gruppen',
    'Prioritäts-Support für Teams',
  ];
}

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
    hidden: { opacity: 0, y: 18 },
    visible: (index = 0) => ({
      opacity: 1,
      y: 0,
      transition: { delay: index * 0.08, duration: 0.45 },
    }),
  };

  return (
    <div className="landing-wrapper">
      <nav className="landing-nav">
        <div className="landing-nav-container">
          <Link to="/landing" className="landing-brand">
            <CheckSquare size={22} />
            <span>Taski</span>
          </Link>

          <div className="landing-nav-links">
            <a href="#product">Produkt</a>
            <a href="#pricing">Preise</a>
            <a href="#cta">Starten</a>
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
              Konto erstellen
            </button>
          </div>
        </div>
      </nav>

      <main className="landing-main">
        <section className="landing-hero" id="overview">
          <div className="landing-container landing-hero-grid">
            <motion.div
              className="landing-hero-copy"
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
            >
              <motion.div className="landing-chip" variants={fadeIn}>
                <Layers3 size={15} />
                Für Einzelpersonen und kleine Teams
              </motion.div>

              <motion.h1 className="landing-hero-title" variants={fadeIn}>
                Aufgaben, Kalender und Gruppen in einer Oberfläche, die nach App aussieht und sich auch so anfühlt.
              </motion.h1>

              <motion.p className="landing-hero-desc" variants={fadeIn}>
                Taski ist eine produktive Web-App für Planung und einfache Zusammenarbeit. Die Landing Page zeigt genau die Bereiche, die in der Anwendung vorhanden sind: Dashboard, Kalender, Gruppen, Profil und das reale Planmodell.
              </motion.p>

              <motion.div className="landing-hero-actions" variants={fadeIn}>
                <button
                  onClick={() => setShowRegisterModal(true)}
                  className="landing-btn landing-btn-solid landing-btn-lg"
                >
                  Kostenlos starten <ArrowRight size={18} />
                </button>
                <button
                  onClick={() => setShowLoginModal(true)}
                  className="landing-btn landing-btn-outline landing-btn-lg"
                >
                  Zum Login
                </button>
              </motion.div>

              <motion.div className="landing-hero-points" variants={fadeIn}>
                {heroPoints.map((point) => (
                  <div key={point} className="landing-point">
                    <CheckCircle2 size={18} />
                    <span>{point}</span>
                  </div>
                ))}
              </motion.div>

              <motion.div className="landing-hero-meta" variants={fadeIn}>
                <div className="landing-meta-card">
                  <span className="landing-meta-label">Ansicht</span>
                  <strong>Dashboard, Kalender, Gruppen</strong>
                </div>
                <div className="landing-meta-card">
                  <span className="landing-meta-label">Planlogik</span>
                  <strong>Free, Pro, Team</strong>
                </div>
                <div className="landing-meta-card">
                  <span className="landing-meta-label">Bezahlte Features</span>
                  <strong>KI, Gruppen, Anhänge</strong>
                </div>
              </motion.div>
            </motion.div>

            <motion.div
              className="landing-stage"
              initial={{ opacity: 0, scale: 0.98, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.12 }}
            >
              <div className="landing-shot-frame">
                <img
                  src={dashboardScreenshot}
                  alt="Echter Taski Dashboard Screenshot"
                  className="landing-shot-image"
                  loading="lazy"
                />
              </div>
            </motion.div>
          </div>
        </section>

        <section className="landing-section" id="product">
          <div className="landing-container">
            <div className="landing-section-head">
              <span className="landing-section-label">Produktfluss</span>
              <h2>Vom Erfassen bis zur Zusammenarbeit bleibt die Oberfläche konsistent.</h2>
              <p>
                Die Seite konzentriert sich auf die Bereiche, die in der Anwendung wirklich existieren, statt zusätzliche Marketing-Ebenen zu erfinden.
              </p>
            </div>

            <div className="landing-story-grid">
              {workflow.map((step, index) => (
                <motion.article
                  key={step.title}
                  className="landing-story-card"
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: '-80px' }}
                  custom={index}
                  variants={fadeIn}
                >
                  <span className="landing-story-number">0{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </motion.article>
              ))}
            </div>

            <div className="landing-module-grid">
              {modules.map((module, index) => {
                const Icon = module.icon;
                return (
                  <motion.article
                    key={module.title}
                    className="landing-module-card"
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-80px' }}
                    custom={index}
                    variants={fadeIn}
                  >
                    <div className="landing-module-top">
                      <div className="landing-module-icon" style={{ color: module.accent, background: `${module.accent}12` }}>
                        <Icon size={20} />
                      </div>
                      <span className="landing-module-plan">{module.plan}</span>
                    </div>
                    <h3>{module.title}</h3>
                    <p>{module.description}</p>
                  </motion.article>
                );
              })}
            </div>

            <div className="landing-gates">
              {planGateCards.map((gate, index) => {
                const Icon = gate.icon;
                return (
                  <motion.article
                    key={gate.title}
                    className="landing-gate-card"
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-80px' }}
                    custom={index}
                    variants={fadeIn}
                  >
                    <div className="landing-stage-card-head">
                      <Icon size={16} />
                      <span>{gate.title}</span>
                    </div>
                    <div className="landing-gate-statuses">
                      {gate.statuses.map((status) => (
                        <span key={status} className="landing-gate-status">{status}</span>
                      ))}
                    </div>
                  </motion.article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="landing-section landing-pricing" id="pricing">
          <div className="landing-container">
            <div className="landing-section-head">
              <span className="landing-section-label">Preise</span>
              <h2>Die Preisdarstellung folgt direkt dem vorhandenen Planmodell der App.</h2>
              <p>
                Free bleibt der Einstieg. Pro und Team schalten KI, Gruppen, Wiederholungen, Anhänge und weitere Grenzen des Produkts frei.
              </p>
            </div>

            <div className="landing-pricing-grid">
              {orderedPlans.map((plan, index) => (
                <motion.article
                  key={plan.id}
                  className={`landing-pricing-card ${plan.id === 'pro' ? 'highlight' : ''}`}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: '-80px' }}
                  custom={index}
                  variants={fadeIn}
                >
                  {plan.id === 'pro' && <div className="landing-pricing-badge">Empfohlen</div>}
                  <div className="landing-pricing-head">
                    <span className="landing-section-label" style={{ color: planAccents[plan.id] }}>{plan.label}</span>
                    <h3>{plan.priceLabel}</h3>
                  </div>
                  <div className="landing-pricing-features">
                    {getPlanBullets(plan).map((bullet) => (
                      <div key={bullet} className="landing-pricing-feature">
                        <CheckCircle2 size={16} />
                        <span>{bullet}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowRegisterModal(true)}
                    className={`landing-btn ${plan.id === 'pro' ? 'landing-btn-solid' : 'landing-btn-outline'} full-width`}
                  >
                    {plan.id === 'free' ? 'Kostenlos starten' : 'Mit Konto freischalten'}
                  </button>
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-cta" id="cta">
          <div className="landing-container">
            <motion.div
              className="landing-cta-panel"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-80px' }}
              variants={fadeIn}
            >
              <div>
                <span className="landing-section-label">Nächster Schritt</span>
                <h2>Starte mit Free und schalte Pro oder Team erst frei, wenn du die Funktionen wirklich brauchst.</h2>
                <p>
                  Keine erfundenen Bundles, keine zweite Produktlinie. Nur die vorhandene App, sauber erklärt.
                </p>
              </div>
              <div className="landing-hero-actions">
                <button
                  onClick={() => setShowRegisterModal(true)}
                  className="landing-btn landing-btn-solid landing-btn-lg"
                >
                  Konto erstellen <ArrowRight size={18} />
                </button>
                <button
                  onClick={() => setShowLoginModal(true)}
                  className="landing-btn landing-btn-outline landing-btn-lg"
                >
                  Vorhandenes Konto öffnen
                </button>
              </div>
            </motion.div>
          </div>
        </section>
      </main>

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
                <p>
                  Noch kein Konto?
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
                <p>
                  Bereits registriert?
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

      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <div className="landing-brand">
            <CheckSquare size={18} />
            <span>Taski</span>
          </div>
          <p>Task-Management, Kalender und Zusammenarbeit in einer React-App.</p>
        </div>
      </footer>
    </div>
  );
}
