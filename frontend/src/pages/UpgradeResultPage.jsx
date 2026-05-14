import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2, Sparkles } from 'lucide-react';
import { api } from '../utils/api';
import { useAuthStore } from '../store/authStore';

/**
 * UpgradeResultPage
 *
 * Wird nach Stripe-Checkout aufgerufen.
 *  - mode="success" → /app/upgrade/success?session_id=cs_...
 *  - mode="cancel"  → /app/upgrade/cancel
 *
 * Polled bei success kurz die Session, damit das Plan-Update auch ohne
 * Webhook-Latenz sofort sichtbar ist.
 */
export default function UpgradeResultPage({ mode = 'success' }) {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);

  const [status, setStatus] = useState(mode === 'success' ? 'pending' : 'cancelled');
  const [plan, setPlan] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);

  useEffect(() => {
    if (mode !== 'success') return undefined;
    if (!sessionId) { setStatus('error'); return undefined; }

    let cancelled = false;
    let attempts = 0;

    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        await api.getCheckoutSession(sessionId);
        const me = await api.getMyPlan();
        if (cancelled) return;
        if (me?.plan && me.plan !== 'free') {
          setPlan(me.plan);
          setExpiresAt(me.expires_at || null);
          if (user) setUser({ ...user, plan: me.plan });
          setStatus('ok');
          try { sessionStorage.removeItem('bq:pendingUpgrade'); } catch { /* ignore */ }
          return;
        }
      } catch (err) {
        console.error('[upgrade-success] poll error:', err);
      }
      if (attempts < 10) {
        setTimeout(tick, 1500);
      } else if (!cancelled) {
        setStatus('slow');
      }
    };
    tick();
    return () => { cancelled = true; };
  }, [mode, sessionId, setUser, user]);

  if (mode === 'cancel') {
    return (
      <div className="upgrade-result-wrap">
        <div className="upgrade-result-card">
          <div className="upgrade-result-icon cancel"><XCircle size={36} /></div>
          <h1>Zahlung abgebrochen</h1>
          <p>Kein Problem – du wurdest nicht belastet.</p>
          <Link to="/app/pricing" className="upgrade-result-btn primary">
            Zurück zu den Plänen
          </Link>
          <Link to="/app" className="upgrade-result-btn ghost">Zum Dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="upgrade-result-wrap">
      <div className="upgrade-result-card">
        {status === 'pending' && (
          <>
            <div className="upgrade-result-icon pending"><Loader2 size={36} className="spin" /></div>
            <h1>Zahlung wird bestätigt …</h1>
            <p>Einen Moment, wir aktivieren deinen Plan.</p>
          </>
        )}
        {status === 'ok' && (
          <>
            <div className="upgrade-result-icon ok"><CheckCircle2 size={36} /></div>
            <h1>Willkommen bei BeeQu {plan === 'team' ? 'Team' : 'Pro'}!</h1>
            <p>
              <Sparkles size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Dein Plan ist aktiv
              {expiresAt && (
                <> bis <strong>{new Date(expiresAt).toLocaleDateString('de-DE')}</strong></>
              )}.
            </p>
            <Link to="/app" className="upgrade-result-btn primary">Loslegen</Link>
          </>
        )}
        {status === 'slow' && (
          <>
            <div className="upgrade-result-icon pending"><Loader2 size={36} /></div>
            <h1>Fast geschafft</h1>
            <p>
              Stripe braucht gerade etwas länger. Dein Plan wird automatisch aktiviert,
              sobald die Zahlung bestätigt ist.
            </p>
            <Link to="/app" className="upgrade-result-btn primary">Zum Dashboard</Link>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="upgrade-result-icon cancel"><XCircle size={36} /></div>
            <h1>Etwas ist schiefgelaufen</h1>
            <p>Wir konnten die Sitzung nicht finden.</p>
            <Link to="/app/pricing" className="upgrade-result-btn primary">
              Zurück zu den Plänen
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
