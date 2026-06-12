import { Flame, Clock, TrendingUp, TrendingDown, Minus, CalendarCheck, ListTodo, Sparkles } from 'lucide-react';
import './StatisticsDashboard.css';

/**
 * StatisticsDashboard
 *
 * Reiches Produktivitaets-Dashboard (Pro-Feature). Erwartet `advanced` aus
 * /api/profile (stats.advanced) sowie die Basis-`stats`. Wenn keine echten
 * Daten vorliegen (Free-User -> geblurrte PlanGate-Vorschau), werden plausible
 * Demo-Werte gerendert, damit die Vorschau attraktiv aussieht.
 */

const DOW_LABELS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mo..So

const PRIORITY_META = {
  urgent: { label: 'Dringend', color: '#FF3B30' },
  high:   { label: 'Hoch',     color: '#FF9500' },
  medium: { label: 'Mittel',   color: '#007AFF' },
  low:    { label: 'Niedrig',  color: '#34C759' },
};
const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'];

const DEMO = {
  daily: [2, 3, 1, 4, 2, 5, 3, 2, 4, 1, 3, 6, 2, 3, 4, 2, 1, 5, 3, 2, 4, 3, 2, 6, 3, 4, 2, 5, 3, 4]
    .map((c) => ({ d: '', c })),
  weekday: [{ dow: 1, c: 18 }, { dow: 2, c: 22 }, { dow: 3, c: 25 }, { dow: 4, c: 19 }, { dow: 5, c: 21 }, { dow: 6, c: 9 }, { dow: 0, c: 6 }],
  priority: [{ priority: 'urgent', c: 6 }, { priority: 'high', c: 14 }, { priority: 'medium', c: 28 }, { priority: 'low', c: 12 }],
  best_streak: 12, this_month: 34, last_month: 27, on_time: 41, with_due: 48, events: 12, tasks: 60, peak_hour: 9,
};

function pct(n, d) {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}

export default function StatisticsDashboard({ advanced, basic, isPreview = false }) {
  const a = advanced || DEMO;

  // ── 30-Tage-Aktivitaet: auf 30 Tage normalisieren (Luecken auffuellen) ──
  const dailyMap = new Map((a.daily || []).map((r) => [r.d, r.c]));
  let dailyBars;
  if (advanced) {
    dailyBars = [];
    for (let i = 29; i >= 0; i--) {
      const dt = new Date();
      dt.setDate(dt.getDate() - i);
      const key = dt.toISOString().slice(0, 10);
      dailyBars.push(dailyMap.get(key) || 0);
    }
  } else {
    dailyBars = DEMO.daily.map((r) => r.c);
  }
  const dailyMax = Math.max(1, ...dailyBars);
  const total30 = dailyBars.reduce((s, n) => s + n, 0);

  // ── Wochentage ──
  const wdMap = new Map((a.weekday || []).map((r) => [r.dow, r.c]));
  const weekdayBars = DOW_ORDER.map((dow) => ({ dow, c: wdMap.get(dow) || 0 }));
  const weekdayMax = Math.max(1, ...weekdayBars.map((w) => w.c));
  const bestDow = weekdayBars.reduce((best, w) => (w.c > best.c ? w : best), weekdayBars[0]);

  // ── Prioritaeten ──
  const prioMap = new Map((a.priority || []).map((r) => [r.priority, r.c]));
  const prioTotal = PRIORITY_ORDER.reduce((s, k) => s + (prioMap.get(k) || 0), 0);

  // ── KPIs ──
  const monthDelta = a.this_month - a.last_month;
  const onTimeRate = pct(a.on_time, a.with_due);
  const currentStreak = basic?.streak ?? DEMO.best_streak;
  const DeltaIcon = monthDelta > 0 ? TrendingUp : monthDelta < 0 ? TrendingDown : Minus;
  const deltaColor = monthDelta > 0 ? '#34C759' : monthDelta < 0 ? '#FF3B30' : 'var(--text-tertiary)';
  const peakHour = a.peak_hour;

  return (
    <div className={`stats-dash${isPreview ? ' stats-dash--preview' : ''}`}>
      {/* ── KPI-Karten ── */}
      <div className="stats-dash-kpis">
        <div className="stats-dash-kpi">
          <div className="stats-dash-kpi-ic" style={{ background: 'rgba(255,149,0,0.14)', color: '#FF9500' }}><Flame size={16} /></div>
          <div className="stats-dash-kpi-val">{a.best_streak}<span>Tage</span></div>
          <div className="stats-dash-kpi-label">Längste Serie</div>
        </div>
        <div className="stats-dash-kpi">
          <div className="stats-dash-kpi-ic" style={{ background: 'rgba(0,122,255,0.12)', color: '#007AFF' }}><CalendarCheck size={16} /></div>
          <div className="stats-dash-kpi-val">
            {a.this_month}
            <span style={{ color: deltaColor, display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              <DeltaIcon size={12} />{monthDelta > 0 ? `+${monthDelta}` : monthDelta}
            </span>
          </div>
          <div className="stats-dash-kpi-label">Diesen Monat</div>
        </div>
        <div className="stats-dash-kpi">
          <div className="stats-dash-kpi-ic" style={{ background: 'rgba(52,199,89,0.14)', color: '#34C759' }}><Clock size={16} /></div>
          <div className="stats-dash-kpi-val">{onTimeRate}<span>%</span></div>
          <div className="stats-dash-kpi-label">Pünktlich erledigt</div>
        </div>
        <div className="stats-dash-kpi">
          <div className="stats-dash-kpi-ic" style={{ background: 'rgba(88,86,214,0.14)', color: '#5856D6' }}><Sparkles size={16} /></div>
          <div className="stats-dash-kpi-val">{total30}</div>
          <div className="stats-dash-kpi-label">Erledigt (30 T.)</div>
        </div>
      </div>

      {/* ── 30-Tage-Aktivitaet ── */}
      <div className="stats-dash-block">
        <div className="stats-dash-block-head">
          <span>Aktivität · letzte 30 Tage</span>
          {peakHour != null && <span className="stats-dash-block-note">Produktivste Zeit: {String(peakHour).padStart(2, '0')}:00 Uhr</span>}
        </div>
        <div className="stats-dash-spark">
          {dailyBars.map((c, i) => (
            <div
              key={i}
              className="stats-dash-spark-bar"
              style={{ height: `${Math.max(6, (c / dailyMax) * 100)}%`, opacity: c === 0 ? 0.25 : 1 }}
              title={`${c} erledigt`}
            />
          ))}
        </div>
      </div>

      {/* ── Wochentage + Prioritaeten ── */}
      <div className="stats-dash-two">
        <div className="stats-dash-block">
          <div className="stats-dash-block-head">
            <span>Produktivste Tage</span>
            <span className="stats-dash-block-note">Top: {DOW_LABELS[bestDow.dow]}</span>
          </div>
          <div className="stats-dash-weekdays">
            {weekdayBars.map((w) => (
              <div key={w.dow} className="stats-dash-wd">
                <div className="stats-dash-wd-track">
                  <div
                    className={`stats-dash-wd-fill${w.dow === bestDow.dow && w.c > 0 ? ' is-top' : ''}`}
                    style={{ height: `${Math.max(8, (w.c / weekdayMax) * 100)}%` }}
                  />
                </div>
                <span className="stats-dash-wd-label">{DOW_LABELS[w.dow]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="stats-dash-block">
          <div className="stats-dash-block-head"><span>Nach Priorität</span></div>
          <div className="stats-dash-prio-bar">
            {PRIORITY_ORDER.map((k) => {
              const c = prioMap.get(k) || 0;
              const w = prioTotal ? (c / prioTotal) * 100 : 0;
              if (w === 0) return null;
              return <div key={k} className="stats-dash-prio-seg" style={{ width: `${w}%`, background: PRIORITY_META[k].color }} title={`${PRIORITY_META[k].label}: ${c}`} />;
            })}
          </div>
          <div className="stats-dash-prio-legend">
            {PRIORITY_ORDER.map((k) => {
              const c = prioMap.get(k) || 0;
              if (!c) return null;
              return (
                <span key={k} className="stats-dash-prio-item">
                  <span className="stats-dash-prio-dot" style={{ background: PRIORITY_META[k].color }} />
                  {PRIORITY_META[k].label} <strong>{c}</strong>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Aufgaben vs. Termine ── */}
      <div className="stats-dash-split">
        <div className="stats-dash-split-row">
          <span className="stats-dash-split-label"><ListTodo size={13} /> Aufgaben</span>
          <span className="stats-dash-split-label" style={{ justifyContent: 'flex-end' }}>Termine <CalendarCheck size={13} /></span>
        </div>
        <div className="stats-dash-split-bar">
          <div className="stats-dash-split-tasks" style={{ width: `${pct(a.tasks, a.tasks + a.events)}%` }} />
          <div className="stats-dash-split-events" style={{ width: `${pct(a.events, a.tasks + a.events)}%` }} />
        </div>
        <div className="stats-dash-split-row">
          <strong>{a.tasks}</strong>
          <strong>{a.events}</strong>
        </div>
      </div>
    </div>
  );
}
