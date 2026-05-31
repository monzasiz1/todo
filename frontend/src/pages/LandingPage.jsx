import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
  { icon: Sparkles,    color: '#007AFF', bg: 'rgba(0,122,255,0.1)',   title: 'KI-Texteingabe',         desc: 'Schreibe einen Satz wie „Sprint-Review Freitag 10 Uhr, hohe Prio" — BeeQu erkennt Titel, Datum, Uhrzeit, Kategorie und Priorität automatisch und legt die Aufgabe an.', plan: 'Alle Pläne', wide: true },
  { icon: CalendarDays,color: '#5856D6', bg: 'rgba(88,86,214,0.1)',   title: 'Ultra-Kalender',         desc: 'Wochen- und Monatsansicht mit Drag & Drop direkt im Raster, Mehrtages-Events und Gruppen-Kalender als zuschaltbare Ebenen.',                                              plan: 'Alle Pläne' },
  { icon: MessageSquare,color:'#34C759', bg: 'rgba(52,199,89,0.1)',   title: 'Team-Chat mit Events',  desc: 'Echtzeit-Gruppenchat: Termine aus Text-Nachrichten werden automatisch als Event-Karten erkannt, Aufgaben kannst du direkt in den Chat teilen.',                              plan: 'Team' },
  { icon: FolderKanban,color: '#FF9500', bg: 'rgba(255,149,0,0.1)',   title: 'Geteilte Gruppen-Aufgaben', desc: 'Gruppen für Familie, WG oder Team. Aufgaben teilen, gemeinsam abhaken, Fortschritt auf dem Gruppen-Board sehen.',                                                      plan: 'Alle Pläne' },
  { icon: Repeat,      color: '#FF375F', bg: 'rgba(255,55,95,0.1)',   title: 'Wiederkehrende Tasks',  desc: 'Täglich, wöchentlich, monatlich oder jährlich — einmal angelegt, BeeQu erstellt die nächste Instanz automatisch.',                                                     plan: 'Pro & Team' },
  { icon: Timer,       color: '#AF52DE', bg: 'rgba(175,82,222,0.1)',  title: 'Focus-Timer',           desc: 'Vordefinierte Sessions: 5, 10, 15, 25 oder 45 Minuten. Läuft im Hintergrund weiter und benachrichtigt dich am Ende.',                                                       plan: 'Alle Pläne' },
  { icon: FileText,    color: '#00C7BE', bg: 'rgba(0,199,190,0.1)',   title: 'Notizen-Board',         desc: 'Sticky-Notes frei auf dem Board platzieren, Farben wählen, Termine verknüpfen und mit Freunden teilen (Lesen oder Bearbeiten).',                                            plan: 'Alle Pläne' },
  { icon: BarChart2,   color: '#FF9500', bg: 'rgba(255,149,0,0.1)',   title: 'Statistiken & Insights',desc: 'Tagesfortschritt, smarte Hinweise und Wochenüberblick direkt auf dem Dashboard — ohne extra Auswertungs-Seite.',                                                            plan: 'Alle Pläne' },
  { icon: Paperclip,   color: '#FF3B30', bg: 'rgba(255,59,48,0.1)',   title: 'Dateianhänge',          desc: 'Dokumente, Bilder und PDFs direkt an Aufgaben heften — mit Vorschau und Download in der Task-Detailansicht.',                                                                plan: 'Pro & Team' },
  { icon: Bell,        color: '#5856D6', bg: 'rgba(88,86,214,0.1)',   title: 'Smarte Erinnerungen',   desc: 'Push-Benachrichtigungen genau dann, wenn es zählt — auf Web, Desktop-App (Electron) und installierter PWA.',                                                                plan: 'Alle Pläne' },
  { icon: MoveDiagonal,color: '#007AFF', bg: 'rgba(0,122,255,0.1)',   title: 'ICS-Import & -Export',  desc: 'Termine aus Google Calendar, Apple Kalender oder Outlook als .ics importieren und eigene Aufgaben/Termine wieder exportieren.',                                              plan: 'Pro & Team' },
  { icon: Smartphone,  color: '#34C759', bg: 'rgba(52,199,89,0.1)',   title: 'PWA — überall installierbar', desc: 'iOS, Android, macOS, Windows. Offline-fähig, Push-Benachrichtigungen, Home-Screen-Icon — kein App-Store nötig.',                                                       plan: 'Alle Pläne' },
];

// Echte App-Screenshots — kein Mock. Liegen unter frontend/public/bilder/.
const heroShots = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    src: '/bilder/dashboard.png',
    eyebrow: '01 · KI-Eingabe',
    headline: 'Tippen statt klicken.',
    sub: 'Ein Satz reicht — Datum, Uhrzeit, Kategorie und Priorität werden automatisch erkannt.',
    icon: LayoutDashboard,
  },
  {
    id: 'aufgaben',
    label: 'Aufgaben',
    src: '/bilder/aufgaben.png',
    eyebrow: '02 · Heute · Morgen · Später',
    headline: 'Alle Aufgaben. Nichts vergessen.',
    sub: 'Filter nach Priorität, gruppiert nach Datum, durchsuchbar — direkt aus dem Dashboard.',
    icon: ListTodo,
  },
  {
    id: 'kalender',
    label: 'Kalender',
    src: '/bilder/kalender.png',
    eyebrow: '03 · Monats- & Wochen-Ansicht',
    headline: 'Termine im Griff.',
    sub: 'Eigene und geteilte Kalender im Wechsel. Mehrtages-Events, Drag & Drop direkt im Raster.',
    icon: CalendarDays,
  },
  {
    id: 'gruppen',
    label: 'Gruppen',
    src: '/bilder/gruppen.png',
    eyebrow: '04 · Collaboration Space',
    headline: 'Familie. Team. WG.',
    sub: 'Mitglieder verwalten, Rollen vergeben, Aufgaben gemeinsam abarbeiten.',
    icon: UsersRound,
  },
];

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

/* small reusable bits for the dark "app screenshot" mock */
function MockFrame({ children, label }) {
  return (
    <div className="bq-mock">
      <div className="bq-mock-chrome">
        <span className="bq-mock-dot" style={{ background: '#FF5F57' }} />
        <span className="bq-mock-dot" style={{ background: '#FEBC2E' }} />
        <span className="bq-mock-dot" style={{ background: '#28C840' }} />
        <span className="bq-mock-label">{label || 'BeeQu'}</span>
      </div>
      <div className="bq-mock-body">{children}</div>
    </div>
  );
}

function MockTaskCard({ title, kind = 'AUFGABE', day = '21', mon = 'MAI', meta, badge, chips }) {
  return (
    <div className="bq-mk-task">
      <div className="bq-mk-task-date">
        <span className="bq-mk-task-mon">{mon}</span>
        <span className="bq-mk-task-day">{day}</span>
      </div>
      <div className="bq-mk-task-main">
        <div className="bq-mk-task-head">
          <strong>{title}</strong>
          <span className={`bq-mk-badge bq-mk-badge-${kind.toLowerCase()}`}>{kind}</span>
          {badge}
        </div>
        {chips && <div className="bq-mk-chip-row">{chips}</div>}
        {meta && <div className="bq-mk-task-meta">{meta}</div>}
      </div>
    </div>
  );
}

function FeatureDemo({ feature }) {
  const { title, color, bg, icon: Icon } = feature;

  if (title === 'KI-Texteingabe') {
    return (
      <MockFrame label="BeeQu · Dashboard">
        <div className="bq-mk-greet">Guten Tag <span>👋</span></div>
        <div className="bq-mk-sub">Was steht heute an?</div>
        <div className="bq-mk-ai-input">
          <span className="bq-mk-ai-sparkle"><Sparkles size={16} /></span>
          <span className="bq-mk-ai-placeholder">„Sprint-Review Freitag 10 Uhr, hohe Prio"<span className="bq-mk-caret">|</span></span>
          <button className="bq-mk-ai-send" aria-hidden><ArrowRight size={16} /></button>
        </div>
        <div className="bq-mk-ai-hints">
          💡 <em>„Freitag Reinigung 18 Uhr"</em> · <em>„Lösche Zahnarzt"</em> · <em>„Wann kann ich zum Sport?"</em>
        </div>
        <div className="bq-mk-ai-result">
          <span className="bq-mk-chip bq-mk-chip-blue">Freitag</span>
          <span className="bq-mk-chip bq-mk-chip-blue">10:00</span>
          <span className="bq-mk-chip bq-mk-chip-violet">Produkt</span>
          <span className="bq-mk-chip bq-mk-chip-red">Hoch</span>
        </div>
      </MockFrame>
    );
  }

  if (title === 'Ultra-Kalender') {
    const events = {
      1:  { label: 'Tag der Arbeit',   tone: 'red' },
      14: { label: 'Christi Himmelfahrt', tone: 'red' },
      20: { label: 'Zimmer aufräumen', tone: 'blue' },
      21: { label: '15:00 Tanzkurs',   tone: 'red' },
      25: { label: 'Pfingstmontag',    tone: 'red' },
      26: { label: '16:25 Zahnarzt',   tone: 'blue' },
    };
    const days = [];
    // leading: April 27-30
    for (let d = 27; d <= 30; d++) days.push({ n: d, dim: true });
    for (let d = 1; d <= 17; d++) days.push({ n: d, ev: events[d] });
    return (
      <MockFrame label="BeeQu · Kalender">
        <div className="bq-mk-cal-head">
          <strong>Mai 2026</strong>
          <div className="bq-mk-cal-tabs">
            <span className="bq-mk-cal-tab bq-mk-cal-tab-active">Monat</span>
            <span className="bq-mk-cal-tab">Woche</span>
          </div>
        </div>
        <div className="bq-mk-cal-filters">
          <span className="bq-mk-cal-filter bq-mk-cal-filter-active">👤 Mein</span>
          <span className="bq-mk-cal-filter">👪 Familie</span>
        </div>
        <div className="bq-mk-cal-grid">
          {['MO','DI','MI','DO','FR','SA','SO'].map((d) => (
            <div key={d} className="bq-mk-cal-dh">{d}</div>
          ))}
          {days.map((c, i) => (
            <div key={i} className={`bq-mk-cal-cell${c.dim ? ' dim' : ''}`}>
              <span className={`bq-mk-cal-num${c.ev?.tone === 'red' ? ' is-holiday' : ''}`}>{c.n}</span>
              {c.ev && <span className={`bq-mk-cal-event bq-mk-cal-event-${c.ev.tone}`}>{c.ev.label}</span>}
            </div>
          ))}
        </div>
      </MockFrame>
    );
  }

  if (title === 'Team-Chat mit Events') {
    return (
      <MockFrame label="BeeQu · Familie">
        <div className="bq-mk-chat">
          <div className="bq-mk-chat-msg">
            <span className="bq-mk-chat-av" style={{ background: '#FF9500' }}>S</span>
            <div className="bq-mk-chat-bubble">
              <strong>Sarah</strong>
              <span>Können wir Freitag um 10 zur Sprint-Review?</span>
            </div>
          </div>
          <div className="bq-mk-chat-msg bq-mk-chat-msg-me">
            <div className="bq-mk-chat-bubble bq-mk-chat-bubble-me">
              <span>Passt — leg ich gleich an 👌</span>
            </div>
            <span className="bq-mk-chat-av" style={{ background: '#4DA3FF' }}>K</span>
          </div>
          <div className="bq-mk-chat-msg">
            <span className="bq-mk-chat-av" style={{ background: '#34C759' }}>M</span>
            <div className="bq-mk-chat-event">
              <div className="bq-mk-chat-event-row">
                <CalendarDays size={14} /> <strong>Sprint-Review</strong>
                <span className="bq-mk-badge bq-mk-badge-termin">TERMIN</span>
              </div>
              <div className="bq-mk-chat-event-meta">Fr 10:00 – 11:00 · auto erkannt</div>
              <div className="bq-mk-chat-event-actions">
                <span className="bq-mk-mini-btn">Übernehmen</span>
                <span className="bq-mk-mini-btn ghost">Ignorieren</span>
              </div>
            </div>
          </div>
        </div>
      </MockFrame>
    );
  }

  if (title === 'Geteilte Gruppen-Aufgaben') {
    return (
      <MockFrame label="BeeQu · Gruppe">
        <div className="bq-mk-grp-head">
          <span className="bq-mk-grp-emoji">👪</span>
          <div>
            <strong>Familie</strong>
            <div className="bq-mk-grp-sub"><span className="bq-mk-chip-mini">Mitglied</span> COLLABORATION SPACE</div>
          </div>
        </div>
        <div className="bq-mk-grp-stats">
          <div className="bq-mk-grp-stat"><span>MITGLIEDER</span><strong>6</strong></div>
          <div className="bq-mk-grp-stat"><span>AKTIVE AUFGABEN</span><strong>4</strong></div>
          <div className="bq-mk-grp-stat"><span>ABGESCHLOSSEN</span><strong style={{ color: '#34C759' }}>68%</strong></div>
          <div className="bq-mk-grp-stat"><span>ADMINS</span><strong style={{ color: '#FF375F' }}>1</strong></div>
        </div>
        <div className="bq-mk-grp-members">
          {[
            { i: 'M', c: '#7C4DFF', n: 'Max Mustermann' },
            { i: 'K', c: '#4DA3FF', n: 'Kira Mustermann (Du)' },
            { i: 'I', c: '#34C759', n: 'Iris Mustermann' },
            { i: 'O', c: '#007AFF', n: 'Oskar Mustermann' },
          ].map((m) => (
            <div key={m.n} className="bq-mk-grp-member">
              <span className="bq-mk-grp-av" style={{ background: m.c }}>{m.i}</span>
              <span>{m.n}</span>
            </div>
          ))}
        </div>
      </MockFrame>
    );
  }

  if (title === 'Wiederkehrende Tasks') {
    return (
      <MockFrame label="BeeQu · Aufgaben">
        <MockTaskCard
          title="Konzertprobe" kind="TERMIN" day="20" mon="MAI"
          chips={<span className="bq-mk-chip bq-mk-chip-blue"><Repeat size={11} /> Wöchentlich</span>}
          meta={<>📅 Heute · 🕐 19:00 – 21:00 Uhr</>}
        />
        <MockTaskCard
          title="Standup" kind="TERMIN" day="21" mon="MAI"
          chips={<span className="bq-mk-chip bq-mk-chip-blue"><Repeat size={11} /> Täglich · 09:00</span>}
          meta={<>Morgen · 09:00 – 09:15 Uhr</>}
        />
        <MockTaskCard
          title="Monatsbericht" kind="AUFGABE" day="31" mon="MAI"
          chips={<span className="bq-mk-chip bq-mk-chip-violet"><Repeat size={11} /> Letzter Tag des Monats</span>}
          meta={<>31. Mai · ganztägig</>}
        />
      </MockFrame>
    );
  }

  if (title === 'Focus-Timer') {
    return (
      <MockFrame label="BeeQu · Fokus">
        <div className="bq-mk-focus-bar">
          <div className="bq-mk-focus-ico"><Timer size={20} /></div>
          <div className="bq-mk-focus-text">
            <strong>Fokus-Timer</strong>
            <span>Klick zum Starten · 5–45 min</span>
          </div>
        </div>
        <div className="bq-mk-focus-presets">
          {[5, 10, 15, 25, 45].map((m, i) => (
            <span key={m} className={`bq-mk-focus-chip${i === 3 ? ' is-active' : ''}`}>{m} min</span>
          ))}
        </div>
        <div className="bq-mk-focus-ring">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
            <circle cx="50" cy="50" r="44" fill="none" stroke="#AF52DE" strokeWidth="6"
              strokeDasharray="276" strokeDashoffset="92" strokeLinecap="round"
              transform="rotate(-90 50 50)" />
          </svg>
          <div className="bq-mk-focus-ring-txt">
            <strong>17:42</strong>
            <span>von 25:00 · Fokus</span>
          </div>
        </div>
      </MockFrame>
    );
  }

  if (title === 'Notizen-Board') {
    return (
      <MockFrame label="BeeQu · Notes">
        <div className="bq-mk-notes-head">
          <strong>Notizen-Board</strong>
          <span className="bq-mk-chip-mini">+ Neue Note</span>
        </div>
        <div className="bq-mk-notes-board">
          <div className="bq-mk-note" style={{ background: '#FFE066', transform: 'rotate(-2deg)' }}>
            <div className="bq-mk-note-title">Einkauf Wochenende</div>
            <div className="bq-mk-note-body">Brot · Eier · Milch · Kaffee</div>
            <div className="bq-mk-note-foot">📌 angeheftet</div>
          </div>
          <div className="bq-mk-note" style={{ background: '#BFDBFE', transform: 'rotate(1.5deg)' }}>
            <div className="bq-mk-note-title">Ideen Geburtstag</div>
            <div className="bq-mk-note-body">Picknick im Park, Karaoke abends</div>
            <div className="bq-mk-note-foot bq-mk-note-shared">👥 mit Sarah · Bearbeiten</div>
          </div>
          <div className="bq-mk-note" style={{ background: '#BBF7D0', transform: 'rotate(-0.8deg)' }}>
            <div className="bq-mk-note-title">Urlaub planen</div>
            <div className="bq-mk-note-body">Flüge prüfen, Pässe checken</div>
            <div className="bq-mk-note-foot bq-mk-note-shared">👥 mit Max · Lesen</div>
          </div>
          <div className="bq-mk-note" style={{ background: '#FBCFE8', transform: 'rotate(2deg)' }}>
            <div className="bq-mk-note-title">Buch-Empfehlungen</div>
            <div className="bq-mk-note-body">Atomic Habits, Deep Work…</div>
            <div className="bq-mk-note-foot">privat</div>
          </div>
        </div>
      </MockFrame>
    );
  }

  if (title === 'Statistiken & Insights') {
    return (
      <MockFrame label="BeeQu · Dashboard">
        <div className="bq-mk-insights-head">
          <span><span className="bq-mk-bullet" style={{ background: '#4DA3FF' }} /> Fokus heute</span>
          <div className="bq-mk-insights-pills">
            <span className="bq-mk-chip-mini">Heute: 1</span>
            <span className="bq-mk-chip-mini">Überfällig: 0</span>
            <span className="bq-mk-chip-mini">Woche: 0%</span>
          </div>
        </div>
        <div className="bq-mk-focus-bar">
          <div className="bq-mk-focus-ico"><Timer size={20} /></div>
          <div className="bq-mk-focus-text">
            <strong>Fokus-Timer</strong>
            <span>Klick zum Starten · 5–45 min</span>
          </div>
        </div>
        <div className="bq-mk-hint">
          <span className="bq-mk-hint-tag" style={{ color: '#4DA3FF' }}>⚡ NACHMITTAG</span>
          <div>Nachmittag läuft – 1 Aufgabe noch offen. Konzentriere dich auf eine Aufgabe auf einmal.</div>
        </div>
        <div className="bq-mk-hint">
          <span className="bq-mk-hint-tag" style={{ color: '#34C759' }}>✓ HEUTE FORTSCHRITT</span>
          <div>1 Aufgaben heute geplant. Starte mit der ersten — Momentum entsteht durch Action.</div>
        </div>
        <div className="bq-mk-hint">
          <span className="bq-mk-hint-tag" style={{ color: '#AF52DE' }}>📅 TERMINE</span>
          <div>6,2h frei, 2 Termine bald. Plane Puffer davor und danach.</div>
        </div>
      </MockFrame>
    );
  }

  if (title === 'Dateianhänge') {
    return (
      <MockFrame label="BeeQu · Task-Detail">
        <div className="bq-mk-task-head" style={{ marginBottom: 4 }}>
          <strong>Briefing Q2 fertigstellen</strong>
          <span className="bq-mk-badge bq-mk-badge-aufgabe">AUFGABE</span>
        </div>
        <div className="bq-mk-task-meta" style={{ marginBottom: 12 }}>📅 Heute · 🕐 14:00 · 🔵 Mittel</div>
        <div className="bq-mk-att-head">📎 Anhänge <span>3</span></div>
        <div className="bq-mk-att-list">
          <div className="bq-mk-att">
            <span className="bq-mk-att-ico" style={{ background: 'rgba(255,59,48,0.18)', color: '#FF6B6B' }}>PDF</span>
            <div><div>Briefing-Q2.pdf</div><small>2,4 MB · vor 2 Std.</small></div>
          </div>
          <div className="bq-mk-att">
            <span className="bq-mk-att-ico" style={{ background: 'rgba(0,199,190,0.18)', color: '#5EEAD4' }}>JPG</span>
            <div><div>moodboard.jpg</div><small>1,1 MB · gestern</small></div>
          </div>
          <div className="bq-mk-att">
            <span className="bq-mk-att-ico" style={{ background: 'rgba(88,86,214,0.22)', color: '#8B87FF' }}>DOC</span>
            <div><div>Agenda-Meeting.docx</div><small>340 KB · gestern</small></div>
          </div>
        </div>
      </MockFrame>
    );
  }

  if (title === 'Smarte Erinnerungen') {
    return (
      <MockFrame label="BeeQu · System">
        <div className="bq-mk-toast">
          <div className="bq-mk-toast-icon">
            <Bell size={18} />
          </div>
          <div className="bq-mk-toast-body">
            <div className="bq-mk-toast-head">
              <strong>BeeQu</strong>
              <span>jetzt</span>
            </div>
            <div className="bq-mk-toast-title">Sprint-Review startet in 15 Min</div>
            <div className="bq-mk-toast-sub">Fr · 10:00 – 11:00 · Produkt</div>
          </div>
        </div>
        <div className="bq-mk-toast">
          <div className="bq-mk-toast-icon" style={{ background: 'rgba(175,82,222,0.18)', color: '#C58CF7' }}>
            <Timer size={18} />
          </div>
          <div className="bq-mk-toast-body">
            <div className="bq-mk-toast-head">
              <strong>Fokus beendet</strong>
              <span>vor 1 Min</span>
            </div>
            <div className="bq-mk-toast-title">25 Min Deep Work geschafft 🎉</div>
            <div className="bq-mk-toast-sub">Pause oder weiter?</div>
          </div>
        </div>
      </MockFrame>
    );
  }

  if (title === 'ICS-Import & -Export') {
    return (
      <MockFrame label="BeeQu · Kalender importieren">
        <div className="bq-mk-imp-head">
          <strong>Kalender importieren</strong>
          <span className="bq-mk-chip-mini">.ics</span>
        </div>
        <div className="bq-mk-imp-drop">
          <Download size={20} />
          <div><strong>Datei hierher ziehen</strong><small>oder Datei auswählen</small></div>
        </div>
        <div className="bq-mk-imp-sources">
          <div className="bq-mk-imp-src"><span>📅</span> Google Calendar</div>
          <div className="bq-mk-imp-src"><span>📅</span> Apple Kalender</div>
          <div className="bq-mk-imp-src"><span>📅</span> Outlook / Office 365</div>
        </div>
        <div className="bq-mk-imp-export">
          <span>Eigene Aufgaben exportieren</span>
          <span className="bq-mk-mini-btn">beequ.ics ↓</span>
        </div>
      </MockFrame>
    );
  }

  if (title === 'PWA — überall installierbar') {
    return (
      <MockFrame label="BeeQu · überall">
        <div className="bq-mk-devices">
          <div className="bq-mk-dev bq-mk-dev-laptop">
            <div className="bq-mk-dev-screen">
              <div className="bq-mk-dev-bar"><span /><span /><span /></div>
              <div className="bq-mk-dev-rows"><i /><i /><i /><i /></div>
            </div>
            <div className="bq-mk-dev-foot" />
          </div>
          <div className="bq-mk-dev bq-mk-dev-phone">
            <div className="bq-mk-dev-screen">
              <div className="bq-mk-dev-notch" />
              <div className="bq-mk-dev-rows"><i /><i /><i /></div>
            </div>
          </div>
        </div>
        <div className="bq-mk-dev-labels">
          <span className="bq-mk-chip-mini">iOS</span>
          <span className="bq-mk-chip-mini">Android</span>
          <span className="bq-mk-chip-mini">macOS</span>
          <span className="bq-mk-chip-mini">Windows</span>
          <span className="bq-mk-chip-mini">Web</span>
        </div>
      </MockFrame>
    );
  }

  // Fallback
  return (
    <MockFrame>
      <div className="bq-demo-center" style={{ padding: 30 }}>
        <div className="bq-demo-bell" style={{ background: bg, borderColor: color, color }}>
          <Icon size={28} />
        </div>
      </div>
    </MockFrame>
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
  const trinityStageRef = useRef(null);
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
  const [heroShotIdx, setHeroShotIdx] = useState(0);
  const [heroShotPaused, setHeroShotPaused] = useState(false);
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

  // Auto-Rotation der Hero-Screenshots; pausiert beim Hover über dem Frame.
  useEffect(() => {
    if (heroShotPaused) return undefined;
    const t = setInterval(() => {
      setHeroShotIdx((i) => (i + 1) % heroShots.length);
    }, 5500);
    return () => clearInterval(t);
  }, [heroShotPaused]);

  // Landing ist eine Marketing-Surface und folgt NICHT der App-Theme-Wahl.
  // Wir erzwingen light, solange diese Seite gemountet ist — ohne localStorage
  // zu verändern, damit die Nutzer-Präferenz nach dem Login erhalten bleibt.
  useEffect(() => {
    const root = document.documentElement;
    const prevTheme = root.getAttribute('data-theme');
    const prevColorScheme = root.style.colorScheme;
    const force = () => {
      if (root.getAttribute('data-theme') !== 'light') {
        root.setAttribute('data-theme', 'light');
      }
      if (root.style.colorScheme !== 'light') {
        root.style.colorScheme = 'light';
      }
    };
    force();
    // Falls theme.js (system-Listener) data-theme erneut setzt: zurückbiegen.
    const obs = new MutationObserver(force);
    obs.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      obs.disconnect();
      if (prevTheme === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', prevTheme);
      root.style.colorScheme = prevColorScheme;
    };
  }, []);

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

        {/* ── Bee-Mascots (Brand-Figuren, Spond-Style) ── */}
        <div className="bq-bee-swarm" aria-hidden="true">
          <BeeMascot variant="blue"   size={56} pose="happy" className="bq-bee bq-bee-1" />
          <BeeMascot variant="purple" size={38} pose="wink"  className="bq-bee bq-bee-2" />
          <BeeMascot variant="gold"   size={48} pose="happy" className="bq-bee bq-bee-3" />
          <BeeMascot variant="blue"   size={32} pose="happy" className="bq-bee bq-bee-4" />
          <BeeMascot variant="purple" size={44} pose="happy" className="bq-bee bq-bee-5" />
          <BeeMascot variant="gold"   size={30} pose="wink"  className="bq-bee bq-bee-6" />
        </div>

        {/* copy */}
        <motion.div
          className="bq-hero-copy"
          initial="hidden" animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.09 } } }}
        >
          {/* Grosse Hero-Bee als visueller Anker ueber der Headline */}
          <motion.div className="bq-hero-bee-anchor" variants={fadeUp}>
            <BeeMascot variant="gold" size={120} pose="happy" className="bq-hero-bee-main" />
          </motion.div>

          <motion.div className="bq-eyebrow bq-eyebrow-bee" variants={fadeUp}>
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

        {/* ── Trinity 3D-Carousel ── */}
        <motion.div
          className="bq-trinity-wrap"
          initial={{ opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.35, ease }}
        >
          {/* Rotating headline above the carousel */}
          <div className="bq-trinity-caption" aria-live="polite">
            <AnimatePresence mode="wait">
              <motion.div
                key={`cap-${heroShots[heroShotIdx].id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.36, ease }}
                className="bq-trinity-caption-inner"
              >
                <span className="bq-trinity-eyebrow">{heroShots[heroShotIdx].eyebrow}</span>
                <h3 className="bq-trinity-headline">{heroShots[heroShotIdx].headline}</h3>
                <p className="bq-trinity-sub">{heroShots[heroShotIdx].sub}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Stage with 3 cards in 3D */}
          <div
            ref={trinityStageRef}
            className="bq-trinity-stage"
            onMouseEnter={() => setHeroShotPaused(true)}
            onMouseLeave={() => {
              setHeroShotPaused(false);
              if (trinityStageRef.current) {
                trinityStageRef.current.style.setProperty('--bq-tx', '0deg');
                trinityStageRef.current.style.setProperty('--bq-ty', '0deg');
              }
            }}
            onMouseMove={(e) => {
              const el = trinityStageRef.current;
              if (!el) return;
              const r = el.getBoundingClientRect();
              const px = (e.clientX - r.left) / r.width - 0.5;
              const py = (e.clientY - r.top) / r.height - 0.5;
              el.style.setProperty('--bq-tx', `${(-py * 4).toFixed(2)}deg`);
              el.style.setProperty('--bq-ty', `${(px * 5).toFixed(2)}deg`);
            }}
          >
            <div className="bq-trinity-spot bq-trinity-spot-a" aria-hidden />
            <div className="bq-trinity-spot bq-trinity-spot-b" aria-hidden />
            <div className="bq-trinity-floor" aria-hidden />

            {heroShots.map((shot, i) => {
              const total = heroShots.length;
              const rel = ((i - heroShotIdx) + total) % total;
              let slot = 'hidden';
              if (rel === 0) slot = 'active';
              else if (rel === 1) slot = 'next';
              else if (rel === total - 1) slot = 'prev';

              const positions = {
                active: { x: '0%', y: '0%', scale: 1, rotateY: 0, opacity: 1, filter: 'blur(0px)' },
                prev:   { x: '-62%', y: '4%', scale: 0.72, rotateY: 32, opacity: 0.55, filter: 'blur(1.5px)' },
                next:   { x: '62%',  y: '4%', scale: 0.72, rotateY: -32, opacity: 0.55, filter: 'blur(1.5px)' },
                hidden: { x: '0%',   y: '0%', scale: 0.5, rotateY: 0, opacity: 0,   filter: 'blur(8px)' },
              };
              const zIndex = slot === 'active' ? 3 : slot === 'hidden' ? 0 : 2;

              return (
                <motion.button
                  key={shot.id}
                  type="button"
                  className={`bq-trinity-card bq-trinity-card-${slot}`}
                  style={{ zIndex, pointerEvents: slot === 'hidden' ? 'none' : 'auto' }}
                  animate={positions[slot]}
                  transition={{ type: 'spring', stiffness: 200, damping: 28, mass: 0.9 }}
                  onClick={() => setHeroShotIdx(i)}
                  aria-label={slot === 'active' ? `${shot.label} — aktuelle Ansicht` : `Wechsle zu ${shot.label}`}
                  aria-current={slot === 'active'}
                >
                  <div className="bq-trinity-chrome">
                    <span className="bq-dot" style={{ background: '#FF5F57' }} />
                    <span className="bq-dot" style={{ background: '#FFBD2E' }} />
                    <span className="bq-dot" style={{ background: '#28CA41' }} />
                    <span className="bq-trinity-url">
                      <span className="bq-trinity-url-host">beequ.app</span>
                      <span className="bq-trinity-url-sep">/</span>
                      <span className="bq-trinity-url-path">{shot.label.toLowerCase()}</span>
                    </span>
                    {slot === 'active' && (
                      <span className="bq-trinity-live">
                        <span className="bq-trinity-live-dot" />
                        Live
                      </span>
                    )}
                  </div>
                  <div className="bq-trinity-screen">
                    <img
                      src={shot.src}
                      alt={`BeeQu — ${shot.label}`}
                      draggable={false}
                      loading={slot === 'active' ? 'eager' : 'lazy'}
                    />
                    {slot === 'active' && (
                      <>
                        <div className="bq-trinity-shine" aria-hidden />
                        <div className="bq-trinity-progress" aria-hidden>
                          <div
                            key={shot.id + (heroShotPaused ? '-p' : '')}
                            className={`bq-trinity-progress-bar${heroShotPaused ? ' is-paused' : ''}`}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </motion.button>
              );
            })}

            {/* Navigation arrows (desktop) */}
            <button
              type="button"
              className="bq-trinity-arrow bq-trinity-arrow-prev"
              aria-label="Vorherige Ansicht"
              onClick={() => setHeroShotIdx((heroShotIdx - 1 + heroShots.length) % heroShots.length)}
            >
              <ArrowRight size={18} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <button
              type="button"
              className="bq-trinity-arrow bq-trinity-arrow-next"
              aria-label="Nächste Ansicht"
              onClick={() => setHeroShotIdx((heroShotIdx + 1) % heroShots.length)}
            >
              <ArrowRight size={18} />
            </button>
          </div>

          {/* Progress segments */}
          <div className="bq-trinity-segs" role="tablist" aria-label="App-Vorschau wechseln">
            {heroShots.map((shot, i) => {
              const Icon = shot.icon;
              const active = i === heroShotIdx;
              return (
                <button
                  key={shot.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`bq-trinity-seg${active ? ' active' : ''}`}
                  onClick={() => setHeroShotIdx(i)}
                >
                  <span className="bq-trinity-seg-icon"><Icon size={14} /></span>
                  <span className="bq-trinity-seg-label">{shot.label}</span>
                  <span className="bq-trinity-seg-rail">
                    {active && (
                      <span
                        key={`fill-${shot.id}-${heroShotPaused ? 'p' : 'r'}`}
                        className={`bq-trinity-seg-fill${heroShotPaused ? ' is-paused' : ''}`}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </motion.div>
      </section>

      {/* divider: hero (dark) → strip (light) — sanfter Wave-Übergang */}
      <div className="bq-divider bq-divider-to-strip" aria-hidden>
        <svg viewBox="0 0 1440 110" preserveAspectRatio="none">
          <path
            d="M0,72 C220,12 480,98 720,52 C960,8 1200,92 1440,38 L1440,110 L0,110 Z"
            fill="#fafafa"
          />
        </svg>
      </div>

      {/* ══════════ STRIP ══════════ */}
      <div className="bq-strip">
        <div className="bq-strip-inner">
          {[
            { icon: Sparkles,    text: 'KI versteht natürliche Sprache' },
            { icon: CalendarDays,text: 'Drag & Drop im Kalender' },
            { icon: MessageSquare,text:'Team-Chat mit Events' },
            { icon: FolderKanban,text: 'Geteilte Gruppen-Aufgaben' },
            { icon: Timer,       text: 'Focus-Timer mit Push-Alert' },
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
              background: 'var(--card-solid, #ffffff)',
              color: 'var(--text, #1C1C1E)',
              borderRadius: '16px',
              padding: '32px',
              border: '1px solid var(--border, rgba(0, 122, 255, 0.15))',
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
              <h3 style={{ fontSize: '1.3rem', fontWeight: '700', marginBottom: '8px', color: 'var(--text, #0c1d36)' }}>
                Windows
              </h3>
              <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary, #6b7c95)', marginBottom: '20px' }}>
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
              background: 'var(--card-solid, #ffffff)',
              color: 'var(--text, #1C1C1E)',
              borderRadius: '16px',
              padding: '32px',
              border: '1px solid var(--border, rgba(0, 0, 0, 0.1))',
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
              <h3 style={{ fontSize: '1.3rem', fontWeight: '700', marginBottom: '8px', color: 'var(--text, #0c1d36)' }}>
                macOS
              </h3>
              <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary, #6b7c95)', marginBottom: '20px' }}>
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
                  color: 'var(--text-secondary, #6b7c95)'
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
                  color: 'var(--text-secondary, #6b7c95)',
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
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary, #6b7c95)', margin: 0 }}>
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
