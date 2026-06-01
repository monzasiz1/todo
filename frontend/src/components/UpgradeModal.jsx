import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Sparkles, Users, Zap } from 'lucide-react';
import { useState } from 'react';
import { PLANS } from '../lib/plans';
import { api } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const PLAN_ICONS = { free: Zap, pro: Sparkles, team: Users };
const PLAN_HIGHLIGHTS = {
  free: ['Bis zu 30 Aufgaben', '2 Kategorien', '1 eigene Gruppe · max. 3 Mitglieder', 'Beitritt zu Gruppen unbegrenzt', 'Nur 5 KI-Anfragen / Monat'],
  pro:  ['Unbegrenzte Aufgaben & Kategorien', '200 KI-Anfragen / Monat', '2 eigene Gruppen · bis 5 Mitglieder', 'Wiederkehrende Aufgaben', 'Kalender-Sync · Anhänge · Statistiken'],
  team: ['Alles aus Pro', 'Unbegrenzte eigene Gruppen & Mitglieder', 'Team-Chat & geteilte Aufgaben', 'Rollen, Rechte & Admin-Tools', '1.000 KI-Anfragen / Monat', 'Prioritäts-Support'],
};

// Preise je Plan & Intervall (Anzeige – die echten Preise liegen in Stripe).
const PRICING = {
  pro:  {
    month: { amount: '2,99 €',  suffix: '/Monat' },
    year:  { amount: '35,88 €', suffix: '/Jahr', hint: '≈ 2,99 €/Mon · Kein Unterschied zum Monatstarif' },
  },
  team: {
    month: { amount: '9,99 €',  suffix: '/Monat/Nutzer' },
    year:  { amount: '99,99 €', suffix: '/Jahr/Nutzer', hint: '≈ 8,33 €/Mon · 2 Monate gratis' },
  },
};

/**
 * UpgradeModal
 *
 * Props:
 *   onClose()           – called when modal should close
 *   feature (optional)  – e.g. 'ai' | 'groups' | 'categories'
 *                         shown as context in the header
 *   recommendPlan       – 'pro' | 'team'  (default: 'pro')
 */
export default function UpgradeModal({ onClose, feature, recommendPlan = 'pro' }) {
  const [loading, setLoading] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [interval, setInterval] = useState('month'); // 'month' | 'year'
  const { user } = useAuthStore();

  const featureLabels = {
    ai: 'KI-Eingabe',
    groups: 'Gruppen',
    categories: 'Mehr Kategorien',
    recurringTasks: 'Wiederkehrende Aufgaben',
    statistics: 'Statistiken',
    attachments: 'Anhänge',
  };

  const handleUpgrade = async (planId) => {
    setLoading(planId);
    setErrorMsg(null);
    try {
      const { url } = await api.createCheckoutSession(planId, interval);
      if (!url) throw new Error('Keine Checkout-URL erhalten');
      // Vor dem Redirect merken, damit die Success-Page weiss, was bestellt wurde.
      try {
        sessionStorage.setItem('bq:pendingUpgrade', JSON.stringify({
          plan: planId, interval, ts: Date.now(),
        }));
      } catch { /* ignore */ }
      window.location.assign(url);
    } catch (err) {
      console.error(err);
      setErrorMsg(err?.message || 'Checkout konnte nicht gestartet werden');
      setLoading(null);
    }
  };

  const handleManage = async () => {
    setLoading('portal');
    setErrorMsg(null);
    try {
      const { url } = await api.getBillingPortalUrl();
      if (!url) throw new Error('Keine Portal-URL erhalten');
      window.location.assign(url);
    } catch (err) {
      console.error(err);
      setErrorMsg(err?.message || 'Portal konnte nicht geoeffnet werden');
      setLoading(null);
    }
  };

  const currentPlan = user?.plan || 'free';
  const hasPaidPlan = currentPlan === 'pro' || currentPlan === 'team';

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="modal-overlay upgrade-modal-overlay"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="upgrade-modal"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.93, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.93, y: 24 }}
          transition={{ type: 'spring', damping: 28, stiffness: 340 }}
        >
          {/* Close */}
          <button className="upgrade-modal-close" onClick={onClose}><X size={18} /></button>

          {/* Header */}
          <div className="upgrade-modal-head">
            <div className="upgrade-modal-badge">
              <Sparkles size={16} />
              Upgrade
            </div>
            <h2 className="upgrade-modal-title">
              {feature
                ? `${featureLabels[feature] ?? feature} freischalten`
                : 'Mehr aus BeeQu herausholen'}
            </h2>
            <p className="upgrade-modal-sub">
              Wähle den passenden Plan und leg sofort los.
            </p>
          </div>

          {/* Monat/Jahr-Toggle */}
          <div className="upgrade-interval-toggle" role="tablist" aria-label="Abrechnungsintervall">
            <button
              type="button"
              role="tab"
              aria-selected={interval === 'month'}
              className={`upgrade-interval-btn ${interval === 'month' ? 'active' : ''}`}
              onClick={() => setInterval('month')}
            >
              Monatlich
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={interval === 'year'}
              className={`upgrade-interval-btn ${interval === 'year' ? 'active' : ''}`}
              onClick={() => setInterval('year')}
            >
              Jährlich
              <span className="upgrade-interval-save">−17%</span>
            </button>
          </div>

          {/* Plan cards */}
          <div className="upgrade-plans-grid">
            {(['pro', 'team']).map((planId) => {
              const plan = PLANS[planId];
              const Icon = PLAN_ICONS[planId];
              const isRecommended = planId === recommendPlan;
              const isLoading = loading === planId;
              const price = PRICING[planId]?.[interval];
              const isCurrent = currentPlan === planId;

              return (
                <div
                  key={planId}
                  className={`upgrade-plan-card ${isRecommended ? 'recommended' : ''}`}
                >
                  {isRecommended && (
                    <div className="upgrade-plan-badge">Empfohlen</div>
                  )}

                  <div className="upgrade-plan-head">
                    <div className="upgrade-plan-icon">
                      <Icon size={18} />
                    </div>
                    <div>
                      <div className="upgrade-plan-name">{plan.label}</div>
                      <div className="upgrade-plan-price">
                        <strong>{price?.amount}</strong>
                        <span className="upgrade-plan-price-suffix">{price?.suffix}</span>
                      </div>
                      {price?.hint && (
                        <div className="upgrade-plan-price-hint">{price.hint}</div>
                      )}
                    </div>
                  </div>

                  <ul className="upgrade-plan-features">
                    {PLAN_HIGHLIGHTS[planId].map((f) => (
                      <li key={f}>
                        <Check size={13} className="upgrade-check" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <button
                    className={`upgrade-plan-btn ${isRecommended ? 'primary' : 'secondary'}`}
                    onClick={() => handleUpgrade(planId)}
                    disabled={!!loading || isCurrent}
                  >
                    {isCurrent
                      ? 'Aktueller Plan'
                      : isLoading
                        ? 'Wird gestartet…'
                        : `${plan.label} wählen`}
                  </button>
                </div>
              );
            })}
          </div>

          {errorMsg && (
            <div className="upgrade-modal-error" role="alert">{errorMsg}</div>
          )}

          {hasPaidPlan && (
            <button
              type="button"
              className="upgrade-modal-manage"
              onClick={handleManage}
              disabled={loading === 'portal'}
            >
              {loading === 'portal' ? 'Wird geöffnet…' : 'Abo verwalten / kündigen'}
            </button>
          )}

          <p className="upgrade-modal-footer">
            Sichere Zahlung über Stripe · Jederzeit kündbar
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

