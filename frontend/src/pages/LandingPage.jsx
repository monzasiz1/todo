import { useEffect, useMemo, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle, ArrowRight, ArrowUp, BarChart2, Bell, CalendarDays,
  Check, CheckCircle2, ChevronDown, Clock, FileText, Flag,
  Key, Layers3, LayoutDashboard, ListTodo, Mail, Paperclip, Repeat,
  Sparkles, Tag, Target, UsersRound, User, X, Zap, Download,
  Leaf, Timer, MessageSquare, FolderKanban, MoveDiagonal, Smartphone,
} from 'lucide-react';
import { PLANS } from '../lib/plans';
import { useAuthStore } from '../store/authStore';

/* ─────────────── data ─────────────── */

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

const bentoFeatures = [
  { icon: Sparkles,    color: '#007AFF', bg: 'rgba(0,122,255,0.1)',   title: 'KI-Texteingabe',         desc: '"Sprint-Review Freitag 10 Uhr, hohe Prio" — BeeQu erkennt Titel, Datum, Uhrzeit, Kategorie und Priorität automatisch.', plan: 'Pro & Team', wide: true },
  { icon: CalendarDays,color: '#5856D6', bg: 'rgba(88,86,214,0.1)',   title: 'Ultra-Kalender',         desc: 'Wochen- & Monatsansicht. Drag & Drop direkt im Raster, Termine verschieben mit einem Wisch.',                                plan: 'Alle Pläne' },
  { icon: MessageSquare,color:'#34C759', bg: 'rgba(52,199,89,0.1)',   title: 'Team-Chat mit Events',  desc: 'Echtzeit-Chat in Gruppen, mit eingebetteten Terminen, Reaktionen, Abstimmungen und Anhängen.',                              plan: 'Team' },
  { icon: FolderKanban,color: '#FF9500', bg: 'rgba(255,149,0,0.1)',   title: 'Gruppen-Projekt-Board', desc: 'Geteilte Aufgaben, Fortschritts-Balken und Status-Spalten — der ganzen Gruppe immer sichtbar.',                              plan: 'Pro & Team' },
  { icon: Repeat,      color: '#FF375F', bg: 'rgba(255,55,95,0.1)',   title: 'Wiederkehrende Tasks',  desc: 'Täglich, wöchentlich, monatlich, jährlich oder benutzerdefiniert — einmal anlegen, läuft von allein.',                       plan: 'Pro & Team' },
  { icon: Timer,       color: '#AF52DE', bg: 'rgba(175,82,222,0.1)',  title: 'Focus-Timer',           desc: 'Pomodoro-Sessions mit Push-Benachrichtigung am Ende. Läuft auch im Hintergrund weiter.',                                       plan: 'Alle Pläne' },
  { icon: FileText,    color: '#00C7BE', bg: 'rgba(0,199,190,0.1)',   title: 'Notizen-Board',         desc: 'Sticky-Notes mit Drag & Drop auf einem freien Board. Verbindungen, Farben, Verknüpfung zu Aufgaben.',                          plan: 'Alle Pläne' },
  { icon: BarChart2,   color: '#FF9500', bg: 'rgba(255,149,0,0.1)',   title: 'Statistiken & Insights',desc: 'Wochenquote, erledigte Aufgaben pro Kategorie, produktivste Tage — alles auf einen Blick im Dashboard.',                       plan: 'Pro & Team' },
  { icon: Paperclip,   color: '#FF3B30', bg: 'rgba(255,59,48,0.1)',   title: 'Dateianhänge',          desc: 'Dokumente, Bilder, PDFs direkt an Aufgaben heften — bis 4 MB pro Datei, in Sekunden geladen.',                                  plan: 'Pro & Team' },
  { icon: Bell,        color: '#5856D6', bg: 'rgba(88,86,214,0.1)',   title: 'Smarte Erinnerungen',   desc: 'Push-Benachrichtigungen genau dann, wenn es zählt. Funktioniert auch offline & im Hintergrund.',                                plan: 'Alle Pläne' },
  { icon: MoveDiagonal,color: '#007AFF', bg: 'rgba(0,122,255,0.1)',   title: 'ICS-Kalender-Sync',     desc: 'Exportiere deinen BeeQu-Kalender als ICS-Feed — abonnierbar in Apple, Google & Outlook.',                                       plan: 'Pro & Team' },
  { icon: Smartphone,  color: '#34C759', bg: 'rgba(52,199,89,0.1)',   title: 'PWA — überall installierbar', desc: 'iOS, Android, macOS, Windows. Offline-fähig, Push, Home-Screen-Icon. Kein App-Store nötig.',                              plan: 'Alle Pläne' },
];

const mockTasks = [
  {
    title: 'Sprint-Review vorbereiten',
    subtitle: 'Agenda und Status fuer das Team finalisieren',
    cat: 'Produkt',
    catColor: '#34C759',
    prio: 'medium',
    time: 'Heute, 10:00 Uhr - 11:30 Uhr',
    day: '2',
    month: 'MAI',
    type: 'Termin',
    done: false,
    section: 'today',
    tags: ['Abstimmung', 'Team'],
  },
  {
    title: 'Rechnung freigeben',
    subtitle: 'Budget fuer Kampagne bestaetigen',
    cat: 'Finanzen',
    catColor: '#FF3B30',
    prio: 'urgent',
    time: 'Heute, 17:00 Uhr',
    day: '2',
    month: 'MAI',
    type: 'Aufgabe',
    done: false,
    section: 'today',
    tags: [],
  },
  {
    title: 'Reisekosten einreichen',
    subtitle: 'Belege fuer April hochladen',
    cat: 'Finanzen',
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
    title: 'Design-System Check-in',
    subtitle: 'Komponentenstand mit dem UI-Team abstimmen',
    cat: 'Design',
    catColor: '#00C7BE',
    prio: 'low',
    time: '6. Mai, 15:00 Uhr - 16:00 Uhr',
    day: '6',
    month: 'MAI',
    type: 'Termin',
    done: false,
    section: 'later',
    tags: ['Woechentlich'],
  },
  {
    title: 'Kundentermin abstimmen',
    subtitle: 'Naechsten Projektmeilenstein vorbereiten',
    cat: 'Arbeit',
    catColor: '#5856D6',
    prio: 'medium',
    time: '7. Mai',
    day: '7',
    month: 'MAI',
    type: 'Termin',
    done: false,
    section: 'later',
    tags: ['Follow-up'],
  },
];

const mockSidebarCategories = [
  { name: 'Alle', color: '#007AFF', n: 28 },
  { name: 'Arbeit', color: '#007AFF', n: 6 },
  { name: 'Produkt', color: '#34C759', n: 5 },
  { name: 'Design', color: '#00C7BE', n: 4 },
  { name: 'Finanzen', color: '#FF3B30', n: 2 },
  { name: 'Recherche', color: '#5856D6', n: 3 },
  { name: 'Privat', color: '#AF52DE', n: 4 },
  { name: 'Gesundheit', color: '#FF9500', n: 4 },
];

const prioBar = { urgent: '#FF3B30', high: '#FF9500', medium: '#007AFF', low: '#34C759' };

const aiExamples = [
  { input: '"Sprint Review Freitag 10 Uhr, hohe Prioritaet"', title: 'Sprint Review', date: 'Freitag', time: '10:00', cat: 'Produkt', prio: 'Hoch' },
  { input: '"Montag Rechnung abschicken um 9 Uhr"',            title: 'Rechnung',      date: 'Montag',  time: '09:00', cat: 'Finanzen', prio: 'Mittel' },
  { input: '"Mittwoch Workout 18:30 erinnern"',               title: 'Workout',       date: 'Mittwoch',time: '18:30', cat: 'Gesundheit', prio: 'Niedrig' },
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

/* ─────────────── interactive feature showcase ─────────────── */

function FeatureDemo({ feature }) {
  const { title, color, bg, icon: Icon } = feature;
  const accent = { color, background: bg };

  // Mini-Demo-Komposition je Feature (kein voller Mockup, nur ausdrucksstarke Andeutung)
  if (title === 'KI-Texteingabe') {
    return (
      <div className="bq-demo-card">
        <div className="bq-demo-input" style={{ borderColor: color, background: bg }}>
          <Sparkles size={16} style={{ color }} />
          <span className="bq-demo-typing">„Sprint-Review Freitag 10 Uhr, hohe Prio"</span>
        </div>
        <div className="bq-demo-chips">
          <span className="bq-demo-chip" style={accent}>Freitag</span>
          <span className="bq-demo-chip" style={accent}>10:00</span>
          <span className="bq-demo-chip" style={accent}>Produkt</span>
          <span className="bq-demo-chip" style={accent}>Hoch</span>
        </div>
      </div>
    );
  }
  if (title === 'Ultra-Kalender') {
    return (
      <div className="bq-demo-card">
        <div className="bq-demo-cal-head">Mai 2026</div>
        <div className="bq-demo-cal">
          {['M','D','M','D','F','S','S'].map((d) => <div key={d} className="bq-demo-cal-h">{d}</div>)}
          {Array.from({ length: 21 }).map((_, i) => {
            const day = i + 1;
            const has = [2,4,7,11,13,16].includes(day);
            const today = day === 10;
            return (
              <div key={i} className={`bq-demo-cal-c${has?' has':''}${today?' today':''}`}
                   style={today ? { background: bg, color, borderColor: color } : undefined}>
                {day}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  if (title === 'Team-Chat mit Events') {
    return (
      <div className="bq-demo-card">
        <div className="bq-demo-msg"><span className="bq-demo-avatar" style={{ background: color }}>M</span><span>„Termin verschoben auf 14:00 ✓"</span></div>
        <div className="bq-demo-msg bq-demo-msg-event" style={{ borderColor: color, background: bg }}>
          <CalendarDays size={14} style={{ color }} /> <strong>Sprint-Review</strong> · Fr 10:00
        </div>
        <div className="bq-demo-msg"><span className="bq-demo-avatar" style={{ background: '#FF9500' }}>J</span><span className="bq-demo-typing">tippt</span></div>
      </div>
    );
  }
  if (title === 'Gruppen-Projekt-Board') {
    return (
      <div className="bq-demo-card">
        <div className="bq-demo-row">
          <strong>Marketing Team</strong>
          <div className="bq-demo-avatars">
            <span className="bq-demo-avatar" style={{ background: '#FF9500' }}>A</span>
            <span className="bq-demo-avatar" style={{ background: '#5856D6' }}>M</span>
            <span className="bq-demo-avatar" style={{ background: '#34C759' }}>J</span>
            <span className="bq-demo-avatar bq-demo-avatar-mute">+4</span>
          </div>
        </div>
        <div className="bq-demo-progress"><i style={{ background: color, width: '68%' }} /></div>
        <div className="bq-demo-meta"><span>12 / 18 Tasks</span><span style={{ color }}>+3 diese Woche</span></div>
      </div>
    );
  }
  if (title === 'Wiederkehrende Tasks') {
    return (
      <div className="bq-demo-card">
        <div className="bq-demo-row"><Repeat size={14} style={{ color }} /> Sport <span className="bq-demo-chip" style={accent}>Mo · Mi · Fr</span></div>
        <div className="bq-demo-row"><Repeat size={14} style={{ color }} /> Standup <span className="bq-demo-chip" style={accent}>Täglich 09:00</span></div>
        <div className="bq-demo-row"><Repeat size={14} style={{ color }} /> Monatsbericht <span className="bq-demo-chip" style={accent}>Letzter Tag</span></div>
      </div>
    );
  }
  if (title === 'Focus-Timer') {
    return (
      <div className="bq-demo-card bq-demo-center">
        <div className="bq-demo-ring" style={{ '--bq-ring-color': color }}>
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="6" />
            <circle cx="50" cy="50" r="44" fill="none" stroke={color} strokeWidth="6"
                    strokeDasharray="276" strokeDashoffset="92" strokeLinecap="round"
                    transform="rotate(-90 50 50)" />
          </svg>
          <div className="bq-demo-ring-text"><strong>17:42</strong><span>Fokus</span></div>
        </div>
      </div>
    );
  }
  if (title === 'Notizen-Board') {
    return (
      <div className="bq-demo-board">
        <div className="bq-demo-sticky" style={{ background: '#FFF6C8' }}>Newsletter Q3<br /><small>Idee</small></div>
        <div className="bq-demo-sticky" style={{ background: '#D5F0FF' }}>Launch-Plan<br /><small>In Arbeit</small></div>
        <div className="bq-demo-sticky" style={{ background: '#DCFCE7' }}>Recherche<br /><small>Fertig</small></div>
        <svg className="bq-demo-board-lines" viewBox="0 0 300 140" aria-hidden>
          <path d="M70 30 C 110 50, 130 60, 160 70" stroke={color} strokeWidth="1.5" fill="none" strokeDasharray="3 3" />
        </svg>
      </div>
    );
  }
  if (title === 'Statistiken & Insights') {
    return (
      <div className="bq-demo-card">
        <div className="bq-demo-meta"><span>Diese Woche</span><span style={{ color: '#34C759' }}>+18 %</span></div>
        <div className="bq-demo-chart">
          {[0.45,0.7,0.55,0.82,0.65,0.95,0.6].map((v, i) => (
            <i key={i} style={{ height: `${v*100}%`, background: `linear-gradient(180deg, ${color}, ${color}33)` }} />
          ))}
        </div>
        <div className="bq-demo-meta"><span>Erledigt: <strong style={{ color }}>47</strong></span><span>Streak: <strong style={{ color }}>12 T.</strong></span></div>
      </div>
    );
  }
  if (title === 'Dateianhänge') {
    return (
      <div className="bq-demo-card">
        <div className="bq-demo-file"><span className="bq-demo-file-ico" style={accent}>📄</span><div><div>Briefing-Q2.pdf</div><small>2,4 MB</small></div></div>
        <div className="bq-demo-file"><span className="bq-demo-file-ico" style={accent}>🖼</span><div><div>moodboard.jpg</div><small>1,1 MB</small></div></div>
      </div>
    );
  }
  if (title === 'Smarte Erinnerungen') {
    return (
      <div className="bq-demo-card bq-demo-center">
        <div className="bq-demo-bell" style={{ background: bg, borderColor: color, color }}>
          <Bell size={28} />
        </div>
        <div className="bq-demo-toast">
          <small>in 15 Min · Push</small>
          <div>Meeting mit Team</div>
        </div>
      </div>
    );
  }
  if (title === 'ICS-Kalender-Sync') {
    return (
      <div className="bq-demo-card">
        <div className="bq-demo-row"><MoveDiagonal size={14} style={{ color }} /> beequ.ics <span className="bq-demo-chip" style={accent}>abonnierbar</span></div>
        <div className="bq-demo-row" style={{ opacity: 0.85 }}>📅 Apple Kalender</div>
        <div className="bq-demo-row" style={{ opacity: 0.85 }}>📅 Google Calendar</div>
        <div className="bq-demo-row" style={{ opacity: 0.85 }}>📅 Outlook</div>
      </div>
    );
  }
  if (title === 'PWA — überall installierbar') {
    return (
      <div className="bq-demo-card bq-demo-center">
        <div className="bq-demo-devices">
          <Smartphone size={36} style={{ color }} />
          <LayoutDashboard size={44} style={{ color: '#5856D6' }} />
          <Layers3 size={32} style={{ color: '#FF9500' }} />
        </div>
        <div className="bq-demo-meta" style={{ justifyContent: 'center', gap: 14 }}>
          <span>iOS</span><span>Android</span><span>macOS</span><span>Windows</span>
        </div>
      </div>
    );
  }
  // Fallback
  return (
    <div className="bq-demo-card bq-demo-center">
      <div className="bq-demo-bell" style={{ background: bg, borderColor: color, color }}>
        <Icon size={28} />
      </div>
    </div>
  );
}

function FeatureShowcase({ features }) {
  const [active, setActive] = useState(0);
  const item = features[active];
  const stageRef = useRef(null);

  const handleMove = (e) => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
  };
  const handleLeave = () => {
    const el = stageRef.current;
    if (!el) return;
    el.style.setProperty('--mx', '50%');
    el.style.setProperty('--my', '50%');
  };

  return (
    <div
      className="bq-showcase"
      style={{
        '--bq-card-accent': item.color,
        '--bq-card-tint': item.bg,
      }}
    >
      <div className="bq-showcase-list" role="tablist" aria-label="Features">
        <motion.span
          className="bq-showcase-pill"
          aria-hidden
          animate={{ y: active * 60 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        />
        {features.map((f, i) => {
          const Icon = f.icon;
          const isActive = i === active;
          return (
            <button
              key={f.title}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`bq-showcase-item${isActive ? ' active' : ''}`}
              style={{ '--bq-card-accent': f.color, '--bq-card-tint': f.bg }}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
            >
              <span className="bq-showcase-item-icon"><Icon size={16} /></span>
              <span className="bq-showcase-item-text">
                <span className="bq-showcase-item-title">{f.title}</span>
                <span className="bq-showcase-item-plan">{f.plan}</span>
              </span>
              <span className="bq-showcase-item-arrow"><ArrowRight size={14} /></span>
            </button>
          );
        })}
      </div>

      <div
        className="bq-showcase-stage"
        ref={stageRef}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <div className="bq-showcase-stage-grid" aria-hidden />
        <AnimatePresence mode="wait">
          <motion.div
            key={item.title}
            className="bq-showcase-slide"
            initial={{ opacity: 0, y: 16, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.99 }}
            transition={{ duration: 0.42, ease }}
          >
            <div className="bq-showcase-slide-head">
              <span className="bq-showcase-tag" style={{ color: item.color, background: item.bg, borderColor: item.color }}>
                <item.icon size={14} /> {item.plan}
              </span>
              <span className="bq-showcase-counter">{String(active + 1).padStart(2, '0')} / {String(features.length).padStart(2, '0')}</span>
            </div>
            <h3 className="bq-showcase-headline">
              {item.title}
            </h3>
            <p className="bq-showcase-copy">{item.desc}</p>
            <div className="bq-showcase-visual">
              <FeatureDemo feature={item} />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

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
  const [pricingInterval, setPricingInterval] = useState('month'); // 'month' | 'year'
  const [mobileCtaVisible, setMobileCtaVisible] = useState(false);
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
      // Mobile sticky CTA: zeige nachdem Hero zu ~60 % gescrollt wurde
      setMobileCtaVisible(progress >= 0.55);
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

      {/* ══════════ GLOBAL ANIMATED BG ══════════ */}
      <div className="bq-page-aurora" aria-hidden>
        <div className="bq-page-orb bq-page-orb-1" />
        <div className="bq-page-orb bq-page-orb-2" />
        <div className="bq-page-orb bq-page-orb-3" />
        <div className="bq-page-orb bq-page-orb-4" />
        <div className="bq-page-noise" />
      </div>

      {/* ══════════ MOBILE STICKY CTA (innovativ, nur ≤ 820px) ══════════ */}
      <div
        className={`bq-mobile-cta-bar${mobileCtaVisible ? ' is-visible' : ''}`}
        role="region"
        aria-label="Schnellstart"
        aria-hidden={!mobileCtaVisible}
      >
        <div className="bq-mobile-cta-text">
          <span className="bq-mobile-cta-title">BeeQu — alles drin.</span>
          <span className="bq-mobile-cta-sub">Kostenlos starten · keine Karte nötig</span>
        </div>
        <button
          type="button"
          className="bq-btn bq-primary"
          onClick={() => setShowRegister(true)}
        >
          Loslegen
        </button>
      </div>

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
            <a href="#downloads">Downloads</a>
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
            <a 
              href="/api/download?platform=windows"
              className="bq-btn bq-ghost bq-btn-lg"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Download size={17} /> Desktop App
            </a>
          </motion.div>

          <motion.div className="bq-hero-trust" variants={fadeUp}>
            <span><Check size={13} strokeWidth={3} />Keine Kreditkarte</span>
            <span><Check size={13} strokeWidth={3} />Free Plan inklusive</span>
            <a 
              href="/api/download?platform=windows"
              style={{ 
                display: 'inline-flex', 
                alignItems: 'center', 
                gap: '4px',
                textDecoration: 'none',
                color: 'inherit',
                cursor: 'pointer'
              }}
            >
              <Download size={13} strokeWidth={3} />Desktop App (.exe)
            </a>
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
                  <div className="bq-mock-user-avatar">D</div>
                  <div className="bq-mock-user-meta">
                    <strong>Demo Workspace</strong>
                    <span>hello@beequ.app</span>
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
                      <span className="bq-mock-tag bq-tag-date">Freitag</span>
                      <span className="bq-mock-tag bq-tag-time">10:00</span>
                      <span className="bq-mock-tag bq-tag-prio">Hoch</span>
                      <span className="bq-mock-tag bq-tag-cat">Produkt</span>
                    </div>
                    <div className="bq-mock-ai-helper">
                      "Freitag Reinigung 18 Uhr" · "Loesche Zahnarzt" · "Wo hab ich noch Kapazitaeten?" · "Wann kann ich zum Sport?"
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
                      <span>Heute: 4</span><span>Überfällig: 1</span><span>Woche: 82%</span>
                    </div>
                  </div>
                  <div className="bq-mock-ins-list">
                    <div className="bq-mock-ins-item">
                      <div className="bq-mock-ins-icon alert">!</div>
                      <span>3 Aufgaben fällig bis 18:00 Uhr</span>
                    </div>
                    <div className="bq-mock-ins-item">
                      <div className="bq-mock-ins-icon calm">✓</div>
                      <span>5,5h freie Zeit für fokussierte Aufgaben</span>
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
                      {visibleTodayTasks.map(({ id, title, subtitle, cat, catColor, prio, time, day, month, type, tags, done }) => {
                        const isEvent = type === 'Termin';
                        return (
                        <div key={id} className={`bq-mock-task ${isEvent ? 'event' : 'todo'}${done ? ' done' : ''}`}>
                          <div className="bq-mock-task-bar" style={{ background: prioBar[prio] }} />
                          <div className={`bq-mock-date-chip ${isEvent ? 'event' : 'todo'}`}>
                            {isEvent ? (
                              <span className="bq-mock-date-icon"><CalendarDays size={11} /></span>
                            ) : (
                              <button
                                type="button"
                                className={`bq-mock-date-toggle${done ? ' checked' : ''}`}
                                onClick={() => toggleMockTask(id)}
                                aria-label={`Aufgabe ${title} umschalten`}
                              >
                                {done ? <Check size={12} strokeWidth={3} /> : <div className="bq-mock-date-circle" />}
                              </button>
                            )}
                            <span>{month}</span>
                            <strong>{day}</strong>
                          </div>
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
                      )})}
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
                      <div className="bq-mock-sec-icon bq-mock-sec-icon-neutral">•</div>
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
                      {visibleLaterTasks.map(({ id, title, subtitle, cat, catColor, prio, time, day, month, type, tags, done }) => {
                        const isEvent = type === 'Termin';
                        return (
                        <div key={id} className={`bq-mock-task ${isEvent ? 'event' : 'todo'}${done ? ' done' : ''}`}>
                          <div className="bq-mock-task-bar" style={{ background: prioBar[prio] }} />
                          <div className={`bq-mock-date-chip ${isEvent ? 'event' : 'todo'}`}>
                            {isEvent ? (
                              <span className="bq-mock-date-icon"><CalendarDays size={11} /></span>
                            ) : (
                              <button
                                type="button"
                                className={`bq-mock-date-toggle${done ? ' checked' : ''}`}
                                onClick={() => toggleMockTask(id)}
                                aria-label={`Aufgabe ${title} umschalten`}
                              >
                                {done ? <Check size={12} strokeWidth={3} /> : <div className="bq-mock-date-circle" />}
                              </button>
                            )}
                            <span>{month}</span>
                            <strong>{day}</strong>
                          </div>
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
                      )})}
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
            { icon: Sparkles,    text: 'KI versteht natürliche Sprache' },
            { icon: CalendarDays,text: 'Drag & Drop im Kalender' },
            { icon: MessageSquare,text:'Team-Chat mit Events' },
            { icon: FolderKanban,text: 'Geteilte Projekt-Boards' },
            { icon: Timer,       text: 'Focus-Timer & Pomodoro' },
            { icon: Bell,        text: 'Push-Erinnerungen' },
            { icon: Leaf,        text: '1 % für Stripe Climate' },
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

      {/* ══════════ INTERACTIVE FEATURE SHOWCASE ══════════ */}
      <section className="bq-section bq-features-section" id="features">
        {/* Honeycomb-Pattern (passt zum Bee-Branding) */}
        <div className="bq-honeycomb" aria-hidden>
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="bq-hex-pattern" x="0" y="0" width="56" height="96" patternUnits="userSpaceOnUse">
                <path d="M28 4 L52 18 L52 46 L28 60 L4 46 L4 18 Z" fill="none" stroke="rgba(0,122,255,0.13)" strokeWidth="1" />
                <path d="M0 52 L24 66 L24 94 L0 108 L-24 94 L-24 66 Z" fill="none" stroke="rgba(88,86,214,0.12)" strokeWidth="1" />
                <path d="M56 52 L80 66 L80 94 L56 108 L32 94 L32 66 Z" fill="none" stroke="rgba(88,86,214,0.12)" strokeWidth="1" />
              </pattern>
              <radialGradient id="bq-hex-fade" cx="50%" cy="40%" r="70%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="75%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
              </radialGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#bq-hex-pattern)" />
            <rect width="100%" height="100%" fill="url(#bq-hex-fade)" />
          </svg>
        </div>
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

          <FeatureShowcase features={bentoFeatures} />
        </div>
      </section>

      {/* divider: features (light) → AI (greige) */}
      <div className="bq-divider bq-divider-to-ai" aria-hidden>
        <svg viewBox="0 0 1440 80" preserveAspectRatio="none">
          <path d="M0,0 C220,70 460,20 720,42 C980,64 1220,18 1440,55 L1440,80 L0,80 Z" fill="#F4F1EB" />
        </svg>
        <div className="bq-divider-sparkle" />
      </div>

      {/* ══════════ AI SPOTLIGHT ══════════ */}
      <section className="bq-section bq-section-alt bq-section-ai" id="ai">
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

      {/* divider: AI (greige) → Pricing (white) */}
      <div className="bq-divider bq-divider-to-pricing" aria-hidden>
        <svg viewBox="0 0 1440 80" preserveAspectRatio="none">
          <path d="M0,80 C240,30 480,70 720,45 C960,18 1200,58 1440,28 L1440,80 Z" fill="#FFFFFF" />
        </svg>
        <div className="bq-divider-glow" />
      </div>

      {/* ══════════ PRICING ══════════ */}
      <section className="bq-section bq-pricing-section" id="pricing">
        <div className="bq-pricing-bg" aria-hidden>
          <div className="bq-pricing-aurora bq-pricing-aurora-1" />
          <div className="bq-pricing-aurora bq-pricing-aurora-2" />
          <div className="bq-pricing-aurora bq-pricing-aurora-3" />
          <div className="bq-pricing-grid-lines" />
        </div>
        <div className="bq-container">
          <motion.div
            className="bq-section-head"
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-60px' }}
            variants={fadeUp}
          >
            <span className="bq-label">Preise</span>
            <h2>Wähle deinen Plan.<br /><span className="bq-h2-muted">Jederzeit kündbar.</span></h2>
            <p>Starte kostenlos. Upgrade nur, wenn du wirklich mehr brauchst — keine versteckten Kosten.</p>
          </motion.div>

          {/* Interval Toggle */}
          <motion.div
            className="bq-price-toggle"
            initial="hidden" whileInView="visible" viewport={{ once: true }}
            variants={fadeUp}
            role="tablist" aria-label="Abrechnungsintervall"
          >
            <button
              type="button"
              role="tab"
              aria-selected={pricingInterval === 'month'}
              className={`bq-price-toggle-btn${pricingInterval === 'month' ? ' is-active' : ''}`}
              onClick={() => setPricingInterval('month')}
            >
              Monatlich
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={pricingInterval === 'year'}
              className={`bq-price-toggle-btn${pricingInterval === 'year' ? ' is-active' : ''}`}
              onClick={() => setPricingInterval('year')}
            >
              Jährlich
              <span className="bq-price-toggle-save">−17 %</span>
            </button>
          </motion.div>

          <div className="bq-pricing-grid">
            {orderedPlans.map((plan, i) => {
              const isPaid = plan.id !== 'free';
              const priceLabel = !isPaid
                ? plan.priceLabel
                : pricingInterval === 'year'
                  ? plan.priceLabelYear
                  : plan.priceLabel;
              const subPrice = !isPaid
                ? null
                : pricingInterval === 'year'
                  ? `entspricht ${plan.yearlyMonthly.toFixed(2).replace('.', ',')} €/Monat`
                  : `oder ${plan.priceLabelYear} · 2 Monate gratis`;
              return (
                <motion.div
                  key={plan.id}
                  className={`bq-price-card${plan.id === 'pro' ? ' featured' : ''}`}
                  initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-40px' }}
                  custom={i} variants={fadeUp}
                >
                  {plan.id === 'pro' && <div className="bq-price-glow" aria-hidden />}
                  {plan.id === 'pro' && <div className="bq-price-badge">⭐ Beliebteste Wahl</div>}
                  <div className="bq-price-top">
                    <span className="bq-price-plan" style={{ color: planAccents[plan.id] }}>{plan.label}</span>
                    <div className="bq-price-amount">{priceLabel}</div>
                    {subPrice && <div className="bq-price-year">{subPrice}</div>}
                  </div>
                  <div className="bq-price-line" />
                  <ul className="bq-price-list bq-price-matrix">
                    {getPlanRows(plan).map((row) => (
                      <li
                        key={row.key}
                        className={`bq-price-row${row.included ? ' is-on' : ' is-off'}`}
                      >
                        {row.included ? (
                          <CheckCircle2 size={15} className="bq-price-row-icon on" />
                        ) : (
                          <span className="bq-price-row-icon off" aria-hidden>—</span>
                        )}
                        <span className="bq-price-row-label">{row.label}</span>
                        {row.type === 'limit' && (
                          <span className="bq-price-row-value">
                            {row.included ? formatLimitValue(row.value) : '—'}
                          </span>
                        )}
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
              );
            })}
          </div>

          <motion.div
            className="bq-price-trust"
            initial="hidden" whileInView="visible" viewport={{ once: true }}
            variants={fadeUp}
          >
            <span><Check size={14} /> Jederzeit kündbar</span>
            <span><Check size={14} /> Sichere Zahlung via Stripe</span>
            <span><Check size={14} /> Keine versteckten Kosten</span>
            <span><Check size={14} /> Kein Account-Lock-in — Daten-Export jederzeit</span>
          </motion.div>
        </div>
      </section>

      {/* divider: pricing(light) → climate(dark green) */}
      <div className="bq-divider bq-divider-to-climate" aria-hidden>
        <svg viewBox="0 0 1440 80" preserveAspectRatio="none">
          <path d="M0,80 C240,20 480,60 720,40 C960,20 1200,60 1440,30 L1440,80 Z" fill="#062215" />
        </svg>
      </div>

      {/* ══════════ CLIMATE (eigene Section) ══════════ */}
      <section className="bq-climate-section" id="climate">
        <div className="bq-climate-bg" aria-hidden>
          <div className="bq-climate-aurora bq-climate-aurora-1" />
          <div className="bq-climate-aurora bq-climate-aurora-2" />
          <div className="bq-climate-aurora bq-climate-aurora-3" />
          <div className="bq-climate-grain" />
        </div>
        <div className="bq-container">
          <motion.div
            className="bq-climate-hero"
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-60px' }}
            variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
          >
            <motion.span className="bq-climate-eyebrow" variants={fadeUp}>
              <span className="bq-climate-pulse" aria-hidden />
              <Leaf size={14} />
              <span>Stripe Climate · Mitglied</span>
            </motion.span>

            <motion.h2 className="bq-climate-headline" variants={fadeUp}>
              <span className="bq-climate-mega">1 %</span>
              <span className="bq-climate-headline-text">
                jedes Abos für<br />unseren Planeten.
              </span>
            </motion.h2>

            <motion.p className="bq-climate-lead" variants={fadeUp}>
              Wir spenden automatisch <strong>1 % jedes Pro- und Team-Abos</strong> an{' '}
              <a href="https://stripe.com/climate" target="_blank" rel="noopener noreferrer" className="bq-climate-link">
                Stripe&nbsp;Climate
              </a>{' '}
              — eine Initiative, die <strong>nachweisbar CO₂ aus der Atmosphäre entfernt</strong>.
              Kein Greenwashing, sondern direkte Förderung der nächsten Generation von Climate-Tech.
            </motion.p>

            <motion.div className="bq-climate-stats" variants={fadeUp}>
              <div className="bq-climate-stat">
                <div className="bq-climate-stat-icon">🌍</div>
                <div className="bq-climate-stat-num">1 %</div>
                <div className="bq-climate-stat-label">jedes bezahlten Abos</div>
              </div>
              <div className="bq-climate-stat">
                <div className="bq-climate-stat-icon">🌬️</div>
                <div className="bq-climate-stat-num">CO₂</div>
                <div className="bq-climate-stat-label">nachweisbar entfernt</div>
              </div>
              <div className="bq-climate-stat">
                <div className="bq-climate-stat-icon">⚡</div>
                <div className="bq-climate-stat-num">Automatisch</div>
                <div className="bq-climate-stat-label">ohne Aufpreis für dich</div>
              </div>
              <div className="bq-climate-stat">
                <div className="bq-climate-stat-icon">🔬</div>
                <div className="bq-climate-stat-num">Verifiziert</div>
                <div className="bq-climate-stat-label">durch unabhängige Partner</div>
              </div>
            </motion.div>

            <motion.div className="bq-climate-tech" variants={fadeUp}>
              <span>Direct&nbsp;Air&nbsp;Capture</span>
              <span>·</span>
              <span>Pflanzenkohle</span>
              <span>·</span>
              <span>Mineralische Bindung</span>
              <span>·</span>
              <span>Ozean-Verfahren</span>
            </motion.div>

            <motion.p className="bq-climate-foot" variants={fadeUp}>
              Du bezahlst den normalen Preis — der Klimabeitrag kommt aus unserer Marge.
              Mehr erfahren auf{' '}
              <a href="https://stripe.com/climate" target="_blank" rel="noopener noreferrer" className="bq-climate-link">
                stripe.com/climate
              </a>.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* divider: climate(dark green) → cta(dark blue) seamless wave */}
      <div className="bq-divider bq-divider-to-cta" aria-hidden>
        <svg viewBox="0 0 1440 80" preserveAspectRatio="none">
          <path d="M0,40 C320,80 640,10 960,40 C1200,60 1320,30 1440,50 L1440,80 L0,80 Z" fill="#06080f" />
        </svg>
      </div>

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

      {/* divider: cta(dark) → downloads(light) flip wave */}
      <div className="bq-divider bq-divider-flip bq-divider-to-downloads" aria-hidden>
        <svg viewBox="0 0 1440 80" preserveAspectRatio="none">
          <path d="M0,40 C240,10 520,70 720,40 C920,10 1200,70 1440,30 L1440,80 L0,80 Z" fill="#f5f8ff" />
        </svg>
      </div>

      {/* ══════════ DOWNLOADS ══════════ */}
      <section className="bq-section" id="downloads" style={{ background: 'linear-gradient(180deg, #f5f8ff 0%, #ffffff 100%)', paddingTop: '80px', paddingBottom: '80px' }}>
        <motion.div
          className="bq-container"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={{ visible: { transition: { staggerChildren: 0.12 } } }}
        >
          <motion.div style={{ textAlign: 'center', marginBottom: '48px' }} variants={fadeUp}>
            <h2 className="bq-section-h2" style={{ marginBottom: '12px' }}>
              <Download size={32} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '12px', color: '#007AFF' }} />
              Desktop App
            </h2>
            <p className="bq-section-sub" style={{ maxWidth: '600px', margin: '0 auto' }}>
              Nutze BeeQu als native Desktop-Anwendung für Windows und macOS. 
              Schneller Start, offline verfügbar, automatische Updates.
            </p>
          </motion.div>

          <motion.div 
            style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
              gap: '24px',
              maxWidth: '800px',
              margin: '0 auto'
            }}
            variants={fadeUp}
          >
            {/* Windows */}
            <div style={{
              background: '#ffffff',
              borderRadius: '16px',
              padding: '32px',
              border: '1px solid rgba(0, 122, 255, 0.15)',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
              textAlign: 'center'
            }}>
              <div style={{ 
                width: '64px', 
                height: '64px', 
                margin: '0 auto 20px',
                background: 'linear-gradient(135deg, #0078D4 0%, #0063B1 100%)',
                borderRadius: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '32px',
                color: 'white',
                fontWeight: 'bold'
              }}>
                <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor">
                  <path d="M0,0 L10,0 L10,10 L0,10 Z M11,0 L24,0 L24,13 L11,13 Z M0,11 L10,11 L10,24 L0,24 Z M11,14 L24,14 L24,24 L11,24 Z"/>
                </svg>
              </div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: '700', marginBottom: '8px', color: '#0c1d36' }}>
                Windows
              </h3>
              <p style={{ fontSize: '0.92rem', color: '#6b7c95', marginBottom: '20px' }}>
                Windows 10/11 (64-bit)
              </p>
              <a 
                href="/api/download?platform=windows"
                className="bq-btn bq-primary"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <Download size={16} /> Installer (.exe)
              </a>
              <a 
                href="/api/download?platform=windows-portable"
                target="_blank"
                rel="noopener noreferrer"
                style={{ 
                  display: 'block',
                  marginTop: '12px',
                  fontSize: '0.85rem',
                  color: '#007AFF',
                  textDecoration: 'none'
                }}
              >
                Portable Version →
              </a>
            </div>

            {/* macOS */}
            <div style={{
              background: '#ffffff',
              borderRadius: '16px',
              padding: '32px',
              border: '1px solid rgba(0, 0, 0, 0.1)',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
              textAlign: 'center'
            }}>
              <div style={{ 
                width: '64px', 
                height: '64px', 
                margin: '0 auto 20px',
                background: 'linear-gradient(135deg, #000000 0%, #333333 100%)',
                borderRadius: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '36px',
                color: 'white'
              }}>
                
              </div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: '700', marginBottom: '8px', color: '#0c1d36' }}>
                macOS
              </h3>
              <p style={{ fontSize: '0.92rem', color: '#6b7c95', marginBottom: '20px' }}>
                Intel + Apple Silicon
              </p>
              <button 
                disabled
                className="bq-btn"
                style={{ 
                  width: '100%', 
                  justifyContent: 'center',
                  opacity: 0.5,
                  cursor: 'not-allowed',
                  background: '#e5e7eb',
                  color: '#6b7c95'
                }}
              >
                In Kürze verfügbar
              </button>
              <a 
                href="https://github.com/monzasiz1/todo/releases"
                target="_blank"
                rel="noopener noreferrer"
                style={{ 
                  display: 'block',
                  marginTop: '12px',
                  fontSize: '0.85rem',
                  color: '#6b7c95',
                  textDecoration: 'none'
                }}
              >
                Build-Status anzeigen →
              </a>
            </div>
          </motion.div>

          <motion.div 
            style={{ 
              marginTop: '40px',
              padding: '20px',
              background: 'rgba(0, 122, 255, 0.05)',
              borderRadius: '12px',
              border: '1px solid rgba(0, 122, 255, 0.1)',
              textAlign: 'center'
            }}
            variants={fadeUp}
          >
            <p style={{ fontSize: '0.9rem', color: '#6b7c95', margin: 0 }}>
              <Check size={16} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px', color: '#34C759' }} />
              Keine Anmeldung für Download erforderlich &nbsp;•&nbsp; 
              <Check size={16} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px', color: '#34C759' }} />
              Open Source auf <a href="https://github.com/monzasiz1/todo" target="_blank" rel="noopener noreferrer" style={{ color: '#007AFF', textDecoration: 'none' }}>GitHub</a>
            </p>
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
