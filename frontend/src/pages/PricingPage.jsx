import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Sparkles, Users, Zap, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PLANS } from '../lib/plans';
import { usePlan } from '../hooks/usePlan';
import { api } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const PLAN_ICONS = { free: Zap, pro: Sparkles, team: Users };
const PLAN_COLORS = { free: '#8E8E93', pro: '#007AFF', team: '#5856D6' };

const FEATURE_ROWS = [
  { key: 'tasks',            label: 'Aufgaben',              type: 'limit' },
  { key: 'categories',       label: 'Kategorien',            type: 'limit' },
  { key: 'ai',               label: 'KI-Eingabe',            type: 'feature' },
  { key: 'groups',           label: 'Gruppen',               type: 'feature' },
  { key: 'recurringTasks',   label: 'Wiederkehrende Aufgaben', type: 'feature' },
  { key: 'attachments',      label: 'Anhänge',               type: 'feature' },
  { key: 'statistics',       label: 'Statistiken',           type: 'feature' },
  { key: 'aiCalls',          label: 'KI-Abfragen/Monat',     type: 'limit' },
  { key: 'adminPanel',       label: 'Admin-Panel',           type: 'feature' },
  { key: 'prioritySupport',  label: 'Prioritäts-Support',    type: 'feature' },
];

function LimitLabel({ value }) {
  if (value === Infinity) return <span style={{ color: 'var(--success)' }}>Unbegrenzt</span>;
  if (value === 0) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  return <span>{value}</span>;
}

export default function PricingPage() {
  const navigate = useNavigate();
  const { planId, plan } = usePlan();
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
        <button
          className="pricing-back-btn"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={16} />
          Zurück
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
          const Icon = PLAN_ICONS[p.id];
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

              <div className="pricing-card-head">
                <div className="pricing-card-icon" style={{ background: `${color}18`, color }}>
                  <Icon size={20} />
                </div>
                <div className="pricing-card-name">{p.label}</div>
                <div className="pricing-card-price">{displayPrice}</div>
              </div>

              <ul className="pricing-features-list">
                {FEATURE_ROWS.map((row) => {
                  const included = row.type === 'feature'
                    ? p.features?.[row.key] === true
                    : (p.limits?.[row.key] ?? 0) > 0;

                  return (
                    <li
                      key={row.key}
                      className={`pricing-feature-row ${included ? 'included' : 'excluded'}`}
                    >
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
                onClick={() => handleSelect(p.id)}
                disabled={isCurrent || isLoading || isDone}
              >
                {isDone
                  ? 'Aktiviert'
                  : isLoading
                    ? 'Wird aktiviert…'
                    : isCurrent
                      ? 'Aktueller Plan'
                      : p.id === 'free'
                        ? 'Downgrade'
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
