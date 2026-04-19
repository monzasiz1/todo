import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
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
  WandSparkles,
} from 'lucide-react';

const heroBullets = [
  'KI-Eingabe mit Live-Preview fuer Titel, Datum, Uhrzeit, Prioritaet und Gruppe',
  'Manuelle Erstellung fuer Aufgaben und Termine mit voller Kontrolle',
  'Wiederkehrende Serien, Erinnerungen, Rechte, Gruppen und Kalender in einer App',
];

const modules = [
  {
    icon: Brain,
    title: 'KI Task Engine',
    desc: 'Natuerliche Eingaben werden analysiert und als strukturierte Aufgaben gespeichert. Auch wiederkehrende Termine koennen direkt als Serie erstellt werden.',
    tone: 'violet',
  },
  {
    icon: Layers3,
    title: 'Manuell + KI in einem Flow',
    desc: 'Zwischen KI-Erstellung und manueller Erfassung kannst du ohne Kontextwechsel wechseln. Beide Wege landen im gleichen Task-System.',
    tone: 'cyan',
  },
  {
    icon: Repeat,
    title: 'Wiederholungen und Serien',
    desc: 'Taeglich, woechentlich, monatlich oder bis zu einem Enddatum. Wiederkehrende Aufgaben werden direkt fuer Kalender und Dashboard aufbereitet.',
    tone: 'gold',
  },
  {
    icon: CalendarDays,
    title: 'Dashboard + Kalender',
    desc: 'Uebersicht, Tagesfokus und Kalenderansicht greifen ineinander. Aufgaben ueber mehrere Tage werden sauber im Datumskorridor dargestellt.',
    tone: 'blue',
  },
  {
    icon: UserCheck,
    title: 'Teilen und Berechtigungen',
    desc: 'Privat, mit allen Freunden oder selektiv teilen. Pro Person sind Lese- und Bearbeitungsrechte steuerbar.',
    tone: 'green',
  },
  {
    icon: UsersRound,
    title: 'Gruppenplanung',
    desc: 'Gruppen mit Invite-Code, Rollen und Aufgabenverwaltung. Gruppenbilder und Mitgliedsrollen sorgen fuer klare Verantwortung.',
    tone: 'pink',
  },
  {
    icon: Eye,
    title: 'Profile und Avatare',
    desc: 'Profilbilder oder Initial-Fallbacks sind konsistent ueber Sidebar, Aufgabenansichten, Gruppen und Freundefunktionen sichtbar.',
    tone: 'slate',
  },
  {
    icon: Download,
    title: 'PWA Installierbar',
    desc: 'Installierbar auf Mobilgeraeten und Desktop mit eigenem Install-Prompt, damit Taski wie eine native App genutzt werden kann.',
    tone: 'orange',
  },
];

const timeline = [
  {
    step: '01',
    title: 'Input',
    text: 'Aufgabe per KI-Text oder manuell erfassen, inklusive Termin, Endzeit, Prioritaet, Kategorie und Erinnerung.',
  },
  {
    step: '02',
    title: 'Struktur',
    text: 'Taski verarbeitet Wiederholung, Sichtbarkeit, Rechte und Gruppenzuordnung in einem konsistenten Datenmodell.',
  },
  {
    step: '03',
    title: 'Umsetzung',
    text: 'Aufgaben erscheinen in Dashboard, Kalender und Listenansichten. Nutzer sehen sofort offenen, heutigen und dringenden Bedarf.',
  },
  {
    step: '04',
    title: 'Zusammenarbeit',
    text: 'Freunde und Gruppen arbeiten gemeinsam mit klaren Rollen und kontrollierten Bearbeitungsrechten.',
  },
];

const trustCards = [
  {
    icon: Lock,
    title: 'Sicherer Zugriff',
    text: 'Login-first Routing sorgt dafuer, dass Nutzer in den geschuetzten Bereich starten und bei Logout sauber zum Login zurueckkehren.',
  },
  {
    icon: Shield,
    title: 'Klare Rechte',
    text: 'Sichtbarkeit und Rechte sind nicht nur UI, sondern tief im Task-Flow integriert und fuer Teamarbeit praxisnah ausgelegt.',
  },
  {
    icon: Globe,
    title: 'Produktionsreif',
    text: 'Kalender, Gruppen, Profile, Toaster, Install-Prompt und KI-Parsing sind als zusammenhaengendes Produkt aufgebaut.',
  },
];

const rise = {
  hidden: { opacity: 0, y: 24 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.08,
      duration: 0.45,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  }),
};

export default function LandingPage() {
  return (
    <div className="lpx-shell">
      <div className="lpx-noise" />

      <header className="lpx-nav-wrap">
        <div className="lpx-nav">
          <Link to="/landing" className="lpx-brand">
            <span className="lpx-brand-icon"><CheckSquare size={20} /></span>
            <span className="lpx-brand-text">Taski</span>
          </Link>
          <nav className="lpx-nav-links">
            <a href="#module">Features</a>
            <a href="#flow">Workflow</a>
            <a href="#trust">Enterprise Ready</a>
          </nav>
          <div className="lpx-nav-actions">
            <Link to="/login" className="lpx-btn lpx-btn-ghost">Anmelden</Link>
            <Link to="/register" className="lpx-btn lpx-btn-solid">Jetzt starten</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="lpx-hero">
          <div className="lpx-hero-glow lpx-hero-glow-a" />
          <div className="lpx-hero-glow lpx-hero-glow-b" />
          <div className="lpx-container lpx-hero-grid">
            <motion.div
              className="lpx-hero-copy"
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
            >
              <motion.div className="lpx-chip" variants={rise}>
                <WandSparkles size={14} /> Produktive Planung mit KI + Collaboration
              </motion.div>
              <motion.h1 className="lpx-hero-title" variants={rise}>
                Die professionelle
                <span> Task- und Terminplattform </span>
                fuer Einzelpersonen und Teams.
              </motion.h1>
              <motion.p className="lpx-hero-lead" variants={rise}>
                Taski zeigt auf den ersten Blick alles, was moderne Planung braucht: KI-Eingabe,
                manuelle Kontrolle, Kalenderlogik, Wiederholungen, Erinnerungen, Freundesfreigaben,
                Gruppenarbeit und mobile App-Installation als PWA.
              </motion.p>

              <motion.div className="lpx-hero-actions" variants={rise}>
                <Link to="/register" className="lpx-btn lpx-btn-solid lpx-btn-xl">
                  Kostenlos testen <ArrowRight size={18} />
                </Link>
                <Link to="/login" className="lpx-btn lpx-btn-ghost lpx-btn-xl">
                  Zum Login
                </Link>
              </motion.div>

              <motion.div className="lpx-hero-bullets" variants={rise}>
                {heroBullets.map((item) => (
                  <div key={item} className="lpx-bullet">
                    <CheckCircle2 size={16} />
                    <span>{item}</span>
                  </div>
                ))}
              </motion.div>
            </motion.div>

            <motion.div
              className="lpx-hero-panel"
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.12 }}
            >
              <div className="lpx-panel-top">
                <div className="lpx-dots"><span /><span /><span /></div>
                <strong>Taski Product View</strong>
              </div>

              <div className="lpx-panel-card lpx-panel-ai">
                <div className="lpx-panel-card-title"><Sparkles size={15} /> KI Input</div>
                <p>"Jeden Mittwoch bis Ende Mai Probe von 19:00 bis 21:00"</p>
                <div className="lpx-tags">
                  <span><Clock3 size={12} /> 19:00</span>
                  <span><Repeat size={12} /> Woechentlich</span>
                  <span><Flag size={12} /> Hoch</span>
                </div>
              </div>

              <div className="lpx-panel-grid">
                <div className="lpx-panel-card">
                  <div className="lpx-panel-card-title"><Users size={15} /> Teilen</div>
                  <p>Privat, alle Freunde oder selektiv mit Bearbeitungsrechten.</p>
                </div>
                <div className="lpx-panel-card">
                  <div className="lpx-panel-card-title"><UsersRound size={15} /> Gruppen</div>
                  <p>Invite-Code, Rollen, Gruppenbild und gemeinsame Aufgaben.</p>
                </div>
              </div>

              <div className="lpx-panel-card lpx-panel-last">
                <div className="lpx-panel-card-title"><CalendarDays size={15} /> Kalender + Dashboard</div>
                <p>Gesamtsicht, Tagesfokus, Dringlichkeit und Fortschritt ohne Toolwechsel.</p>
              </div>
            </motion.div>
          </div>
        </section>

        <section id="module" className="lpx-section">
          <div className="lpx-container">
            <div className="lpx-head">
              <span className="lpx-kicker">Kompletter Feature-Umfang</span>
              <h2>Alles was die App kann, professionell dargestellt.</h2>
              <p>
                Die Landing Page kommuniziert nicht nur Funktionen, sondern den konkreten Produktnutzen
                fuer taegliche Planung, Teamkoordination und mobile Nutzung.
              </p>
            </div>

            <div className="lpx-module-grid">
              {modules.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <motion.article
                    key={item.title}
                    className={`lpx-module-card tone-${item.tone}`}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, amount: 0.2 }}
                    custom={idx}
                    variants={rise}
                  >
                    <div className="lpx-module-icon"><Icon size={22} /></div>
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </motion.article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="flow" className="lpx-section lpx-flow-bg">
          <div className="lpx-container lpx-flow-wrap">
            <div className="lpx-head lpx-head-left">
              <span className="lpx-kicker">Produkt-Workflow</span>
              <h2>Von Eingabe bis Zusammenarbeit in einem durchgehenden System.</h2>
              <p>
                Genau dieser End-to-End Ablauf erzeugt den professionellen Eindruck, den Kunden
                direkt verstehen und kaufen wollen.
              </p>
            </div>

            <div className="lpx-flow-grid">
              {timeline.map((item, idx) => (
                <motion.div
                  key={item.step}
                  className="lpx-flow-card"
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, amount: 0.15 }}
                  custom={idx}
                  variants={rise}
                >
                  <div className="lpx-flow-step">{item.step}</div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section id="trust" className="lpx-section">
          <div className="lpx-container">
            <div className="lpx-head">
              <span className="lpx-kicker">Vertrauen und Reifegrad</span>
              <h2>Technisch solide, klar positioniert und verkaufsstark.</h2>
            </div>

            <div className="lpx-trust-grid">
              {trustCards.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <motion.div
                    key={item.title}
                    className="lpx-trust-card"
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, amount: 0.2 }}
                    custom={idx}
                    variants={rise}
                  >
                    <div className="lpx-trust-icon"><Icon size={20} /></div>
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="lpx-cta">
          <motion.div
            className="lpx-cta-card"
            initial={{ opacity: 0, scale: 0.96 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.4 }}
          >
            <h2>Aus Interessenten werden Kunden, wenn die Produktstory klar ist.</h2>
            <p>
              Taski zeigt jetzt auf der Landing Page praezise, was die Plattform wirklich kann:
              intelligente Planung, Team-Features und ein professionelles Nutzungserlebnis.
            </p>
            <div className="lpx-cta-actions">
              <Link to="/register" className="lpx-btn lpx-btn-solid lpx-btn-xl">
                Kostenlos starten <ArrowRight size={18} />
              </Link>
              <Link to="/login" className="lpx-btn lpx-btn-ghost lpx-btn-xl">
                Bereits Konto? Login
              </Link>
            </div>
          </motion.div>
        </section>
      </main>

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
