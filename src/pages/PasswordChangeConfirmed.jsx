import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';

export default function PasswordChangeConfirmed() {
  const navigate = useNavigate();
  useEffect(() => {
    const timer = setTimeout(() => {
      navigate('/login?pwreset=1');
    }, 2500);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#007AFF 0%,#5856D6 100%)' }}>
      <div style={{ background: '#fff', borderRadius: 18, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', padding: 40, maxWidth: 380, textAlign: 'center' }}>
        <ShieldCheck size={48} style={{ color: '#34C759', marginBottom: 18 }} />
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 26 }}>Passwort geändert!</h2>
        <p style={{ color: '#444', margin: '18px 0 0' }}>Dein Passwort wurde erfolgreich geändert.<br />Du wirst jetzt zum Login weitergeleitet.</p>
      </div>
    </div>
  );
}
