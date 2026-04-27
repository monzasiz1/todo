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

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearError();
    const success = await register(name, email, password);
    if (success) navigate('/app');
  };

  return (
    <div className="bq-auth-page">

      {/* ── Left: dark branded panel ── */}
      <div className="bq-auth-brand">
        <div className="bq-auth-brand-top">
          <Link to="/landing" className="bq-auth-logo">
            <img src="/icons/icon.png" alt="BeeQu" />
            <span>BeeQu</span>
          </Link>

          <h2 className="bq-auth-brand-headline">{'Kostenlos starten.\nIn 30 Sekunden.'}</h2>

          <p className="bq-auth-brand-sub">
            Tasks, Kalender und KI-Assistent — alles in einer App von BeeTwice. Keine Kreditkarte nötig.
          </p>
        </div>

        <div className="bq-auth-features">
          {[
            { icon: Sparkles,     color: '#007AFF', text: 'KI erkennt Datum, Zeit & Priorität automatisch' },
            { icon: CalendarDays, color: '#5856D6', text: 'Monats- & Wochenkalender mit allen Aufgaben' },
            { icon: UsersRound,   color: '#34C759', text: 'Teams & Echtzeit-Chat ohne extra Tools' },
          ].map(({ icon: Icon, color, text }) => (
            <div key={text} className="bq-auth-feature">
              <div className="bq-auth-feature-icon" style={{ background: `${color}18`, color }}>
                <Icon size={16} />
              </div>
              <span>{text}</span>
            </div>
          ))}
        </div>

        <div className="bq-auth-brand-footer">
          <span>© 2026 BeeTwice GmbH</span>
          <span>·</span>
          <a href="#">Datenschutz</a>
          <span>·</span>
          <a href="#">AGB</a>
        </div>
      </div>

      {/* ── Right: form panel ── */}
      <div className="bq-auth-form-panel">
        <Link to="/landing" className="bq-auth-back">
          ← Zurück zur Startseite
        </Link>

        <motion.div
          className="bq-auth-form-inner"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease }}
        >
          {/* Mobile-only logo */}
          <div className="bq-auth-mobile-logo">
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
            <Link to="/login">Anmelden</Link>
          </div>
        </motion.div>
      </div>

    </div>
  );
}
