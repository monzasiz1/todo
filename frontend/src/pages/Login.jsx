import { useState } from 'react';
import '../styles/auth.css';
import { useLocation } from 'react-router-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, ArrowRight, Key, Mail, ShieldCheck } from 'lucide-react';

const ease = [0.25, 0.46, 0.45, 0.94];

export default function Login() {
  const location = useLocation();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep]         = useState('credentials'); // 'credentials' | '2fa'
  const [tfaCode, setTfaCode]   = useState('');
  const { login, loading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    return (
      <div className="bq-auth-page">

        {showPwReset && (
          <motion.div
            className="bq-auth-success bq-auth-success-outer"
            initial={{ opacity: 0, y: -18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.38 }}
          >
            <ShieldCheck size={18} style={{ color: '#34C759', marginRight: 8, minWidth: 18 }} />
            <span>Passwort erfolgreich geändert.<br />Bitte melde dich mit dem neuen Passwort an.</span>
          </motion.div>
        )}

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
            <h1>{step === '2fa' ? '2FA-Code eingeben' : 'Willkommen zurück'}</h1>
            <p>{step === '2fa'
              ? 'Öffne deine Authenticator-App und gib den 6-stelligen Code ein.'
              : 'Bei deinem BeeQu-Konto anmelden'}
            </p>
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
            <AnimatePresence mode="wait">
              {step === 'credentials' ? (
                <motion.div key="creds" className="bq-auth-form"
                  initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}
                  style={{ display: 'contents' }}>
                  <div className="bq-field">
                    <label htmlFor="email">E-Mail-Adresse</label>
                    <div className="bq-input-wrap">
                      <Mail size={16} className="bq-input-icon" />
                      <input id="email" type="email" placeholder="du@example.com"
                        value={email} onChange={(e) => setEmail(e.target.value)}
                        required autoComplete="email" />
                    </div>
                  </div>
                  <div className="bq-field">
                    <label htmlFor="password">Passwort</label>
                    <div className="bq-input-wrap">
                      <Key size={16} className="bq-input-icon" />
                      <input id="password" type="password" placeholder="Dein Passwort"
                        value={password} onChange={(e) => setPassword(e.target.value)}
                        required autoComplete="current-password" />
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="tfa" style={{ display: 'contents' }}
                  initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.2 }}>
                  <div className="bq-field">
                    <label htmlFor="tfacode">6-stelliger Code</label>
                    <div className="bq-input-wrap">
                      <ShieldCheck size={16} className="bq-input-icon" />
                      <input id="tfacode" type="text" inputMode="numeric"
                        pattern="[0-9]*" maxLength={6} placeholder="000000"
                        value={tfaCode} onChange={(e) => setTfaCode(e.target.value.replace(/\D/g, ''))}
                        required autoFocus
                        style={{ letterSpacing: '0.3em', fontSize: '1.3rem', fontWeight: 700 }} />
                    </div>
                  </div>
                  <button type="button" className="bq-auth-back-btn"
                    onClick={() => { setStep('credentials'); setTfaCode(''); clearError(); }}>
                    ← Zurück
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <button type="submit" className="bq-auth-submit" disabled={loading}>
              {loading
                ? <span className="bq-auth-spinner" />
                : step === '2fa'
                  ? <>Bestätigen <ShieldCheck size={16} /></>
                  : <>Anmelden <ArrowRight size={16} /></>
              }
            </button>
          </form>

          <div className="bq-auth-switch">
            <span>Noch kein Konto?</span>
            <Link to="/register">Kostenlos registrieren</Link>
          </div>
        </motion.div>
      </div>

    </div>
  );
}
