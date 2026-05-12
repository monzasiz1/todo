import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PLANS } from '../lib/plans';
import { usePlan } from '../hooks/usePlan';
import { api } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const PLAN_COLORS = { free: '#8E8E93', pro: '#007AFF', team: '#5856D6' };

const PLAN_BANNERS = {
  free:  { gradient: 'linear-gradient(135deg, #E5E5EA 0%, #D1D1D6 100%)', icon: '✓', iconBg: '#fff', iconColor: '#34C759', textColor: '#1c1c1e', subColor: '#6e6e73' },
  pro:   { gradient: 'linear-gradient(135deg, #0A84FF 0%, #5E5CE6 100%)', icon: '✦', iconBg: 'rgba(255,255,255,0.2)', iconColor: '#fff', textColor: '#fff', subColor: 'rgba(255,255,255,0.75)' },
  team:  { gradient: 'linear-gradient(135deg, #5856D6 0%, #AF52DE 100%)', icon: '⚡', iconBg: 'rgba(255,255,255,0.2)', iconColor: '#fff', textColor: '#fff', subColor: 'rgba(255,255,255,0.75)' },
};

/* ── Inline SVG illustrations ────────────────────────────────── */
const FreeIllustration = () => (
  <svg viewBox="0 0 280 130" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="280" height="130" rx="14" fill="url(#freeGrad)" />
    <defs>
      <linearGradient id="freeGrad" x1="0" y1="0" x2="280" y2="130" gradientUnits="userSpaceOnUse">
        <stop stopColor="#F2F2F7" />
        <stop offset="1" stopColor="#E5E5EA" />
      </linearGradient>
    </defs>
    {/* notebook */}
    <rect x="68" y="22" width="88" height="88" rx="10" fill="white" stroke="#D1D1D6" strokeWidth="1.5" />
    <rect x="64" y="26" width="88" height="88" rx="10" fill="white" stroke="#D1D1D6" strokeWidth="1.5" />
    <rect x="60" y="30" width="88" height="84" rx="10" fill="white" stroke="#C7C7CC" strokeWidth="1.5" />
    {/* lines */}
    <rect x="76" y="52" width="52" height="5" rx="2.5" fill="#D1D1D6" />
    <rect x="76" y="64" width="38" height="5" rx="2.5" fill="#D1D1D6" />
    <rect x="76" y="76" width="44" height="5" rx="2.5" fill="#D1D1D6" />
    {/* check circle */}
    <circle cx="70" cy="54" r="5" fill="#34C759" />
    <path d="M67.5 54l1.8 1.8 3.2-3.2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="70" cy="66" r="5" fill="#34C759" />
    <path d="M67.5 66l1.8 1.8 3.2-3.2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="70" cy="78" r="5" fill="#C7C7CC" />
    {/* sparkle decoration */}
    <circle cx="185" cy="38" r="18" fill="white" fillOpacity="0.5" />
    <text x="185" y="44" textAnchor="middle" fontSize="18">✓</text>
    <circle cx="210" cy="80" r="10" fill="white" fillOpacity="0.4" />
    <circle cx="170" cy="100" r="7" fill="white" fillOpacity="0.3" />
  </svg>
);

const ProIllustration = () => (
  <svg viewBox="0 0 280 130" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="280" height="130" rx="14" fill="url(#proGrad)" />
    <defs>
      <linearGradient id="proGrad" x1="0" y1="0" x2="280" y2="130" gradientUnits="userSpaceOnUse">
        <stop stopColor="#0A84FF" />
        <stop offset="1" stopColor="#5E5CE6" />
      </linearGradient>
      <filter id="glow">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    {/* glow orb */}
    <circle cx="140" cy="65" r="40" fill="white" fillOpacity="0.08" />
    <circle cx="140" cy="65" r="26" fill="white" fillOpacity="0.1" />
    {/* sparkle stars */}
    <g filter="url(#glow)">
      <path d="M140 30 L143 42 L155 45 L143 48 L140 60 L137 48 L125 45 L137 42 Z" fill="white" fillOpacity="0.9" />
    </g>
    <path d="M195 25 L196.8 31 L203 32.8 L196.8 34.6 L195 40 L193.2 34.6 L187 32.8 L193.2 31 Z" fill="white" fillOpacity="0.6" />
    <path d="M90 80 L91.5 85.5 L97 87 L91.5 88.5 L90 94 L88.5 88.5 L83 87 L88.5 85.5 Z" fill="white" fillOpacity="0.5" />
    <path d="M210 70 L211 73.5 L214.5 74.5 L211 75.5 L210 79 L209 75.5 L205.5 74.5 L209 73.5 Z" fill="white" fillOpacity="0.5" />
    {/* AI chip */}
    <rect x="112" y="48" width="56" height="34" rx="8" fill="white" fillOpacity="0.15" stroke="white" strokeOpacity="0.3" strokeWidth="1" />
    <text x="140" y="70" textAnchor="middle" fill="white" fontSize="14" fontWeight="700" fontFamily="system-ui">AI</text>
    {/* floating cards */}
    <rect x="68" y="52" width="36" height="24" rx="6" fill="white" fillOpacity="0.18" />
    <rect x="176" y="52" width="36" height="24" rx="6" fill="white" fillOpacity="0.18" />
    <rect x="72" y="58" width="18" height="3" rx="1.5" fill="white" fillOpacity="0.6" />
    <rect x="72" y="64" width="12" height="3" rx="1.5" fill="white" fillOpacity="0.4" />
    <rect x="180" y="58" width="18" height="3" rx="1.5" fill="white" fillOpacity="0.6" />
    <rect x="180" y="64" width="12" height="3" rx="1.5" fill="white" fillOpacity="0.4" />
    {/* bottom shine */}
    <ellipse cx="140" cy="125" rx="70" ry="10" fill="white" fillOpacity="0.06" />
  </svg>
);

const TeamIllustration = () => (
  <svg viewBox="0 0 280 130" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="280" height="130" rx="14" fill="url(#teamGrad)" />
    <defs>
      <linearGradient id="teamGrad" x1="0" y1="0" x2="280" y2="130" gradientUnits="userSpaceOnUse">
        <stop stopColor="#5856D6" />
        <stop offset="1" stopColor="#AF52DE" />
      </linearGradient>
    </defs>
    {/* glow */}
    <circle cx="140" cy="65" r="48" fill="white" fillOpacity="0.05" />
    {/* avatars row */}
    {/* avatar 1 */}
    <circle cx="100" cy="58" r="22" fill="#FF6B9D" />
    <circle cx="100" cy="50" r="9" fill="white" fillOpacity="0.85" />
    <ellipse cx="100" cy="72" rx="14" ry="8" fill="white" fillOpacity="0.85" />
    {/* avatar 2 (larger, center) */}
    <circle cx="140" cy="55" r="26" fill="#34AADC" stroke="white" strokeWidth="2.5" />
    <circle cx="140" cy="46" r="10" fill="white" fillOpacity="0.9" />
    <ellipse cx="140" cy="71" rx="16" ry="9" fill="white" fillOpacity="0.9" />
    {/* avatar 3 */}
    <circle cx="180" cy="58" r="22" fill="#FF9F0A" />
    <circle cx="180" cy="50" r="9" fill="white" fillOpacity="0.85" />
    <ellipse cx="180" cy="72" rx="14" ry="8" fill="white" fillOpacity="0.85" />
    {/* connection lines */}
    <line x1="122" y1="58" x2="114" y2="58" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" strokeDasharray="2 2" />
    <line x1="158" y1="58" x2="166" y2="58" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" strokeDasharray="2 2" />
    {/* chat bubbles */}
    <rect x="60" y="90" width="50" height="18" rx="9" fill="white" fillOpacity="0.18" />
    <rect x="116" y="90" width="50" height="18" rx="9" fill="white" fillOpacity="0.22" />
    <rect x="172" y="90" width="50" height="18" rx="9" fill="white" fillOpacity="0.18" />
    <rect x="66" y="96" width="28" height="3" rx="1.5" fill="white" fillOpacity="0.5" />
    <rect x="122" y="96" width="28" height="3" rx="1.5" fill="white" fillOpacity="0.5" />
    <rect x="178" y="96" width="28" height="3" rx="1.5" fill="white" fillOpacity="0.5" />
    {/* stars */}
    <path d="M235 30 L236.5 35.5 L242 37 L236.5 38.5 L235 44 L233.5 38.5 L228 37 L233.5 35.5 Z" fill="white" fillOpacity="0.5" />
    <path d="M50 38 L51 41.5 L54.5 42.5 L51 43.5 L50 47 L49 43.5 L45.5 42.5 L49 41.5 Z" fill="white" fillOpacity="0.4" />
    <ellipse cx="140" cy="125" rx="70" ry="8" fill="white" fillOpacity="0.06" />
  </svg>
);

const FEATURE_ROWS = [
  { key: 'tasks',            label: 'Aufgaben',              type: 'limit' },
  { key: 'categories',       label: 'Kategorien',            type: 'limit' },
  { key: 'ai',               label: 'KI-Eingabe',            type: 'feature' },
  { key: 'groups',           label: 'Gruppen',               type: 'feature' },
  { key: 'recurringTasks',   label: 'Wiederkehrende Aufgaben', type: 'feature' },
  { key: 'attachments',      label: 'Anhänge',               type: 'feature' },
  { key: 'statistics',       label: 'Statistiken',           type: 'feature' },
  { key: 'aiCalls',          label: 'KI-Abfragen/Monat',     type: 'limit' },
  { key: 'prioritySupport',  label: 'Prioritäts-Support',    type: 'feature' },
];

function LimitLabel({ value }) {
  if (value === Infinity) return <span style={{ color: 'var(--success)' }}>Unbegrenzt</span>;
  if (value === 0) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  return <span>{value}</span>;
}

export default function PricingPage() {
  const navigate = useNavigate();
  const { planId } = usePlan();
  const { user, setUser } = useAuthStore();
  const [loading, setLoading] = useState(null);
  const [success, setSuccess] = useState(null);
  const [annual, setAnnual] = useState(false);

  const handleSelect = async (targetPlanId) => {
    if (targetPlanId === planId || loading) return;
    setLoading(targetPlanId);
    try {
      await api.upgradePlan(targetPlanId);
      if (user) setUser({ ...user, plan: targetPlanId });
      setSuccess(targetPlanId);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div>
      <motion.div
        className="page-header"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <button className="pricing-back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} />
        </button>
        <h2>Pläne &amp; Preise</h2>
        <p>Wähle den passenden Plan für deine Anforderungen.</p>
      </motion.div>

      {/* Annual toggle */}
      <div className="pricing-annual-toggle">
        <span className={!annual ? 'active' : ''}>Monatlich</span>
        <button
          className={`pricing-toggle-btn ${annual ? 'on' : ''}`}
          onClick={() => setAnnual((v) => !v)}
          aria-label="Jahresabrechnung umschalten"
        />
        <span className={annual ? 'active' : ''}>
          Jährlich <span className="pricing-save-badge">−20%</span>
        </span>
      </div>

      {/* Plan cards */}
      <div className="pricing-cards">
        {Object.values(PLANS).map((p, i) => {
          const banner = PLAN_BANNERS[p.id];
          const color = PLAN_COLORS[p.id];
          const isCurrent = p.id === planId;
          const isLoading = loading === p.id;
          const isDone = success === p.id;
          const displayPrice = annual && p.price > 0
            ? `${(p.price * 0.8 * 12).toFixed(0).replace('.', ',')} €/Jahr`
            : p.priceLabel;

          return (
            <motion.div
              key={p.id}
              className={`pricing-card ${p.id === 'pro' ? 'featured' : ''} ${isCurrent ? 'current' : ''}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.07 }}
            >
              {p.id === 'pro' && <div className="pricing-featured-label">Beliebteste Wahl</div>}
              {isCurrent && <div className="pricing-current-label">Dein Plan</div>}

              {/* Gradient banner with name + price */}
              <div className="pricing-card-banner" style={{ background: banner.gradient }}>
                <div className="pricing-card-banner-icon" style={{ background: banner.iconBg, color: banner.iconColor }}>
                  {banner.icon}
                </div>
                <div className="pricing-card-banner-text">
                  <div className="pricing-card-name" style={{ color: banner.textColor }}>{p.label}</div>
                  <div className="pricing-card-price" style={{ color: banner.subColor }}>{displayPrice}</div>
                </div>
              </div>

              <ul className="pricing-features-list">
                {FEATURE_ROWS.map((row) => {
                  const included = row.type === 'feature'
                    ? p.features?.[row.key] === true
                    : (p.limits?.[row.key] ?? 0) > 0;

                  return (
                    <li key={row.key} className={`pricing-feature-row ${included ? 'included' : 'excluded'}`}>
                      <Check size={13} className="pricing-check" />
                      <span className="pricing-feature-label">{row.label}</span>
                      {row.type === 'limit' && included && (
                        <span className="pricing-feature-value">
                          <LimitLabel value={p.limits?.[row.key]} />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>

              <button
                className={`pricing-cta-btn ${p.id === 'pro' ? 'primary' : 'secondary'} ${isCurrent ? 'current' : ''} ${isDone ? 'done' : ''}`}
                style={p.id !== 'pro' && !isCurrent && !isDone ? { borderColor: color, color } : {}}
                onClick={() => handleSelect(p.id)}
                disabled={isCurrent || isLoading || isDone}
              >
                {isDone
                  ? '✓ Aktiviert'
                  : isLoading
                    ? 'Wird aktiviert…'
                    : isCurrent
                      ? 'Aktueller Plan'
                      : p.id === 'free'
                        ? 'Kostenlos starten'
                        : `${p.label} wählen`}
              </button>
            </motion.div>
          );
        })}
      </div>

      <p className="pricing-disclaimer">
        Alle Preise inkl. MwSt. · Jederzeit kündbar · Keine versteckten Kosten.
      </p>
    </div>
  );
}

