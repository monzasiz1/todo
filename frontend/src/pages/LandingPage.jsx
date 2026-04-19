import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  CheckSquare, Sparkles, Calendar, BarChart3, Bell, Shield,
  Zap, Globe, ArrowRight, Star, ChevronRight, Smartphone,
  Brain, ListTodo, Clock, Palette
} from 'lucide-react';

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }
  }),
};

const features = [
  {
    icon: <Brain size={28} />,
    title: 'KI-gesteuert',
    desc: 'Schreibe natürlich — die KI erkennt Datum, Uhrzeit, Kategorie und Priorität automatisch.',
    color: '#5856D6',
  },
  {
    icon: <Calendar size={28} />,
    title: 'Kalender-Ansicht',
    desc: 'Monats- und Wochenansicht mit farbigen Punkten für jeden Tag. Alles auf einen Blick.',
    color: '#FF9500',
  },
  {
    icon: <ListTodo size={28} />,
    title: 'Smart Dashboard',
    desc: 'Offene, erledigte, heutige und dringende Aufgaben — sortiert und filterbar.',
    color: '#007AFF',
  },
  {
    icon: <Sparkles size={28} />,
    title: 'Natürliche Eingabe',
    desc: '"Morgen um 14 Uhr Zahnarzt" — Taski versteht dich und erstellt den Eintrag sofort.',
    color: '#FF2D55',
  },
  {
    icon: <Bell size={28} />,
    title: 'Erinnerungen',
    desc: 'Verpasse nie wieder eine Deadline. Werde rechtzeitig an wichtige Aufgaben erinnert.',
    color: '#34C759',
  },
  {
    icon: <Palette size={28} />,
    title: 'Kategorien & Farben',
    desc: 'Arbeit, Persönlich, Gesundheit — organisiere alles mit Farben und Icons.',
    color: '#00C7BE',
  },
];

const stats = [
  { value: '10x', label: 'Schneller als tippen' },
  { value: '98%', label: 'KI-Genauigkeit' },
  { value: '∞', label: 'Aufgaben möglich' },
  { value: '0€', label: 'Kostenlos starten' },
];

const screenshots = [
  {
    title: 'Dashboard',
    desc: 'Alle Aufgaben auf einen Blick',
    gradient: 'linear-gradient(135deg, #007AFF 0%, #5856D6 100%)',
    icon: <BarChart3 size={48} />,
    mockItems: ['✅ Meeting vorbereiten', '⏰ Zahnarzt um 14:00', '📋 Einkaufsliste', '🔥 Präsentation fertig'],
  },
  {
    title: 'Kalender',
    desc: 'Monats- und Wochenansicht',
    gradient: 'linear-gradient(135deg, #FF9500 0%, #FF2D55 100%)',
    icon: <Calendar size={48} />,
    mockItems: ['Mo: Team-Meeting', 'Mi: Arzttermin', 'Fr: Date Night', 'So: Sport'],
  },
  {
    title: 'KI Eingabe',
    desc: 'Natürlich sprechen, KI versteht',
    gradient: 'linear-gradient(135deg, #5856D6 0%, #FF2D55 100%)',
    icon: <Sparkles size={48} />,
    mockItems: ['"Morgen Einkaufen gehen"', '→ Datum: 20.04.2026', '→ Kategorie: Einkaufen', '→ Priorität: Mittel'],
  },
];

export default function LandingPage() {
  return (
    <div className="landing">
      {/* Navbar */}
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-logo">
            <div className="landing-logo-icon">
              <CheckSquare size={22} />
            </div>
            <span className="landing-logo-text">Taski</span>
          </div>
          <div className="landing-nav-links">
            <a href="#features">Features</a>
            <a href="#screenshots">App</a>
            <a href="#pricing">Preise</a>
            <Link to="/login" className="landing-nav-btn outline">Anmelden</Link>
            <Link to="/register" className="landing-nav-btn primary">Kostenlos starten</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero-bg" />
        <motion.div
          className="landing-hero-content"
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.12 } } }}
        >
          <motion.div className="landing-hero-badge" variants={fadeUp}>
            <Sparkles size={14} /> Powered by Mistral AI
          </motion.div>
          <motion.h1 className="landing-hero-title" variants={fadeUp}>
            Deine Aufgaben.<br />
            <span className="gradient-text">KI-gesteuert.</span>
          </motion.h1>
          <motion.p className="landing-hero-subtitle" variants={fadeUp}>
            Schreibe einfach was du zu tun hast — Taski erkennt automatisch Datum,
            Uhrzeit, Kategorie und Priorität. Besser als Todoist. Smarter als Notion.
          </motion.p>
          <motion.div className="landing-hero-actions" variants={fadeUp}>
            <Link to="/register" className="landing-btn primary large">
              Kostenlos starten <ArrowRight size={20} />
            </Link>
            <a href="#features" className="landing-btn ghost large">
              Mehr erfahren <ChevronRight size={20} />
            </a>
          </motion.div>

          {/* Hero Demo */}
          <motion.div className="landing-hero-demo" variants={fadeUp}>
            <div className="demo-input-bar">
              <Sparkles size={18} className="demo-sparkle" />
              <span className="demo-input-text">Morgen um 15 Uhr Zahnarzt, hohe Priorität</span>
              <div className="demo-send-btn"><ArrowRight size={16} /></div>
            </div>
            <div className="demo-result">
              <div className="demo-result-row">
                <Calendar size={14} /> <span>Morgen, 20. April 2026</span>
              </div>
              <div className="demo-result-row">
                <Clock size={14} /> <span>15:00 Uhr</span>
              </div>
              <div className="demo-result-row">
                <Zap size={14} /> <span style={{ color: 'var(--warning)' }}>Hohe Priorität</span>
              </div>
              <div className="demo-result-row">
                <CheckSquare size={14} /> <span style={{ color: 'var(--success)' }}>✓ Aufgabe erstellt</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* Stats */}
      <section className="landing-stats">
        {stats.map((s, i) => (
          <motion.div
            key={i}
            className="landing-stat"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
          >
            <div className="landing-stat-value">{s.value}</div>
            <div className="landing-stat-label">{s.label}</div>
          </motion.div>
        ))}
      </section>

      {/* Features */}
      <section className="landing-features" id="features">
        <motion.div
          className="landing-section-header"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="landing-section-badge">Features</span>
          <h2>Alles was du brauchst</h2>
          <p>Taski kombiniert KI-Power mit einem wunderschönen Interface — für maximale Produktivität.</p>
        </motion.div>
        <div className="landing-features-grid">
          {features.map((f, i) => (
            <motion.div
              key={i}
              className="landing-feature-card"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
            >
              <div className="landing-feature-icon" style={{ background: `${f.color}14`, color: f.color }}>
                {f.icon}
              </div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Screenshots / App Preview */}
      <section className="landing-screenshots" id="screenshots">
        <motion.div
          className="landing-section-header"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="landing-section-badge">App Einblick</span>
          <h2>So sieht Taski aus</h2>
          <p>Minimalistisch, übersichtlich und schnell — wie eine native iOS App.</p>
        </motion.div>
        <div className="landing-screenshots-grid">
          {screenshots.map((s, i) => (
            <motion.div
              key={i}
              className="landing-screenshot-card"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
            >
              <div className="screenshot-phone" style={{ background: s.gradient }}>
                <div className="screenshot-phone-notch" />
                <div className="screenshot-phone-content">
                  <div className="screenshot-phone-icon">{s.icon}</div>
                  <div className="screenshot-phone-items">
                    {s.mockItems.map((item, j) => (
                      <div key={j} className="screenshot-phone-item">{item}</div>
                    ))}
                  </div>
                </div>
              </div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="landing-how">
        <motion.div
          className="landing-section-header"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="landing-section-badge">So funktioniert's</span>
          <h2>3 einfache Schritte</h2>
        </motion.div>
        <div className="landing-steps">
          {[
            { num: '1', title: 'Schreibe', desc: 'Tippe natürlich ein, was du zu tun hast.', icon: <Sparkles size={24} /> },
            { num: '2', title: 'KI analysiert', desc: 'Mistral AI erkennt Datum, Zeit, Kategorie und mehr.', icon: <Brain size={24} /> },
            { num: '3', title: 'Fertig!', desc: 'Dein Eintrag erscheint sofort im Dashboard und Kalender.', icon: <CheckSquare size={24} /> },
          ].map((step, i) => (
            <motion.div
              key={i}
              className="landing-step"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
            >
              <div className="landing-step-num">{step.num}</div>
              <div className="landing-step-icon">{step.icon}</div>
              <h3>{step.title}</h3>
              <p>{step.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="landing-pricing" id="pricing">
        <motion.div
          className="landing-section-header"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="landing-section-badge">Preise</span>
          <h2>Starte kostenlos</h2>
          <p>Keine Kreditkarte nötig. Upgrade jederzeit.</p>
        </motion.div>
        <div className="landing-pricing-cards">
          <motion.div
            className="landing-pricing-card"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h3>Free</h3>
            <div className="landing-price">0€<span>/Monat</span></div>
            <ul>
              <li><CheckSquare size={16} /> Unbegrenzte Aufgaben</li>
              <li><CheckSquare size={16} /> KI-Eingabe</li>
              <li><CheckSquare size={16} /> Kalender-Ansicht</li>
              <li><CheckSquare size={16} /> 8 Kategorien</li>
            </ul>
            <Link to="/register" className="landing-btn primary" style={{ width: '100%' }}>
              Kostenlos starten
            </Link>
          </motion.div>
          <motion.div
            className="landing-pricing-card featured"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
          >
            <div className="landing-pricing-badge">Beliebt</div>
            <h3>Pro</h3>
            <div className="landing-price">4,99€<span>/Monat</span></div>
            <ul>
              <li><CheckSquare size={16} /> Alles aus Free</li>
              <li><CheckSquare size={16} /> Wiederkehrende Aufgaben</li>
              <li><CheckSquare size={16} /> Erinnerungen</li>
              <li><CheckSquare size={16} /> Eigene Kategorien</li>
              <li><CheckSquare size={16} /> Priority Support</li>
            </ul>
            <Link to="/register" className="landing-btn primary" style={{ width: '100%' }}>
              Pro starten
            </Link>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="landing-cta">
        <motion.div
          className="landing-cta-content"
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
          <h2>Bereit, produktiver zu werden?</h2>
          <p>Starte jetzt kostenlos und erlebe, wie KI deine To-Do-Liste revolutioniert.</p>
          <Link to="/register" className="landing-btn primary large">
            Jetzt kostenlos starten <ArrowRight size={20} />
          </Link>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-logo">
            <div className="landing-logo-icon">
              <CheckSquare size={18} />
            </div>
            <span className="landing-logo-text">Taski</span>
          </div>
          <p>© 2026 Taski. KI-gestützte Aufgabenverwaltung.</p>
        </div>
      </footer>
    </div>
  );
}
