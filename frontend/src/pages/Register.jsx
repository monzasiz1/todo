import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, CalendarDays, Key, Mail, Sparkles, User, UsersRound } from 'lucide-react';

const ease = [0.25, 0.46, 0.45, 0.94];

export default function Register() {
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');

  const { register, loading, error, clearError } = useAuthStore();
  const navigate = useNavigate();
  const [pendingEmail, setPendingEmail] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearError();
    const result = await register(name, email, password);
    if (result.success) {
      navigate('/app');
    } else if (result.message) {
      setPendingEmail(email);
    }
  };

  if (pendingEmail) {
    return (
      <div className="bq-verify-screen">
        <div className="bq-verify-card">
          <img src="/icons/icon.png" alt="BeeQu" className="bq-verify-logo" />
          <div className="bq-verify-icon">✉️</div>
          <h1>Bitte bestätige deine<br />E-Mail-Adresse</h1>
          <p>
            Wir haben dir eine E-Mail an<br />
            <strong>{pendingEmail}</strong><br />
            gesendet. Klicke auf den Link in der Mail,<br />
            um dein Konto zu aktivieren.
          </p>
          <Link to="/app/login" className="bq-btn bq-primary bq-btn-lg">
            Zum Login
          </Link>
          <span className="bq-verify-hint">Kein Mail? Prüfe deinen Spam-Ordner.</span>
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
