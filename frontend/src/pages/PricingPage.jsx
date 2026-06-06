import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Check, ArrowLeft, Sparkles, Settings, Leaf, TreeDeciduous, Wind, Infinity as InfinityIcon, Wallet, Repeat, Paperclip } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PLANS } from '../lib/plans';
import { usePlan } from '../hooks/usePlan';
import { api } from '../utils/api';

const PLAN_COLORS = { free: '#8E8E93', pro: '#007AFF', team: '#5856D6' };

const PLAN_BANNERS = {
  free:  { gradient: 'linear-gradient(135deg, #E5E5EA 0%, #D1D1D6 100%)', icon: '✓', iconBg: '#fff', iconColor: '#34C759', textColor: '#1c1c1e', subColor: '#6e6e73', pattern: 'dots' },
  pro:   { gradient: 'linear-gradient(135deg, #0A84FF 0%, #5E5CE6 100%)', icon: '✦', iconBg: 'rgba(255,255,255,0.2)', iconColor: '#fff', textColor: '#fff', subColor: 'rgba(255,255,255,0.85)', pattern: 'waves' },
  team:  { gradient: 'linear-gradient(135deg, #5856D6 0%, #AF52DE 100%)', icon: '⚡', iconBg: 'rgba(255,255,255,0.2)', iconColor: '#fff', textColor: '#fff', subColor: 'rgba(255,255,255,0.85)', pattern: 'rays' },
};

function BannerPattern({ type }) {
  if (type === 'waves') {
    return (
      <svg className="pricing-banner-pattern" viewBox="0 0 400 140" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0,90 Q100,40 200,70 T400,60 L400,140 L0,140 Z" fill="rgba(255,255,255,0.08)" />
        <path d="M0,110 Q120,70 240,95 T400,85 L400,140 L0,140 Z" fill="rgba(255,255,255,0.10)" />
        <circle cx="340" cy="30" r="38" fill="rgba(255,255,255,0.08)" />
        <circle cx="370" cy="50" r="14" fill="rgba(255,255,255,0.12)" />
      </svg>
    );
  }
  if (type === 'rays') {
    return (
      <svg className="pricing-banner-pattern" viewBox="0 0 400 140" preserveAspectRatio="none" aria-hidden="true">
        <g opacity="0.18" stroke="#fff" strokeWidth="1.2" fill="none">
          <path d="M380,0 L240,140" />
          <path d="M380,30 L260,140" />
          <path d="M380,60 L300,140" />
          <path d="M380,90 L340,140" />
        </g>
        <circle cx="350" cy="40" r="46" fill="rgba(255,255,255,0.10)" />
        <circle cx="350" cy="40" r="22" fill="rgba(255,255,255,0.16)" />
        <polygon points="60,30 70,50 90,55 75,68 80,90 60,80 40,90 45,68 30,55 50,50" fill="rgba(255,255,255,0.18)" />
      </svg>
    );
  }
  // dots
  return (
    <svg className="pricing-banner-pattern" viewBox="0 0 400 140" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <pattern id="dotgrid" x="0" y="0" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.5" fill="rgba(60,60,67,0.18)" />
        </pattern>
      </defs>
      <rect width="400" height="140" fill="url(#dotgrid)" />
      <circle cx="340" cy="40" r="44" fill="rgba(255,255,255,0.45)" />
    </svg>
  );
}

const FEATURE_ROWS = [
  { key: 'tasks',           label: 'Aufgaben',                type: 'limit' },
  { key: 'categories',      label: 'Kategorien',              type: 'limit' },
  { key: 'aiCalls',         label: 'KI-Anfragen / Monat',     type: 'limit' },
  { key: 'budgetEntries',   label: 'Budget-Einträge',         type: 'limit' },
  { key: 'groups',          label: 'Eigene Gruppen',          type: 'limit' },
  { key: 'groupMembers',    label: 'Mitglieder pro Gruppe',   type: 'limit' },
  { key: 'teamChat',        label: 'Team-Chat & geteilte Aufgaben', type: 'feature' },
  { key: 'groupAdmin',      label: 'Rollen, Rechte & Admin',  type: 'feature' },
  { key: 'recurringTasks',  label: 'Wiederkehrende Aufgaben', type: 'feature' },
  { key: 'attachments',     label: 'Anhänge',                 type: 'feature' },
  { key: 'calendarSync',    label: 'Kalender-Sync',           type: 'feature' },
  { key: 'statistics',      label: 'Statistiken',             type: 'feature' },
  { key: 'prioritySupport', label: 'Prioritäts-Support',      type: 'feature' },
];

// Was ein Upgrade auf Pro konkret freischaltet (akkurat – Team-Chat/Admin sind
// Team-exklusiv und gehoeren NICHT hierher).
const UPGRADE_BENEFITS = [
  { icon: Sparkles,     title: '200 KI-Anfragen / Monat',           sub: 'statt nur 5 im Free-Plan' },
  { icon: InfinityIcon, title: 'Unbegrenzte Aufgaben & Kategorien', sub: 'statt 30 Aufgaben & 2 Kategorien' },
  { icon: Wallet,       title: 'Unbegrenztes Budget',               sub: 'statt 20 Budget-Einträgen' },
  { icon: Repeat,       title: 'Wiederkehrende Aufgaben',           sub: 'im Free-Plan gesperrt' },
  { icon: Paperclip,    title: 'Anhänge, Statistiken & Kalender-Sync', sub: 'im Free-Plan gesperrt' },
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
  const [annual, setAnnual] = useState(false);

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
        className="page-header pricing-header"
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
                <BannerPattern type={banner.pattern} />
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
                {p.id !== 'free' && (
                  <div className="pricing-climate-badge" title="1% deines Abos geht an CO₂-Entfernung via Stripe Climate">
                    <Leaf size={11} />
                    <span>1% CO₂</span>
                  </div>
                )}
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
          className="pricing-upgrade-card"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.25 }}
        >
          <div className="pricing-upgrade-head">
            <span className="pricing-upgrade-head-ic"><Sparkles size={18} /></span>
            <div className="pricing-upgrade-head-texts">
              <strong>Wofür sich Pro lohnt</strong>
              <span>Alle Free-Limits fallen weg</span>
            </div>
          </div>
          <div className="pricing-upgrade-grid">
            {UPGRADE_BENEFITS.map((b, idx) => {
              const Icon = b.icon;
              return (
                <motion.div
                  key={idx}
                  className="pricing-upgrade-tile"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.3 + idx * 0.06 }}
                >
                  <span className="pricing-upgrade-tile-ic"><Icon size={16} /></span>
                  <div className="pricing-upgrade-tile-texts">
                    <strong>{b.title}</strong>
                    <span>{b.sub}</span>
                  </div>
                  <Check className="pricing-upgrade-tile-check" size={15} />
                </motion.div>
              );
            })}
          </div>
          <p className="pricing-upgrade-foot">
            Mit <strong>Pro</strong> schon ab <strong>2,50 €/Monat</strong> · jederzeit kündbar
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

      <motion.div
        className="pricing-climate-section"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.3 }}
      >
        <div className="pricing-climate-hero" aria-hidden="true">
          <svg viewBox="0 0 240 120" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7FD8B6" />
                <stop offset="100%" stopColor="#4BB48A" />
              </linearGradient>
            </defs>
            <rect width="240" height="120" fill="url(#skyGrad)" />
            <circle cx="200" cy="32" r="18" fill="#FFF6C9" opacity="0.85" />
            <path d="M0,90 Q60,70 120,80 T240,82 L240,120 L0,120 Z" fill="#2E8B6B" opacity="0.85" />
            <path d="M0,100 Q70,86 140,94 T240,96 L240,120 L0,120 Z" fill="#1F6B52" />
            <g fill="#1F6B52">
              <circle cx="40" cy="80" r="14" />
              <circle cx="55" cy="74" r="12" />
              <circle cx="32" cy="72" r="11" />
              <rect x="42" y="86" width="5" height="14" fill="#3E2A1A" />
            </g>
            <g fill="#2E8B6B">
              <circle cx="170" cy="78" r="11" />
              <circle cx="182" cy="74" r="10" />
              <circle cx="162" cy="72" r="9" />
              <rect x="170" y="82" width="4" height="12" fill="#3E2A1A" />
            </g>
          </svg>
          <div className="pricing-climate-stripe">
            <span>powered by</span>
            <strong>Stripe Climate</strong>
          </div>
        </div>
        <div className="pricing-climate-body">
          <div className="pricing-climate-title">
            <Leaf size={18} />
            <h3>Du arbeitest – wir helfen dem Klima.</h3>
          </div>
          <p className="pricing-climate-text">
            <strong>1&nbsp;%</strong> von jedem zahlenden Abo fließt automatisch in <strong>Stripe Climate</strong>
            – zertifizierte Verfahren zur Entfernung von CO₂ aus der Atmosphäre.
            Du musst nichts extra tun: Wenn du dein Abo nutzt, leistest du einen Beitrag.
          </p>
          <div className="pricing-climate-stats">
            <div className="pricing-climate-stat">
              <TreeDeciduous size={18} />
              <div>
                <div className="pricing-climate-stat-num">1 %</div>
                <div className="pricing-climate-stat-lbl">deines Abos für CO₂-Entfernung</div>
              </div>
            </div>
            <div className="pricing-climate-stat">
              <Wind size={18} />
              <div>
                <div className="pricing-climate-stat-num">100 %</div>
                <div className="pricing-climate-stat-lbl">zertifiziert &amp; transparent</div>
              </div>
            </div>
            <div className="pricing-climate-stat">
              <Leaf size={18} />
              <div>
                <div className="pricing-climate-stat-num">0 €</div>
                <div className="pricing-climate-stat-lbl">Aufpreis für dich</div>
              </div>
            </div>
          </div>
          <a
            className="pricing-climate-link"
            href="https://stripe.com/climate"
            target="_blank"
            rel="noopener noreferrer"
          >
            Mehr über Stripe Climate erfahren →
          </a>
        </div>
      </motion.div>

      <p className="pricing-disclaimer">
        Sichere Zahlung über Stripe · Alle Preise inkl. MwSt. · Jederzeit kündbar.
      </p>
    </div>
  );
}
