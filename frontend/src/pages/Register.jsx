import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, CalendarDays, Key, Mail, Sparkles, User, UsersRound } from 'lucide-react';

const ease = [0.25, 0.46, 0.45, 0.94];

export default function Register() {
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');

  const { register, verifyCode, loading, error, clearError } = useAuthStore();
  const navigate = useNavigate();
  const [pendingEmail, setPendingEmail] = useState(null);
  const [verifyDigits, setVerifyDigits] = useState(['', '', '', '', '', '']);
  const [verifyError, setVerifyError] = useState('');
  const [resendCountdown, setResendCountdown] = useState(30);
  const [resendMessage, setResendMessage] = useState('');
  const verifyRefs = [useRef(null), useRef(null), useRef(null), useRef(null), useRef(null), useRef(null)];

  useEffect(() => {
    if (!pendingEmail || resendCountdown <= 0) return undefined;
    const timer = window.setInterval(() => {
      setResendCountdown((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pendingEmail, resendCountdown]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearError();
    const result = await register(name, email, password);
    if (result.success) {
      navigate('/app');
    } else if (result.message) {
      setPendingEmail(email);
      setVerifyDigits(['', '', '', '', '', '']);
      setVerifyError('');
      setResendMessage('');
      setResendCountdown(30);
      setTimeout(() => verifyRefs[0]?.current?.focus(), 80);
    }
  };

  const handleVerifyDigit = (idx, val) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...verifyDigits];
    next[idx] = digit;
    setVerifyDigits(next);
    setVerifyError('');
    if (digit && idx < 5) setTimeout(() => verifyRefs[idx + 1]?.current?.focus(), 10);
  };

  const handleVerifyKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !verifyDigits[idx] && idx > 0) {
      setTimeout(() => verifyRefs[idx - 1]?.current?.focus(), 10);
    }
  };

  const handleVerifyPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = ['', '', '', '', '', ''];
    [...pasted].forEach((ch, i) => {
      next[i] = ch;
    });
    setVerifyDigits(next);
    setVerifyError('');
    const focusIdx = Math.min(pasted.length, 5);
    setTimeout(() => verifyRefs[focusIdx]?.current?.focus(), 10);
  };

  const handleVerifySubmit = async () => {
    const code = verifyDigits.join('');
    if (code.length < 6) {
      setVerifyError('Bitte alle 6 Stellen eingeben.');
      return;
    }

    const result = await verifyCode(pendingEmail, code);
    if (result?.success) {
      navigate('/app');
      return;
    }

    setVerifyError(result?.error || 'Ungültiger Code. Bitte erneut versuchen.');
    setVerifyDigits(['', '', '', '', '', '']);
    setTimeout(() => verifyRefs[0]?.current?.focus(), 80);
  };

  const handleResendCode = async () => {
    if (!pendingEmail || resendCountdown > 0 || loading) return;
    clearError();
    setVerifyError('');
    setResendMessage('');

    const result = await register(name, pendingEmail, password);
    if (result?.message) {
      setVerifyDigits(['', '', '', '', '', '']);
      setResendCountdown(30);
      setResendMessage('Neuer Code wurde gesendet.');
      setTimeout(() => verifyRefs[0]?.current?.focus(), 80);
      return;
    }

    setVerifyError(result?.error || 'Code konnte nicht erneut gesendet werden.');
  };

  if (pendingEmail) {
    return (
      <div className="bq-verify-screen">
        <div className="bq-verify-card">
          <img src="/icons/icon.png" alt="BeeQu" className="bq-verify-logo" />
          <div className="bq-verify-mail-icon"><Mail size={28} color="#007AFF" /></div>
          <h1>Code eingeben</h1>
          <p>
            Wir haben einen 6-stelligen Code an<br />
            <strong>{pendingEmail}</strong><br />
            gesendet. Bitte prüfe dein Postfach.
          </p>
          <div className="bq-verify-digits" onPaste={handleVerifyPaste}>
            {verifyDigits.map((d, i) => (
              <input
                key={i}
                ref={verifyRefs[i]}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={d}
                className={`bq-verify-digit${d ? ' filled' : ''}`}
                onChange={(e) => handleVerifyDigit(i, e.target.value)}
                onKeyDown={(e) => handleVerifyKeyDown(i, e)}
              />
            ))}
          </div>
          {verifyError && (
            <div className="bq-auth-error" style={{ marginTop: 8 }}>
              <AlertCircle size={14} />
              <span>{verifyError}</span>
            </div>
          )}
          <button
            type="button"
            className="bq-btn bq-primary bq-btn-lg"
            onClick={handleVerifySubmit}
            disabled={verifyDigits.join('').length < 6 || loading}
          >
            {loading ? 'Prüfen...' : 'Bestätigen'}
          </button>
          <button
            type="button"
            className="bq-auth-resend-btn"
            onClick={handleResendCode}
            disabled={resendCountdown > 0 || loading}
          >
            {resendCountdown > 0 ? `Code erneut senden in ${resendCountdown}s` : 'Code erneut senden'}
          </button>
          {resendMessage && <span className="bq-auth-resend-msg">{resendMessage}</span>}
          <span className="bq-auth-verify-hint">Kein Mail erhalten? Prüfe deinen Spam-Ordner. Der Code ist 10 Minuten gültig.</span>
          <button
            type="button"
            className="bq-auth-switch-btn"
            onClick={() => {
              setPendingEmail(null);
              setVerifyDigits(['', '', '', '', '', '']);
              setVerifyError('');
              setResendMessage('');
              setResendCountdown(30);
            }}
          >
            Zurück zur Registrierung
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bq-auth-page">

      <Link to="/landing" className="bq-auth-back">
        ← Zurück zur Startseite
      </Link>

      <div className="bq-auth-form-panel">
        <motion.div
          className="bq-auth-form-inner"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease }}
        >
          {/* Logo */}
          <div className="bq-auth-card-logo">
            <img src="/icons/icon.png" alt="BeeQu" />
            <span>BeeQu</span>
          </div>

          <div className="bq-auth-form-head">
            <h1>Konto erstellen</h1>
            <p>Kostenlos starten — keine Kreditkarte nötig</p>
          </div>

          {error && (
            <motion.div
              className="bq-auth-error"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <AlertCircle size={15} />
              <span>{error}</span>
            </motion.div>
          )}

          <form className="bq-auth-form" onSubmit={handleSubmit}>
            <div className="bq-field">
              <label htmlFor="name">Vollständiger Name</label>
              <div className="bq-input-wrap">
                <User size={16} className="bq-input-icon" />
                <input
                  id="name"
                  type="text"
                  placeholder="Max Mustermann"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
            </div>

            <div className="bq-field">
              <label htmlFor="email">E-Mail-Adresse</label>
              <div className="bq-input-wrap">
                <Mail size={16} className="bq-input-icon" />
                <input
                  id="email"
                  type="email"
                  placeholder="du@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="bq-field">
              <label htmlFor="password">Passwort</label>
              <div className="bq-input-wrap">
                <Key size={16} className="bq-input-icon" />
                <input
                  id="password"
                  type="password"
                  placeholder="Mind. 6 Zeichen"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <p className="bq-auth-consent">
              Mit der Registrierung stimmst du unseren{' '}
              <a href="#">AGB</a> und der{' '}
              <a href="#">Datenschutzerklärung</a> zu.
            </p>

            <button type="submit" className="bq-auth-submit" disabled={loading}>
              {loading
                ? <span className="bq-auth-spinner" />
                : <> Konto erstellen <ArrowRight size={16} /> </>
              }
            </button>
          </form>

          <div className="bq-auth-switch">
            <span>Bereits ein Konto?</span>
            <Link to="/app/login">Anmelden</Link>
          </div>
        </motion.div>
      </div>


    </div>
  );
}
