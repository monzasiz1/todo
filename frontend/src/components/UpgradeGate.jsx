import { useEffect, useState } from 'react';
import UpgradeModal from './UpgradeModal';

/**
 * UpgradeGate
 *
 * Zentraler Listener fuer das globale `beequ:upgrade-required`-Event, das
 * api.js bei einer 402-Antwort (Plan-Limit/Feature gesperrt) feuert.
 * Zeigt dann genau eine UpgradeModal — egal von welchem Store/Component
 * der gesperrte Request ausging. Einmal hoch im Baum mounten (Layout).
 */
export default function UpgradeGate() {
  const [gate, setGate] = useState(null);

  useEffect(() => {
    const onUpgrade = (e) => {
      setGate({
        feature: e.detail?.feature || null,
        recommendPlan: e.detail?.recommendPlan || 'pro',
      });
    };
    window.addEventListener('beequ:upgrade-required', onUpgrade);
    return () => window.removeEventListener('beequ:upgrade-required', onUpgrade);
  }, []);

  if (!gate) return null;

  return (
    <UpgradeModal
      feature={gate.feature}
      recommendPlan={gate.recommendPlan}
      onClose={() => setGate(null)}
    />
  );
}
