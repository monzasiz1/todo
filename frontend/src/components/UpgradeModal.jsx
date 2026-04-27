import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Sparkles, Users, Zap } from 'lucide-react';
import { useState } from 'react';
import { PLANS } from '../lib/plans';
import { api } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const PLAN_ICONS = { free: Zap, pro: Sparkles, team: Users };
const PLAN_HIGHLIGHTS = {
  free: ['Bis zu 50 Aufgaben', '3 Kategorien', 'Keine KI'],
  pro:  ['Unbegrenzte Aufgaben', 'KI-Eingabe inklusive', 'Bis zu 3 Gruppen', 'Wiederkehrende Aufgaben', 'Statistiken & Kalender'],
  team: ['Alles in Pro', 'Unbegrenzte Gruppen', '1.000 KI-Abfragen/Monat', 'Admin-Panel', 'Prioritäts-Support'],
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
  const [success, setSuccess] = useState(null);
  const { user, setUser } = useAuthStore();

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
    try {
      await api.upgradePlan(planId);
      // Update local user object so usePlan() reacts immediately
      if (user) setUser({ ...user, plan: planId });
      setSuccess(planId);
      setTimeout(() => onClose(), 1400);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(null);
    }
  };

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

          {/* Plan cards */}
          <div className="upgrade-plans-grid">
            {(['pro', 'team']).map((planId) => {
              const plan = PLANS[planId];
              const Icon = PLAN_ICONS[planId];
              const isRecommended = planId === recommendPlan;
              const isDone = success === planId;
              const isLoading = loading === planId;

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
                      <div className="upgrade-plan-price">{plan.priceLabel}</div>
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
                    className={`upgrade-plan-btn ${isRecommended ? 'primary' : 'secondary'} ${isDone ? 'done' : ''}`}
                    onClick={() => handleUpgrade(planId)}
                    disabled={isLoading || isDone}
                  >
                    {isDone ? 'Aktiviert' : isLoading ? 'Wird aktiviert…' : `${plan.label} wählen`}
                  </button>
                </div>
              );
            })}
          </div>

          <p className="upgrade-modal-footer">
            Jederzeit kündbar · Keine versteckten Kosten
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

