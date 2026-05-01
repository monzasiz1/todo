import { Lock } from 'lucide-react';
import { useState } from 'react';
import { usePlan } from '../hooks/usePlan';
import UpgradeModal from './UpgradeModal';

/**
 * PlanGate
 *
 * Wraps content that requires a specific feature.
 * If the current user cannot use the feature, a blurred lock overlay
 * is shown with an upgrade CTA instead of the actual children.
 *
 * Props:
 *   feature      – key from PLANS[x].features (e.g. 'ai', 'groups')
 *   children     – content to show when allowed
 *   fallback     – optional custom fallback (default: lock overlay)
 *   inline       – render a smaller inline badge instead of full overlay
 */
export default function PlanGate({ feature, children, fallback, inline = false }) {
  const { can } = usePlan();
  const [showUpgrade, setShowUpgrade] = useState(false);

  if (can(feature)) return <>{children}</>;

  if (fallback) return <>{fallback}</>;

  if (inline) {
    return (
      <>
        <button className="plan-gate-inline" onClick={() => setShowUpgrade(true)}>
          <Lock size={12} />
          Pro
        </button>
        {showUpgrade && (
          <UpgradeModal feature={feature} onClose={() => setShowUpgrade(false)} />
        )}
      </>
    );
  }

  return (
    <>
      <div className="plan-gate-wrap">
        <div className="plan-gate-blur">{children}</div>
        <div className="plan-gate-overlay" onClick={() => setShowUpgrade(true)}>
          <div className="plan-gate-lock">
            <Lock size={22} />
          </div>
          <p className="plan-gate-label">Pro-Feature</p>
          <button className="plan-gate-btn">Freischalten</button>
        </div>
      </div>
      {showUpgrade && (
        <UpgradeModal feature={feature} onClose={() => setShowUpgrade(false)} />
      )}
    </>
  );
}
