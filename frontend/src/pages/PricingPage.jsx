import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Check, ArrowLeft, Sparkles, Zap, AlertCircle, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PLANS } from '../lib/plans';
import { usePlan } from '../hooks/usePlan';
import { api } from '../utils/api';

const PLAN_COLORS = { free: '#8E8E93', pro: '#007AFF', team: '#5856D6' };

const PLAN_BANNERS = {
  free:  { gradient: 'linear-gradient(135deg, #E5E5EA 0%, #D1D1D6 100%)', icon: '✓', iconBg: '#fff', iconColor: '#34C759', textColor: '#1c1c1e', subColor: '#6e6e73' },
  pro:   { gradient: 'linear-gradient(135deg, #0A84FF 0%, #5E5CE6 100%)', icon: '✦', iconBg: 'rgba(255,255,255,0.2)', iconColor: '#fff', textColor: '#fff', subColor: 'rgba(255,255,255,0.75)' },
  team:  { gradient: 'linear-gradient(135deg, #5856D6 0%, #AF52DE 100%)', icon: '⚡', iconBg: 'rgba(255,255,255,0.2)', iconColor: '#fff', textColor: '#fff', subColor: 'rgba(255,255,255,0.75)' },
};

const FEATURE_ROWS = [
  { key: 'tasks',           label: 'Aufgaben',                type: 'limit' },
  { key: 'categories',      label: 'Kategorien',              type: 'limit' },
  { key: 'aiCalls',         label: 'KI-Anfragen / Monat',     type: 'limit' },
  { key: 'recurringTasks',  label: 'Wiederkehrende Aufgaben', type: 'feature' },
  { key: 'groups',          label: 'Gruppen & Teams',         type: 'feature' },
  { key: 'attachments',     label: 'Anhänge',                 type: 'feature' },
  { key: 'calendarSync',    label: 'Kalender-Sync',           type: 'feature' },
  { key: 'statistics',      label: 'Statistiken',             type: 'feature' },
  { key: 'prioritySupport', label: 'Prioritäts-Support',      type: 'feature' },
];

const FREE_PAIN_POINTS = [
  { icon: Sparkles, label: 'Nur 5 KI-Anfragen pro Monat' },
  { icon: Zap,      label: 'Max. 30 Aufgaben gleichzeitig' },
  { icon: AlertCircle, label: 'Keine Gruppen, Anhänge oder Statistiken' },
];

function formatLimit(value) {
  if (value === Infinity) return 'Unbegrenzt';
  if (value === 0) return '—';
  return new Intl.NumberFormat('de-DE').format(value);
}

function PriceDisplay({ plan, annual }) {
  if (plan.id === 'free') {
    return <span className="pricing-price-amount">Kostenlos</span>;
  }
  if (annual) {
    return (
      <>
        <span className="pricing-price-amount">{plan.priceLabelYear}</span>
        {plan.yearlyMonthly && (
          <span className="pricing-price-sub">≈ {plan.yearlyMonthly.toFixed(2).replace('.', ',')} €/Monat</span>
        )}
      </>
    );
  }
  return <span className="pricing-price-amount">{plan.priceLabel}</span>;
}

export default function PricingPage() {
  const navigate = useNavigate();
  const { planId } = usePlan();
  const [loading, setLoading] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [annual, setAnnual] = useState(true);

  const interval = annual ? 'year' : 'month';
  const hasPaidPlan = planId === 'pro' || planId === 'team';

  const handleSelect = async (targetPlanId) => {
    if (targetPlanId === planId || loading) return;
    setErrorMsg(null);

    if (targetPlanId === 'free') {
      setLoading('free');
      try {
        await api.upgradePlan('free');
        const me = await api.getMyPlan();
        if (me?.plan === 'free') window.location.reload();
      } catch (err) {
        console.error(err);
        setErrorMsg(err?.message || 'Plan-Wechsel fehlgeschlagen');
      } finally {
        setLoading(null);
      }
      return;
    }

    setLoading(targetPlanId);
    try {
      const { url } = await api.createCheckoutSession(targetPlanId, interval);
      if (!url) throw new Error('Keine Checkout-URL erhalten');
      try {
        sessionStorage.setItem('bq:pendingUpgrade', JSON.stringify({
          plan: targetPlanId, interval, ts: Date.now(),
        }));
      } catch { /* ignore */ }
      window.location.assign(url);
    } catch (err) {
      console.error(err);
      setErrorMsg(err?.message || 'Checkout konnte nicht gestartet werden');
      setLoading(null);
    }
  };

  const handleManageSubscription = async () => {
    setLoading('portal');
    setErrorMsg(null);
    try {
      const { url } = await api.getBillingPortalUrl();
      if (!url) throw new Error('Keine Portal-URL erhalten');
      window.location.assign(url);
    } catch (err) {
      console.error(err);
      setErrorMsg(err?.message || 'Portal konnte nicht geöffnet werden');
      setLoading(null);
    }
  };

  const orderedPlans = useMemo(
    () => ['free', 'pro', 'team'].map((id) => PLANS[id]).filter(Boolean),
    []
  );

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
        <p>Wähle den Plan, der zu deinem Workflow passt – jederzeit wechselbar.</p>
      </motion.div>

      <div className="pricing-annual-toggle">
        <span className={!annual ? 'active' : ''}>Monatlich</span>
        <button
          className={`pricing-toggle-btn ${annual ? 'on' : ''}`}
          onClick={() => setAnnual((v) => !v)}
          aria-label="Jahresabrechnung umschalten"
        />
        <span className={annual ? 'active' : ''}>
          Jährlich <span className="pricing-save-badge">−17%</span>
        </span>
      </div>

      <div className="pricing-cards">
        {orderedPlans.map((p, i) => {
          const banner = PLAN_BANNERS[p.id];
          const color = PLAN_COLORS[p.id];
          const isCurrent = p.id === planId;
          const isLoading = loading === p.id;
          const isFeatured = p.id === 'pro';

          return (
            <motion.div
              key={p.id}
              className={`pricing-card ${isFeatured ? 'featured' : ''} ${isCurrent ? 'current' : ''}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.07 }}
            >
              {isFeatured && <div className="pricing-featured-label">Beliebteste Wahl</div>}
              {isCurrent && <div className="pricing-current-label">Dein Plan</div>}

              <div className="pricing-card-banner" style={{ background: banner.gradient }}>
                <div className="pricing-card-banner-icon" style={{ background: banner.iconBg, color: banner.iconColor }}>
                  {banner.icon}
                </div>
                <div className="pricing-card-banner-text">
                  <div className="pricing-card-name" style={{ color: banner.textColor }}>{p.label}</div>
                  <div className="pricing-card-price" style={{ color: banner.subColor }}>
                    <PriceDisplay plan={p} annual={annual} />
                  </div>
                  {p.tagline && (
                    <div className="pricing-card-tagline" style={{ color: banner.subColor }}>
                      {p.tagline}
                    </div>
                  )}
                </div>
              </div>

              <ul className="pricing-features-list">
                {FEATURE_ROWS.map((row) => {
                  const isFeature = row.type === 'feature';
                  const value = isFeature ? p.features?.[row.key] : p.limits?.[row.key];
                  const included = isFeature ? value === true : (value ?? 0) > 0;

                  return (
                    <li
                      key={row.key}
                      className={`pricing-feature-row ${included ? 'included' : 'excluded'}`}
                    >
                      <Check size={13} className="pricing-check" />
                      <span className="pricing-feature-label">{row.label}</span>
                      {!isFeature && (
                        <span className="pricing-feature-value">
                          {included
                            ? <strong>{formatLimit(value)}</strong>
                            : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>

              <button
                className={`pricing-cta-btn ${isFeatured ? 'primary' : 'secondary'} ${isCurrent ? 'current' : ''}`}
                style={!isFeatured && !isCurrent ? { borderColor: color, color } : {}}
                onClick={() => handleSelect(p.id)}
                disabled={isCurrent || isLoading || !!loading}
              >
                {isLoading
                  ? p.id === 'free' ? 'Wird gewechselt…' : 'Checkout wird gestartet…'
                  : isCurrent
                    ? 'Aktueller Plan'
                    : p.id === 'free'
                      ? 'Zu Free wechseln'
                      : `${p.label} wählen`}
              </button>
            </motion.div>
          );
        })}
      </div>

      {planId === 'free' && (
        <motion.div
          className="pricing-pain-card"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.25 }}
        >
          <div className="pricing-pain-head">
            <Sparkles size={16} />
            <span>Wofür sich ein Upgrade lohnt</span>
          </div>
          <div className="pricing-pain-grid">
            {FREE_PAIN_POINTS.map((pt, idx) => {
              const Icon = pt.icon;
              return (
                <div key={idx} className="pricing-pain-item">
                  <Icon size={14} />
                  <span>{pt.label}</span>
                </div>
              );
            })}
          </div>
          <p className="pricing-pain-foot">
            Mit <strong>Pro</strong> sind alle Limits weg – schon ab 4,17 €/Monat.
          </p>
        </motion.div>
      )}

      {hasPaidPlan && (
        <button
          type="button"
          className="pricing-manage-btn"
          onClick={handleManageSubscription}
          disabled={loading === 'portal'}
        >
          <Settings size={14} />
          {loading === 'portal' ? 'Wird geöffnet…' : 'Abo verwalten / kündigen'}
        </button>
      )}

      {errorMsg && (
        <div className="pricing-error" role="alert">{errorMsg}</div>
      )}

      <p className="pricing-disclaimer">
        Sichere Zahlung über Stripe · Alle Preise inkl. MwSt. · Jederzeit kündbar.
      </p>
    </div>
  );
}
